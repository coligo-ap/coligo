-- =============================================================================
-- 0456 — FIDÉLITÉ Phase 2 : scanner unifié (SPEC-FIDELITE 2.1→2.5)
-- =============================================================================
-- Exigences propriétaire (validées 16/08/2026) :
--   • Bon DIFFÉRÉ par le plafond 24 h = VISIBLE en caisse : les réponses de
--     crédit ET de fiche portent `voucher_deferred_da` (« Bon de X DA gagné —
--     actif demain »). La fiche (resolve) tente aussi de POSER les bons
--     différés dès que le plafond le permet → la promesse devient vraie au
--     scan suivant, sans nouvel achat.
--   • Cas combiné commande + fidélité (2.4) : crédit EN UN TAP depuis la
--     commande validée (montant repris de net_total_da, jamais de double
--     saisie, UNE seule fois par commande — index uq_loyalty_entries_order),
--     et réduction proposée à l'encaissement (loyalty_redeem_order).
-- Refactor : cœurs partagés loyalty_credit_core / loyalty_redeem_core —
-- les wrappers (identifiant scanné OU commande) ne divergent jamais.
-- CREATE OR REPLACE conserve les GRANTs existants de loyalty_credit/redeem/
-- resolve_scan ; les nouvelles fonctions reçoivent les leurs explicitement.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Paliers dus : débloque tant que le plafond 24 h le permet, sinon DIFFÈRE
--    (la progression reste — rien n'est perdu). Appelant = détenteur du verrou
--    advisory du compte. INTERNE (aucun GRANT).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.loyalty_grant_due_tiers(
  p_account uuid, p_merchant uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_program public.loyalty_programs%ROWTYPE;
  v_progress integer;
  v_voucher_id uuid;
  v_expires timestamptz;
  v_granted jsonb := '[]'::jsonb;
  v_n integer := 0;
  v_deferred integer := 0;
BEGIN
  SELECT * INTO v_program FROM public.loyalty_programs WHERE merchant_id = p_merchant;
  IF v_program.merchant_id IS NULL OR NOT v_program.enabled
     OR v_program.tier_threshold_da IS NULL THEN
    RETURN jsonb_build_object('granted', '[]'::jsonb, 'deferred_da', 0);
  END IF;

  v_progress := public.loyalty_account_progress(p_account);
  WHILE v_progress >= v_program.tier_threshold_da AND v_n < 10 LOOP
    EXIT WHEN public.loyalty_daily_used(p_account) + v_program.tier_reward_da
              > v_program.daily_credit_cap_da;
    v_expires := now() + make_interval(days => v_program.voucher_validity_days);
    INSERT INTO public.loyalty_vouchers
      (account_id, merchant_id, granted_account_id, amount_da,
       progress_consumed_da, expires_at)
    VALUES
      (p_account, p_merchant, p_account, v_program.tier_reward_da,
       v_program.tier_threshold_da, v_expires)
    RETURNING id INTO v_voucher_id;
    INSERT INTO public.loyalty_entries
      (account_id, merchant_id, counterparty_account_id, type, amount_da,
       voucher_id, client_operation_id)
    VALUES
      (p_account, p_merchant, public.loyalty_program_account(p_merchant),
       'voucher_grant', v_program.tier_reward_da, v_voucher_id,
       'vgrant:' || v_voucher_id),
      (public.loyalty_program_account(p_merchant), p_merchant, p_account,
       'voucher_grant', -v_program.tier_reward_da, v_voucher_id,
       'vgrant:' || v_voucher_id || ':p');
    v_granted := v_granted || jsonb_build_object(
      'id', v_voucher_id, 'amount_da', v_program.tier_reward_da,
      'expires_at', v_expires);
    v_progress := v_progress - v_program.tier_threshold_da;
    v_n := v_n + 1;
  END LOOP;

  -- Palier atteint mais plafond du jour saturé → visible côté caisse.
  IF v_progress >= v_program.tier_threshold_da THEN
    v_deferred := v_program.tier_reward_da;
  END IF;
  RETURN jsonb_build_object('granted', v_granted, 'deferred_da', v_deferred);
END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_grant_due_tiers(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. CŒUR du crédit — partagé par le scan (identifiant) et la commande (2.4).
--    INTERNE. L'appelant a déjà : commerçant vérifié, feature active, op ≥ 8.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.loyalty_credit_core(
  p_merchant uuid,
  p_account uuid,
  p_purchase_da integer,
  p_client_operation_id text,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settings public.loyalty_platform_settings%ROWTYPE;
  v_program public.loyalty_programs%ROWTYPE;
  v_prev public.loyalty_entries%ROWTYPE;
  v_earn integer;
  v_used integer;
  v_capped boolean := false;
  v_prog_acc uuid;
  v_tiers jsonb;
BEGIN
  SELECT * INTO v_settings FROM public.loyalty_platform_settings WHERE id = 1;
  IF p_purchase_da IS NULL OR p_purchase_da <= 0
     OR p_purchase_da > v_settings.max_purchase_per_credit_da THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount',
                              'max_da', v_settings.max_purchase_per_credit_da);
  END IF;
  SELECT * INTO v_program FROM public.loyalty_programs WHERE merchant_id = p_merchant;
  IF v_program.merchant_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_program');
  END IF;
  IF NOT v_program.enabled THEN
    RETURN jsonb_build_object('ok', false, 'error', 'program_disabled');
  END IF;

  -- Idempotence par pré-lecture, à l'échelle du COMMERÇANT (le compte peut
  -- avoir changé si la carte a été liée entre l'appel et le rejeu).
  SELECT * INTO v_prev FROM public.loyalty_entries
   WHERE merchant_id = p_merchant AND client_operation_id = p_client_operation_id
     AND type = 'credit' AND amount_da >= 0;
  IF v_prev.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true,
      'earned_da', v_prev.amount_da, 'capped', false,
      'vouchers_granted', '[]'::jsonb, 'voucher_deferred_da', 0);
  END IF;

  IF NOT public.loyalty_rate_ok('loyalty_credit_acc', p_account::text, 40, 86400) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('loyalty:' || p_account));
  PERFORM public.loyalty_expire_due(p_account);

  v_earn := round(p_purchase_da * v_program.earn_rate_pct / 100.0)::int;
  v_used := public.loyalty_daily_used(p_account);
  IF v_earn > 0 THEN
    IF v_used >= v_program.daily_credit_cap_da THEN
      RETURN jsonb_build_object('ok', false, 'error', 'cap_reached');
    END IF;
    IF v_used + v_earn > v_program.daily_credit_cap_da THEN
      v_earn := v_program.daily_credit_cap_da - v_used;
      v_capped := true;
    END IF;
  END IF;

  v_prog_acc := public.loyalty_program_account(p_merchant);
  BEGIN
    INSERT INTO public.loyalty_entries
      (account_id, merchant_id, counterparty_account_id, type, amount_da,
       purchase_amount_da, order_id, client_operation_id, created_by)
    VALUES
      (p_account, p_merchant, v_prog_acc, 'credit', v_earn,
       p_purchase_da, p_order_id, p_client_operation_id, auth.uid());
  EXCEPTION WHEN unique_violation THEN
    -- Course entre deux rejeux, ou commande DÉJÀ créditée (uq order).
    RETURN jsonb_build_object('ok', true, 'already', true,
      'earned_da', v_earn, 'capped', v_capped,
      'vouchers_granted', '[]'::jsonb, 'voucher_deferred_da', 0);
  END;
  INSERT INTO public.loyalty_entries
    (account_id, merchant_id, counterparty_account_id, type, amount_da,
     order_id, client_operation_id, created_by)
  VALUES
    (v_prog_acc, p_merchant, p_account, 'credit', -v_earn,
     p_order_id, p_client_operation_id || ':p', auth.uid());

  v_tiers := public.loyalty_grant_due_tiers(p_account, p_merchant);

  RETURN jsonb_build_object('ok', true, 'already', false,
    'earned_da', v_earn, 'capped', v_capped,
    'vouchers_granted', COALESCE(v_tiers->'granted', '[]'::jsonb),
    'voucher_deferred_da', COALESCE((v_tiers->>'deferred_da')::int, 0));
END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_credit_core(uuid, uuid, integer, text, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. loyalty_credit — wrapper « identifiant scanné » (signature INCHANGÉE,
--    GRANTs conservés). L'activation d'une carte `printed` n'a désormais lieu
--    QUE si le crédit aboutit (avant : aussi sur cap_reached — resserré).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.loyalty_credit(
  p_identifier text,
  p_purchase_da integer,
  p_client_operation_id text,
  p_order_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_merchant uuid;
  v_program public.loyalty_programs%ROWTYPE;
  r RECORD;
  v_account uuid;
  v_core jsonb;
  v_activated boolean := false;
BEGIN
  SELECT id INTO v_merchant FROM public.merchants WHERE user_id = auth.uid();
  IF v_merchant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_merchant');
  END IF;
  IF public.feature_blocked('loyalty') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'feature_disabled');
  END IF;
  IF COALESCE(length(p_client_operation_id), 0) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_operation');
  END IF;

  -- FOR UPDATE : sérialise avec une liaison simultanée de la même carte.
  SELECT * INTO r FROM public.loyalty_resolve_target(p_identifier, true);
  IF r.o_error IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', r.o_error);
  END IF;

  IF r.o_customer IS NOT NULL THEN
    v_account := public.loyalty_get_or_create_account(v_merchant, r.o_customer, NULL);
  ELSE
    v_account := public.loyalty_get_or_create_account(v_merchant, NULL, (r.o_card).id);
  END IF;

  v_core := public.loyalty_credit_core(
    v_merchant, v_account, p_purchase_da, p_client_operation_id, p_order_id);
  IF NOT COALESCE((v_core->>'ok')::boolean, false) THEN
    RETURN v_core;
  END IF;

  -- Activation au premier crédit RÉUSSI en caisse (spec 1.1).
  IF r.o_kind = 'card' AND (r.o_card).status = 'printed'
     AND NOT COALESCE((v_core->>'already')::boolean, false) THEN
    PERFORM public.loyalty_card_transition(
      (r.o_card).id, 'activated', 'merchant', v_merchant,
      'Activée au premier crédit en caisse', NULL, p_client_operation_id);
    v_activated := true;
  END IF;

  SELECT * INTO v_program FROM public.loyalty_programs WHERE merchant_id = v_merchant;
  RETURN v_core || jsonb_build_object(
    'activated', v_activated,
    'label', public.loyalty_display_label(r.o_customer_name, (r.o_card).card_code),
    'summary', public.loyalty_account_summary(
      v_account, v_program.tier_threshold_da, v_program.tier_reward_da));
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Cas combiné 2.4 — crédit EN UN TAP sur une commande validée : montant
--    repris de la commande (net produits), client résolu par la commande
--    (pas besoin de re-scanner), UNE seule fois par commande (uq order).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.loyalty_credit_order(
  p_order_id uuid,
  p_client_operation_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_merchant uuid;
  v_order public.orders%ROWTYPE;
  v_program public.loyalty_programs%ROWTYPE;
  v_amount integer;
  v_account uuid;
  v_name text;
  v_core jsonb;
BEGIN
  SELECT id INTO v_merchant FROM public.merchants WHERE user_id = auth.uid();
  IF v_merchant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_merchant');
  END IF;
  IF public.feature_blocked('loyalty') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'feature_disabled');
  END IF;
  IF COALESCE(length(p_client_operation_id), 0) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_operation');
  END IF;

  SELECT * INTO v_order FROM public.orders
   WHERE id = p_order_id AND merchant_id = v_merchant;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_order.status <> 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_completed');
  END IF;
  IF v_order.customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_customer');
  END IF;

  v_amount := GREATEST(COALESCE(v_order.net_total_da,
    v_order.subtotal_da - COALESCE(v_order.discount_da, 0)), 0);
  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  v_account := public.loyalty_get_or_create_account(v_merchant, v_order.customer_id, NULL);
  v_core := public.loyalty_credit_core(
    v_merchant, v_account, v_amount, p_client_operation_id, p_order_id);
  IF NOT COALESCE((v_core->>'ok')::boolean, false) THEN
    RETURN v_core;
  END IF;

  SELECT full_name INTO v_name FROM public.customers WHERE id = v_order.customer_id;
  SELECT * INTO v_program FROM public.loyalty_programs WHERE merchant_id = v_merchant;
  RETURN v_core || jsonb_build_object(
    'purchase_da', v_amount,
    'label', public.loyalty_display_label(v_name, NULL),
    'summary', public.loyalty_account_summary(
      v_account, v_program.tier_threshold_da, v_program.tier_reward_da));
END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_credit_order(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.loyalty_credit_order(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. CŒUR de la déduction — partagé identifiant / commande. INTERNE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.loyalty_redeem_core(
  p_merchant uuid,
  p_account uuid,
  p_client_operation_id text,
  p_voucher_id uuid,
  p_amount_da integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev public.loyalty_entries%ROWTYPE;
  v_voucher public.loyalty_vouchers%ROWTYPE;
  v_amount integer;
  v_available integer;
  v_prog_acc uuid;
BEGIN
  IF (p_voucher_id IS NULL) = (p_amount_da IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_args');
  END IF;

  SELECT * INTO v_prev FROM public.loyalty_entries
   WHERE merchant_id = p_merchant AND client_operation_id = p_client_operation_id
     AND type IN ('redeem', 'voucher_redeem') AND amount_da <= 0;
  IF v_prev.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true,
                              'deducted_da', -v_prev.amount_da);
  END IF;

  IF NOT public.loyalty_rate_ok('loyalty_redeem_acc', p_account::text, 40, 86400) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('loyalty:' || p_account));
  PERFORM public.loyalty_expire_due(p_account);
  v_prog_acc := public.loyalty_program_account(p_merchant);

  IF p_voucher_id IS NOT NULL THEN
    SELECT * INTO v_voucher FROM public.loyalty_vouchers
     WHERE id = p_voucher_id AND account_id = p_account FOR UPDATE;
    IF v_voucher.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'voucher_not_found');
    END IF;
    IF v_voucher.status = 'expired' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'voucher_expired');
    END IF;
    IF v_voucher.status <> 'granted' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'voucher_used');
    END IF;
    v_amount := v_voucher.amount_da;

    BEGIN
      INSERT INTO public.loyalty_entries
        (account_id, merchant_id, counterparty_account_id, type, amount_da,
         voucher_id, client_operation_id, created_by)
      VALUES
        (p_account, p_merchant, v_prog_acc, 'voucher_redeem', -v_amount,
         v_voucher.id, p_client_operation_id, auth.uid());
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', true, 'already', true, 'deducted_da', v_amount);
    END;
    INSERT INTO public.loyalty_entries
      (account_id, merchant_id, counterparty_account_id, type, amount_da,
       voucher_id, client_operation_id, created_by)
    VALUES
      (v_prog_acc, p_merchant, p_account, 'voucher_redeem', v_amount,
       v_voucher.id, p_client_operation_id || ':p', auth.uid());
    UPDATE public.loyalty_vouchers
       SET status = 'redeemed', redeemed_at = now() WHERE id = v_voucher.id;
  ELSE
    IF p_amount_da <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
    END IF;
    v_available := GREATEST(0, public.loyalty_account_balance(p_account)
                               - public.loyalty_account_voucher_value(p_account));
    IF p_amount_da > v_available THEN
      RETURN jsonb_build_object('ok', false, 'error', 'insufficient',
                                'available_da', v_available);
    END IF;
    v_amount := p_amount_da;

    BEGIN
      INSERT INTO public.loyalty_entries
        (account_id, merchant_id, counterparty_account_id, type, amount_da,
         client_operation_id, created_by)
      VALUES
        (p_account, p_merchant, v_prog_acc, 'redeem', -v_amount,
         p_client_operation_id, auth.uid());
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', true, 'already', true, 'deducted_da', v_amount);
    END;
    INSERT INTO public.loyalty_entries
      (account_id, merchant_id, counterparty_account_id, type, amount_da,
       client_operation_id, created_by)
    VALUES
      (v_prog_acc, p_merchant, p_account, 'redeem', v_amount,
       p_client_operation_id || ':p', auth.uid());
  END IF;

  RETURN jsonb_build_object('ok', true, 'already', false, 'deducted_da', v_amount);
END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_redeem_core(uuid, uuid, text, uuid, integer) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. loyalty_redeem — wrapper identifiant (signature INCHANGÉE, GRANTs
--    conservés).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.loyalty_redeem(
  p_identifier text,
  p_client_operation_id text,
  p_voucher_id uuid DEFAULT NULL,
  p_amount_da integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_merchant uuid;
  v_program public.loyalty_programs%ROWTYPE;
  r RECORD;
  v_account uuid;
  v_core jsonb;
BEGIN
  SELECT id INTO v_merchant FROM public.merchants WHERE user_id = auth.uid();
  IF v_merchant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_merchant');
  END IF;
  IF public.feature_blocked('loyalty') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'feature_disabled');
  END IF;
  IF COALESCE(length(p_client_operation_id), 0) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_operation');
  END IF;

  SELECT * INTO v_program FROM public.loyalty_programs WHERE merchant_id = v_merchant;

  SELECT * INTO r FROM public.loyalty_resolve_target(p_identifier, true);
  IF r.o_error IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', r.o_error);
  END IF;

  v_account := public.loyalty_find_account(v_merchant, r.o_customer, (r.o_card).id);
  IF v_account IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient', 'available_da', 0);
  END IF;

  v_core := public.loyalty_redeem_core(
    v_merchant, v_account, p_client_operation_id, p_voucher_id, p_amount_da);
  IF NOT COALESCE((v_core->>'ok')::boolean, false) THEN
    RETURN v_core;
  END IF;

  RETURN v_core || jsonb_build_object(
    'label', public.loyalty_display_label(r.o_customer_name, (r.o_card).card_code),
    'summary', public.loyalty_account_summary(
      v_account, v_program.tier_threshold_da, v_program.tier_reward_da));
END;
$$;

-- Réduction proposée à l'encaissement d'une commande (2.4, sens inverse) :
-- client résolu par la commande, mêmes règles (connexion exigée côté UI).
CREATE OR REPLACE FUNCTION public.loyalty_redeem_order(
  p_order_id uuid,
  p_client_operation_id text,
  p_voucher_id uuid DEFAULT NULL,
  p_amount_da integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_merchant uuid;
  v_order public.orders%ROWTYPE;
  v_program public.loyalty_programs%ROWTYPE;
  v_account uuid;
  v_name text;
  v_core jsonb;
BEGIN
  SELECT id INTO v_merchant FROM public.merchants WHERE user_id = auth.uid();
  IF v_merchant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_merchant');
  END IF;
  IF public.feature_blocked('loyalty') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'feature_disabled');
  END IF;
  IF COALESCE(length(p_client_operation_id), 0) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_operation');
  END IF;

  SELECT * INTO v_order FROM public.orders
   WHERE id = p_order_id AND merchant_id = v_merchant;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_order.customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_customer');
  END IF;

  v_account := public.loyalty_find_account(v_merchant, v_order.customer_id, NULL);
  IF v_account IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient', 'available_da', 0);
  END IF;

  v_core := public.loyalty_redeem_core(
    v_merchant, v_account, p_client_operation_id, p_voucher_id, p_amount_da);
  IF NOT COALESCE((v_core->>'ok')::boolean, false) THEN
    RETURN v_core;
  END IF;

  SELECT full_name INTO v_name FROM public.customers WHERE id = v_order.customer_id;
  SELECT * INTO v_program FROM public.loyalty_programs WHERE merchant_id = v_merchant;
  RETURN v_core || jsonb_build_object(
    'label', public.loyalty_display_label(v_name, NULL),
    'summary', public.loyalty_account_summary(
      v_account, v_program.tier_threshold_da, v_program.tier_reward_da));
END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_redeem_order(uuid, text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.loyalty_redeem_order(uuid, text, uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Contexte fidélité d'une commande validée (2.4) : ce que l'écran propose
--    après le retrait — crédit un-tap et/ou réduction disponible.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.loyalty_order_context(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_merchant uuid;
  v_order public.orders%ROWTYPE;
  v_program public.loyalty_programs%ROWTYPE;
  v_account uuid;
  v_name text;
  v_amount integer;
  v_already boolean;
  v_deferred integer := 0;
BEGIN
  SELECT id INTO v_merchant FROM public.merchants WHERE user_id = auth.uid();
  IF v_merchant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_merchant');
  END IF;
  IF public.feature_blocked('loyalty') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'feature_disabled');
  END IF;

  SELECT * INTO v_order FROM public.orders
   WHERE id = p_order_id AND merchant_id = v_merchant;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_order.customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'customer', false);
  END IF;

  SELECT * INTO v_program FROM public.loyalty_programs WHERE merchant_id = v_merchant;
  IF v_program.merchant_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'customer', true, 'can_credit', false,
                              'no_program', true);
  END IF;

  v_amount := GREATEST(COALESCE(v_order.net_total_da,
    v_order.subtotal_da - COALESCE(v_order.discount_da, 0)), 0);
  v_already := EXISTS (
    SELECT 1 FROM public.loyalty_entries
     WHERE order_id = v_order.id AND type = 'credit');
  SELECT full_name INTO v_name FROM public.customers WHERE id = v_order.customer_id;

  v_account := public.loyalty_find_account(v_merchant, v_order.customer_id, NULL);
  IF v_account IS NOT NULL THEN
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('loyalty:' || v_account));
      PERFORM public.loyalty_expire_due(v_account);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    IF v_program.tier_threshold_da IS NOT NULL
       AND public.loyalty_account_progress(v_account) >= v_program.tier_threshold_da THEN
      v_deferred := v_program.tier_reward_da;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'customer', true,
    'label', public.loyalty_display_label(v_name, NULL),
    'payment_method', v_order.payment_method,
    'already_credited', v_already,
    'can_credit', (v_program.enabled AND NOT v_already
                   AND v_order.status = 'completed' AND v_amount > 0),
    'credit_amount_da', v_amount,
    'voucher_deferred_da', v_deferred,
    'program', jsonb_build_object(
      'enabled', v_program.enabled,
      'earn_rate_pct', v_program.earn_rate_pct,
      'tier_threshold_da', v_program.tier_threshold_da,
      'tier_reward_da', v_program.tier_reward_da
    ),
    'summary', public.loyalty_account_summary(
      v_account, v_program.tier_threshold_da, v_program.tier_reward_da)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_order_context(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.loyalty_order_context(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. loyalty_resolve_scan — la fiche POSE les bons différés dès que possible
--    (« actif demain » devient vrai au scan suivant) et expose
--    voucher_deferred_da pour l'affichage caissier. Signature inchangée.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.loyalty_resolve_scan(p_identifier text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_merchant uuid;
  v_program public.loyalty_programs%ROWTYPE;
  r RECORD;
  v_account uuid;
  v_deferred integer := 0;
BEGIN
  SELECT id INTO v_merchant FROM public.merchants WHERE user_id = auth.uid();
  IF v_merchant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_merchant');
  END IF;
  IF public.feature_blocked('loyalty') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'feature_disabled');
  END IF;
  IF NOT public.loyalty_rate_ok('loyalty_scan_m', v_merchant::text, 600, 3600) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  SELECT * INTO v_program FROM public.loyalty_programs WHERE merchant_id = v_merchant;
  IF v_program.merchant_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_program');
  END IF;

  SELECT * INTO r FROM public.loyalty_resolve_target(p_identifier, false);
  IF r.o_error IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', r.o_error);
  END IF;

  v_account := public.loyalty_find_account(v_merchant, r.o_customer, (r.o_card).id);
  IF v_account IS NOT NULL THEN
    -- Bons échus purgés + bons DIFFÉRÉS posés si le plafond 24 h le permet
    -- désormais. Best-effort : la fiche s'affiche même si cette étape échoue.
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('loyalty:' || v_account));
      PERFORM public.loyalty_expire_due(v_account);
      IF v_program.enabled THEN
        PERFORM public.loyalty_grant_due_tiers(v_account, v_merchant);
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    IF v_program.tier_threshold_da IS NOT NULL
       AND public.loyalty_account_progress(v_account) >= v_program.tier_threshold_da THEN
      v_deferred := v_program.tier_reward_da;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'kind', r.o_kind,
    'linked', r.o_customer IS NOT NULL,
    'label', public.loyalty_display_label(r.o_customer_name, (r.o_card).card_code),
    'card_status', (r.o_card).status,
    'will_activate', ((r.o_card).status = 'printed'),
    'voucher_deferred_da', v_deferred,
    'program', jsonb_build_object(
      'enabled', v_program.enabled,
      'earn_rate_pct', v_program.earn_rate_pct,
      'tier_threshold_da', v_program.tier_threshold_da,
      'tier_reward_da', v_program.tier_reward_da
    ),
    'summary', public.loyalty_account_summary(
      v_account, v_program.tier_threshold_da, v_program.tier_reward_da)
  );
END;
$$;

-- =============================================================================
-- VÉRIFICATION : npm run test:loyalty (sections Phase 2 incluses)
-- =============================================================================
