-- =============================================================================
-- 0116 — Refonte no-show « façon Yassir » + SUPPRESSION du paiement partiel & créance
-- =============================================================================
-- Correctifs fondateur (2026-06-09) sur la première version (0114/0115) :
--
--  ❌ SUPPRIMÉ — Paiement partiel (montant encaissé éditable) : inacceptable.
--     validate_delivery revient à 4 arguments (= 0090), plus de cash_shortfall.
--  ❌ SUPPRIMÉ — Créance en DA côté client (debt_da) : complique les comptes.
--     Plus de recouvrement au checkout, plus de recover_customer_debt.
--  ❌ SUPPRIMÉ — Gating COD des comptes neufs (cod_unlock_orders) : Yassir Algérie
--     ne bloque PAS les comptes neufs. COD dispo dès la 1re commande.
--
--  ✅ NO-SHOW (client absent / refus) — modèle Yassir, pro-confiance :
--     • Le livreur ne peut déclarer le no-show qu'APRÈS un minuteur : 8 min depuis
--       son arrivée, étendu à 16 min si le client n'a pas répondu en messagerie
--       in-app (il peut juste ne pas trouver le livreur dehors).
--     • La commande passe en `cancelled` mais on NE REMBOURSE PAS le client (les
--       triggers refund cashback/topup sont neutralisés pour un no-show).
--     • On PRÉLÈVE sur le cashback puis le Coligo Pay du client (si dispo) de quoi
--       couvrir la course due au livreur — on doit payer le livreur.
--     • Le livreur est indemnisé d'UNE course (driver_net, « à recevoir »).
--     • Si le prélèvement ne couvre pas tout → `noshow_pending` : la PROCHAINE
--       commande aura des frais de service relevés MAIS plafonnés (≤ 100 DA), puis
--       le drapeau se lève automatiquement dès qu'une commande est honorée.
--     • Pas de blocage dur du COD sur un simple no-show (recours dur = super-admin).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. platform_settings : paramètres no-show (remplacent cod_unlock_orders).
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS noshow_penalty_sf_da INTEGER NOT NULL DEFAULT 100,  -- frais service plafond pénalité
  ADD COLUMN IF NOT EXISTS noshow_wait_min      INTEGER NOT NULL DEFAULT 8;    -- fenêtre minuteur (min)
ALTER TABLE public.platform_settings DROP COLUMN IF EXISTS cod_unlock_orders;

-- ---------------------------------------------------------------------------
-- 2. customers : drapeau pénalité (booléen, PAS de montant). Suppression debt_da.
-- ---------------------------------------------------------------------------
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS noshow_pending BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 3. Revert generate_delivery_ledger_on_complete à la version 0103 (sans
--    cash_shortfall) AVANT de droguer les colonnes 0114.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_delivery_ledger_on_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s               public.platform_settings%ROWTYPE;
  v_products_da     INTEGER;
  v_comm_rate       NUMERIC(5, 4);
  v_cashback_rate   NUMERIC(5, 4);
  v_commission      INTEGER;
  v_service_fee     INTEGER;
  v_delivery_fee    INTEGER;
  v_driver_fee      INTEGER;
  v_driver_net      INTEGER;
  v_cashback        INTEGER;
  v_owes_merchant   INTEGER;
  v_owes_platform   INTEGER;
BEGIN
  IF NOT (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed'
          AND NEW.fulfillment_type = 'delivery'
          AND NEW.delivery_driver_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_s FROM public.platform_settings WHERE id = true;

  v_products_da  := GREATEST(0, COALESCE(NEW.net_total_da, NEW.subtotal_da - NEW.discount_da));
  v_service_fee  := COALESCE(NEW.service_fee_da, 0);
  v_delivery_fee := COALESCE(NEW.delivery_fee_da, 0);

  IF NEW.payment_method = 'cash' THEN
    v_comm_rate     := public.resolve_rate(NEW.merchant_id, 'commission_cash');
    v_cashback_rate := public.resolve_rate(NEW.merchant_id, 'cashback_cash');
  ELSE
    v_comm_rate     := public.resolve_rate(NEW.merchant_id, 'commission_online');
    v_cashback_rate := public.resolve_rate(NEW.merchant_id, 'cashback_online');
  END IF;

  v_commission := round(v_products_da * v_comm_rate)::INTEGER;

  IF v_delivery_fee <= 0 THEN
    v_driver_fee := 0;
  ELSE
    v_driver_fee := LEAST(
      v_delivery_fee,
      GREATEST(
        v_s.driver_fee_min_da,
        LEAST(round(v_delivery_fee * v_s.driver_fee_rate)::INTEGER,
              round(v_delivery_fee * v_s.driver_fee_cap_rate)::INTEGER)
      )
    );
  END IF;
  v_driver_net := v_delivery_fee - v_driver_fee;

  UPDATE public.orders
     SET driver_fee_rate_applied   = v_s.driver_fee_rate,
         driver_fee_da             = v_driver_fee,
         driver_net_da             = v_driver_net,
         commission_rate_applied   = COALESCE(commission_rate_applied, v_comm_rate),
         commission_da             = COALESCE(commission_da, v_commission)
   WHERE id = NEW.id;

  INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
  VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_payout', v_driver_net, NULL)
  ON CONFLICT (order_id, type) DO NOTHING;

  IF NEW.payment_method = 'cash' THEN
    v_cashback := round(v_products_da * v_cashback_rate)::INTEGER;
    v_cashback := LEAST(v_cashback,
                        (v_products_da / 2),
                        GREATEST(v_commission + v_service_fee + v_delivery_fee, 0));

    v_owes_merchant := GREATEST(v_products_da - v_commission, 0);
    v_owes_platform := GREATEST(v_commission + v_service_fee + v_driver_fee - v_cashback, 0);

    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_cash_collected', NEW.total_da, NULL)
    ON CONFLICT (order_id, type) DO NOTHING;

    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_owes_merchant', v_owes_merchant, NULL)
    ON CONFLICT (order_id, type) DO NOTHING;

    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_owes_platform', v_owes_platform, NULL)
    ON CONFLICT (order_id, type) DO NOTHING;

    UPDATE public.orders
       SET driver_owes_platform_da  = v_owes_platform,
           driver_owes_merchant_da  = v_owes_merchant,
           driver_cash_collected_da = NEW.total_da,
           cashback_rate_applied    = COALESCE(cashback_rate_applied, v_cashback_rate)
     WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. validate_delivery : revert à 4 arguments (plus de paiement partiel).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.validate_delivery(UUID, TEXT, BOOLEAN, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION public.validate_delivery(
  p_order_id        UUID,
  p_provided_code   TEXT,
  p_skip_code       BOOLEAN DEFAULT false,
  p_client_operation_id TEXT DEFAULT NULL
) RETURNS TABLE(ok BOOLEAN, reason TEXT) AS $$
DECLARE
  v_user UUID := auth.uid();
  v_driver_id UUID;
  v_order      public.orders%ROWTYPE;
  v_prepaid    BOOLEAN;
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = v_user;
  IF v_driver_id IS NULL THEN
    ok := false; reason := 'not_a_driver'; RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    ok := false; reason := 'order_not_found'; RETURN NEXT; RETURN;
  END IF;

  IF v_order.fulfillment_type <> 'delivery' THEN
    ok := false; reason := 'not_a_delivery'; RETURN NEXT; RETURN;
  END IF;
  IF v_order.delivery_driver_id IS NULL OR v_order.delivery_driver_id <> v_driver_id THEN
    ok := false; reason := 'not_attributed_to_you'; RETURN NEXT; RETURN;
  END IF;

  IF v_order.status = 'completed' THEN
    ok := true; reason := 'already_delivered'; RETURN NEXT; RETURN;
  END IF;

  v_prepaid := (v_order.payment_method = 'online')
            OR (COALESCE(v_order.cashback_used_da, 0) > 0)
            OR (COALESCE(v_order.topup_used_da, 0) > 0);

  IF v_prepaid THEN
    IF p_skip_code OR p_provided_code IS NULL OR btrim(p_provided_code) = '' THEN
      ok := false; reason := 'code_required'; RETURN NEXT; RETURN;
    END IF;
    IF p_provided_code <> v_order.pickup_code THEN
      ok := false; reason := 'bad_code'; RETURN NEXT; RETURN;
    END IF;
  ELSE
    IF NOT p_skip_code AND p_provided_code IS NOT NULL AND btrim(p_provided_code) <> '' THEN
      IF p_provided_code <> v_order.pickup_code THEN
        ok := false; reason := 'bad_code'; RETURN NEXT; RETURN;
      END IF;
    END IF;
  END IF;

  UPDATE public.orders
    SET status = 'completed',
        delivery_delivered_at = now(),
        validated_without_code =
          (p_provided_code IS NULL OR btrim(p_provided_code) = '' OR p_skip_code)
          AND NOT v_prepaid
    WHERE id = p_order_id;

  UPDATE public.tour_stops
    SET status = 'delivered', delivered_at = now()
    WHERE order_id = p_order_id AND status = 'pending';

  INSERT INTO public.order_events (order_id, from_status, to_status, client_operation_id, note)
    VALUES (p_order_id, v_order.status, 'completed', NULL,
            CASE WHEN p_client_operation_id IS NOT NULL
                 THEN 'driver_validation:' || p_client_operation_id
                 ELSE 'driver_validation' END)
    ON CONFLICT DO NOTHING;

  IF v_order.delivery_mode = 'express' THEN
    UPDATE public.driver_availability
      SET status = 'available', current_order_id = NULL
      WHERE current_order_id = p_order_id;
  END IF;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.validate_delivery(UUID, TEXT, BOOLEAN, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Suppression des colonnes créance/partiel (après revert des fonctions).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.recover_customer_debt(UUID, INTEGER);
ALTER TABLE public.customers DROP COLUMN IF EXISTS debt_da;
ALTER TABLE public.orders DROP COLUMN IF EXISTS cash_shortfall_da;
ALTER TABLE public.orders DROP COLUMN IF EXISTS debt_recovered_da;

-- ---------------------------------------------------------------------------
-- 6. Protection des champs de risque (sans debt_da ; + noshow_pending).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_customer_risk_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('app.allow_risk_update', true) IS DISTINCT FROM 'on' THEN
    NEW.cod_blocked    := OLD.cod_blocked;
    NEW.noshow_count   := OLD.noshow_count;
    NEW.noshow_pending := OLD.noshow_pending;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_customer_risk_fields_trg ON public.customers;
CREATE TRIGGER protect_customer_risk_fields_trg
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.protect_customer_risk_fields();

-- ---------------------------------------------------------------------------
-- 7. customer_cod_allowed : COD dispo SAUF blocage dur (admin). Pas de gating
--    par compteur de commandes (Yassir ne bloque pas les comptes neufs).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_cod_allowed(p_customer_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT NOT cod_blocked FROM public.customers WHERE id = p_customer_id), false);
$$;

GRANT EXECUTE ON FUNCTION public.customer_cod_allowed(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Refund cashback/topup sur annulation : NE PAS rembourser un no-show.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_customer_cashback_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status = 'cancelled'
     AND OLD.status IS DISTINCT FROM 'cancelled'
     AND OLD.status IS DISTINCT FROM 'completed'
     AND NEW.delivery_failed_at IS NULL            -- ⛔ pas de remboursement si no-show
     AND NEW.customer_id IS NOT NULL
     AND COALESCE(NEW.cashback_used_da, 0) > 0 THEN
    INSERT INTO public.customer_wallet_entries
      (customer_id, order_id, type, source, amount_da, note)
    VALUES
      (NEW.customer_id, NEW.id, 'adjustment', 'cashback',
       NEW.cashback_used_da,
       'Annulation commande — re-crédit du cashback utilisé.')
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refund_customer_topup_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status = 'cancelled'
     AND OLD.status IS DISTINCT FROM 'cancelled'
     AND OLD.status IS DISTINCT FROM 'completed'
     AND NEW.delivery_failed_at IS NULL            -- ⛔ pas de remboursement si no-show
     AND NEW.customer_id IS NOT NULL
     AND COALESCE(NEW.topup_used_da, 0) > 0 THEN
    INSERT INTO public.customer_wallet_entries
      (customer_id, order_id, type, source, amount_da, note)
    VALUES
      (NEW.customer_id, NEW.id, 'topup_credit', 'topup',
       NEW.topup_used_da,
       'Annulation commande — re-crédit du Coligo Pay utilisé.')
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 9. driver_report_no_show — minuteur + prélèvement wallet + pénalité douce.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_report_no_show(
  p_order_id            UUID,
  p_reason              TEXT DEFAULT 'no_show',
  p_client_operation_id TEXT DEFAULT NULL
) RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user         UUID := auth.uid();
  v_driver_id    UUID;
  v_order        public.orders%ROWTYPE;
  v_s            public.platform_settings%ROWTYPE;
  v_delivery_fee INTEGER;
  v_driver_fee   INTEGER;
  v_driver_net   INTEGER;
  v_reason       TEXT;
  v_wait         INTEGER;
  v_required_min INTEGER;
  v_client_replied BOOLEAN;
  v_liability    INTEGER;
  v_recovered    INTEGER := 0;
  v_take         INTEGER;
  v_bal          INTEGER;
  v_label        TEXT;
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = v_user;
  IF v_driver_id IS NULL THEN ok := false; reason := 'not_a_driver'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN ok := false; reason := 'order_not_found'; RETURN NEXT; RETURN; END IF;
  IF v_order.fulfillment_type <> 'delivery' THEN
    ok := false; reason := 'not_a_delivery'; RETURN NEXT; RETURN; END IF;
  IF v_order.delivery_driver_id IS NULL OR v_order.delivery_driver_id <> v_driver_id THEN
    ok := false; reason := 'not_attributed_to_you'; RETURN NEXT; RETURN; END IF;
  IF v_order.status IN ('completed', 'cancelled') THEN
    ok := false; reason := 'already_closed'; RETURN NEXT; RETURN; END IF;
  IF v_order.delivery_picked_up_at IS NULL THEN
    ok := false; reason := 'not_picked_up'; RETURN NEXT; RETURN; END IF;
  -- Le livreur doit être ARRIVÉ pour lancer le minuteur.
  IF v_order.delivery_arrived_at IS NULL THEN
    ok := false; reason := 'not_arrived'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_s FROM public.platform_settings WHERE id = true;
  v_wait := GREATEST(1, COALESCE(v_s.noshow_wait_min, 8));

  -- Le client a-t-il répondu en messagerie depuis l'arrivée ? Sinon on double
  -- la fenêtre (il ne trouve peut-être juste pas le livreur dehors).
  SELECT EXISTS (
    SELECT 1 FROM public.order_messages m
     WHERE m.order_id = p_order_id
       AND m.sender_role = 'customer'
       AND m.created_at > v_order.delivery_arrived_at
  ) INTO v_client_replied;
  v_required_min := CASE WHEN v_client_replied THEN v_wait ELSE v_wait * 2 END;

  IF now() < v_order.delivery_arrived_at + make_interval(mins => v_required_min) THEN
    ok := false; reason := 'too_early'; RETURN NEXT; RETURN;
  END IF;

  v_reason := COALESCE(NULLIF(btrim(p_reason), ''), 'no_show');
  IF v_reason NOT IN ('no_show', 'refused') THEN v_reason := 'no_show'; END IF;

  v_delivery_fee := COALESCE(v_order.delivery_fee_da, 0);
  IF v_delivery_fee <= 0 THEN
    v_driver_fee := 0;
  ELSE
    v_driver_fee := LEAST(
      v_delivery_fee,
      GREATEST(v_s.driver_fee_min_da,
        LEAST(round(v_delivery_fee * v_s.driver_fee_rate)::INTEGER,
              round(v_delivery_fee * v_s.driver_fee_cap_rate)::INTEGER)));
  END IF;
  v_driver_net := v_delivery_fee - v_driver_fee;

  -- 1) Commande annulée + tracée. NB : delivery_failed_at posé → les triggers
  --    refund cashback/topup SKIPPENT (pas de remboursement d'un no-show).
  UPDATE public.orders
     SET status                  = 'cancelled',
         delivery_failed_at      = now(),
         delivery_failed_reason  = v_reason,
         driver_fee_rate_applied = v_s.driver_fee_rate,
         driver_fee_da           = v_driver_fee,
         driver_net_da           = v_driver_net
   WHERE id = p_order_id;

  INSERT INTO public.order_events (order_id, from_status, to_status, client_operation_id, note)
  VALUES (p_order_id, v_order.status, 'cancelled', NULL,
          'driver_no_show:' || v_reason || ':' || COALESCE(p_client_operation_id, ''))
  ON CONFLICT DO NOTHING;

  -- 2) Indemnité livreur : UNE course (driver_net), « à recevoir » au relevé.
  IF v_driver_net > 0 THEN
    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (v_driver_id, v_order.merchant_id, p_order_id, 'driver_payout', v_driver_net,
            'Indemnité course no-show (client absent/refus).')
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  -- 3) Prélèvement client : on récupère la course (D) sur cashback PUIS Coligo
  --    Pay, si dispo. Aucune créance : ce qui reste non couvert déclenche juste
  --    le drapeau pénalité (frais de service relevés ≤ plafond sur 1 commande).
  IF v_order.customer_id IS NOT NULL THEN
    v_liability := GREATEST(0, v_delivery_fee);
    v_label := 'Pénalité no-show — commande ' || COALESCE(v_order.order_number, left(v_order.id::text, 8));

    -- cashback d'abord
    v_bal := COALESCE(public.customer_cashback_balance(v_order.customer_id), 0);
    v_take := LEAST(GREATEST(v_liability - v_recovered, 0), GREATEST(v_bal, 0));
    IF v_take > 0 THEN
      INSERT INTO public.customer_wallet_entries
        (customer_id, order_id, type, source, amount_da, note)
      VALUES (v_order.customer_id, NULL, 'adjustment', 'cashback', -v_take, v_label);
      v_recovered := v_recovered + v_take;
    END IF;

    -- puis Coligo Pay (topup)
    v_bal := COALESCE(public.customer_topup_balance(v_order.customer_id), 0);
    v_take := LEAST(GREATEST(v_liability - v_recovered, 0), GREATEST(v_bal, 0));
    IF v_take > 0 THEN
      INSERT INTO public.customer_wallet_entries
        (customer_id, order_id, type, source, amount_da, note)
      VALUES (v_order.customer_id, NULL, 'adjustment', 'topup', -v_take, v_label);
      v_recovered := v_recovered + v_take;
    END IF;

    PERFORM set_config('app.allow_risk_update', 'on', true);
    UPDATE public.customers
       SET noshow_count   = noshow_count + 1,
           -- pénalité prochaine commande seulement si pas tout récupéré
           noshow_pending = noshow_pending OR (v_liability - v_recovered) > 0
     WHERE id = v_order.customer_id;
  END IF;

  -- 4) Express : libérer le livreur.
  IF v_order.delivery_mode = 'express' THEN
    UPDATE public.driver_availability
       SET status = 'available', current_order_id = NULL
     WHERE current_order_id = p_order_id;
  END IF;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_report_no_show(UUID, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. Lever le drapeau noshow_pending dès qu'une commande est HONORÉE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_noshow_pending_on_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed'
     AND NEW.customer_id IS NOT NULL THEN
    PERFORM set_config('app.allow_risk_update', 'on', true);
    UPDATE public.customers
       SET noshow_pending = false
     WHERE id = NEW.customer_id AND noshow_pending = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clear_noshow_pending_on_complete_trg ON public.orders;
CREATE TRIGGER clear_noshow_pending_on_complete_trg
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.clear_noshow_pending_on_complete();

-- ---------------------------------------------------------------------------
-- 11. admin_set_customer_cod : recours super-admin (bloc/débloc + reset pénalité).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_customer_cod(
  p_customer_id UUID,
  p_blocked     BOOLEAN,
  p_clear_debt  BOOLEAN DEFAULT false   -- conservé pour compat : remet pénalité à zéro
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  PERFORM set_config('app.allow_risk_update', 'on', true);
  UPDATE public.customers
     SET cod_blocked    = p_blocked,
         noshow_pending = CASE WHEN p_clear_debt THEN false ELSE noshow_pending END
   WHERE id = p_customer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_customer_cod(UUID, BOOLEAN, BOOLEAN) TO authenticated;
