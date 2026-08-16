-- =============================================================================
-- 0454 — FIDÉLITÉ : fonctions atomiques (résolution, crédit, déduction,
--         liaison, blocage/transfert, config, lots) — SPEC-FIDELITE Phase 1
-- =============================================================================
-- Conventions maison appliquées partout :
--   • RETURNS JSONB { ok, error } — jamais d'exception pour un cas métier ;
--   • idempotence : garde longueur du client_operation_id + pré-lecture +
--     rattrapage unique_violation (patron coligo_pay_execute, 0084) ;
--   • verrou : pg_advisory_xact_lock(hashtext('loyalty:'||account)) avant tout
--     mouvement (patron 0070/0084) ;
--   • REVOKE ALL puis GRANT ciblé sur chaque fonction ; helpers internes sans
--     aucun GRANT (appelés uniquement depuis les DEFINER).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. HELPERS INTERNES (aucun GRANT)
-- ---------------------------------------------------------------------------

-- Code de carte : 16 caractères Crockford (≈ 80 bits), non séquentiel.
CREATE OR REPLACE FUNCTION public.loyalty_generate_card_code()
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH b AS (SELECT extensions.gen_random_bytes(16) AS bytes)
  SELECT string_agg(
           substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                  (get_byte(b.bytes, i) % 32) + 1, 1),
           '' ORDER BY i)
  FROM b, generate_series(0, 15) AS i;
$$;
REVOKE ALL ON FUNCTION public.loyalty_generate_card_code() FROM PUBLIC, anon, authenticated;

-- Normalise une saisie de code carte (espaces/tirets tolérés, casse libre).
CREATE OR REPLACE FUNCTION public.loyalty_normalize_code(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN v ~ '^[A-HJ-NP-Z2-9]{16}$' THEN v ELSE NULL END
  FROM (SELECT upper(regexp_replace(COALESCE(p, ''), '[\s-]', '', 'g')) AS v) s;
$$;
REVOKE ALL ON FUNCTION public.loyalty_normalize_code(text) FROM PUBLIC, anon, authenticated;

-- Détection du TYPE d'identifiant fidélité, côté serveur (spec 2.1) :
--   coligo:user:<handle>  → QR personnel du client (son compte SERT de carte)
--   URL …/c/<code>        → QR imprimé sur la carte physique
--   <code> 16 car.        → numéro saisi à la main
CREATE OR REPLACE FUNCTION public.loyalty_parse_identifier(
  p_raw text,
  OUT o_kind text,   -- 'handle' | 'card' | NULL
  OUT o_value text
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v text := btrim(COALESCE(p_raw, ''));
  m text;
BEGIN
  o_kind := NULL; o_value := NULL;
  IF v = '' THEN RETURN; END IF;

  m := substring(v FROM '(?i)^coligo:user:(.+)$');
  IF m IS NOT NULL THEN
    o_kind := 'handle'; o_value := btrim(m); RETURN;
  END IF;

  IF v ~* '/c/' THEN
    m := public.loyalty_normalize_code(substring(v FROM '(?i)/c/([A-Za-z0-9 -]{10,40})'));
  ELSE
    m := public.loyalty_normalize_code(v);
  END IF;
  IF m IS NOT NULL THEN
    o_kind := 'card'; o_value := m;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_parse_identifier(text) FROM PUBLIC, anon, authenticated;

-- Rate-limit best-effort (security_rate_hit 0452) — FAIL-OPEN comme le helper TS.
CREATE OR REPLACE FUNCTION public.loyalty_rate_ok(
  p_bucket text, p_subject text, p_max integer, p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN COALESCE(
    (public.security_rate_hit(p_bucket, p_subject, p_max, p_window_seconds, 1)->>'allowed')::boolean,
    true);
EXCEPTION WHEN OTHERS THEN
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_rate_ok(text, text, integer, integer) FROM PUBLIC, anon, authenticated;

-- Compte « programme » du commerçant (contrepartie), créé au premier besoin.
CREATE OR REPLACE FUNCTION public.loyalty_program_account(p_merchant uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v uuid;
BEGIN
  SELECT id INTO v FROM public.loyalty_accounts
   WHERE merchant_id = p_merchant AND owner_kind = 'program';
  IF v IS NOT NULL THEN RETURN v; END IF;
  INSERT INTO public.loyalty_accounts (merchant_id, owner_kind)
  VALUES (p_merchant, 'program')
  ON CONFLICT (merchant_id) WHERE owner_kind = 'program' DO NOTHING;
  SELECT id INTO v FROM public.loyalty_accounts
   WHERE merchant_id = p_merchant AND owner_kind = 'program';
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_program_account(uuid) FROM PUBLIC, anon, authenticated;

-- Compte porteur (client OU carte anonyme), créé au premier besoin.
CREATE OR REPLACE FUNCTION public.loyalty_get_or_create_account(
  p_merchant uuid, p_customer uuid, p_card uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v uuid;
BEGIN
  IF p_customer IS NOT NULL THEN
    SELECT id INTO v FROM public.loyalty_accounts
     WHERE merchant_id = p_merchant AND customer_id = p_customer AND owner_kind = 'customer';
    IF v IS NOT NULL THEN RETURN v; END IF;
    INSERT INTO public.loyalty_accounts (merchant_id, owner_kind, customer_id)
    VALUES (p_merchant, 'customer', p_customer)
    ON CONFLICT (merchant_id, customer_id) WHERE owner_kind = 'customer' DO NOTHING;
    SELECT id INTO v FROM public.loyalty_accounts
     WHERE merchant_id = p_merchant AND customer_id = p_customer AND owner_kind = 'customer';
    RETURN v;
  END IF;
  SELECT id INTO v FROM public.loyalty_accounts
   WHERE merchant_id = p_merchant AND card_id = p_card AND owner_kind = 'card';
  IF v IS NOT NULL THEN RETURN v; END IF;
  INSERT INTO public.loyalty_accounts (merchant_id, owner_kind, card_id)
  VALUES (p_merchant, 'card', p_card)
  ON CONFLICT (merchant_id, card_id) WHERE owner_kind = 'card' DO NOTHING;
  SELECT id INTO v FROM public.loyalty_accounts
   WHERE merchant_id = p_merchant AND card_id = p_card AND owner_kind = 'card';
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_get_or_create_account(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Compte porteur SANS création (lectures).
CREATE OR REPLACE FUNCTION public.loyalty_find_account(
  p_merchant uuid, p_customer uuid, p_card uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM public.loyalty_accounts
   WHERE merchant_id = p_merchant
     AND ((p_customer IS NOT NULL AND owner_kind = 'customer' AND customer_id = p_customer)
       OR (p_customer IS NULL AND owner_kind = 'card' AND card_id = p_card))
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.loyalty_find_account(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Solde d'un compte = SUM(grand livre). Jamais stocké ailleurs.
CREATE OR REPLACE FUNCTION public.loyalty_account_balance(p_account uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(amount_da), 0)::int
  FROM public.loyalty_entries WHERE account_id = p_account;
$$;
REVOKE ALL ON FUNCTION public.loyalty_account_balance(uuid) FROM PUBLIC, anon, authenticated;

-- Valeur des bons ACTIFS portés par le compte.
CREATE OR REPLACE FUNCTION public.loyalty_account_voucher_value(p_account uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(amount_da), 0)::int
  FROM public.loyalty_vouchers WHERE account_id = p_account AND status = 'granted';
$$;
REVOKE ALL ON FUNCTION public.loyalty_account_voucher_value(uuid) FROM PUBLIC, anon, authenticated;

-- Progression vers le prochain palier : achats cumulés (crédits + progression
-- importée par transfert) − paliers déjà consommés (snapshot sur chaque bon,
-- rattaché au compte d'ORIGINE — immuable, donc robuste aux transferts).
CREATE OR REPLACE FUNCTION public.loyalty_account_progress(p_account uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(0,
    COALESCE((SELECT SUM(COALESCE(purchase_amount_da, 0)) FROM public.loyalty_entries
               WHERE account_id = p_account AND type IN ('credit', 'transfer_in')), 0)
    - COALESCE((SELECT SUM(progress_consumed_da) FROM public.loyalty_vouchers
               WHERE granted_account_id = p_account AND progress_consumed_da IS NOT NULL), 0)
  )::int;
$$;
REVOKE ALL ON FUNCTION public.loyalty_account_progress(uuid) FROM PUBLIC, anon, authenticated;

-- Valeur créditée sur les 24 dernières heures (plafond anti-fraude).
CREATE OR REPLACE FUNCTION public.loyalty_daily_used(p_account uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(amount_da), 0)::int
  FROM public.loyalty_entries
  WHERE account_id = p_account AND amount_da > 0
    AND type IN ('credit', 'voucher_grant', 'link_bonus')
    AND created_at >= now() - interval '24 hours';
$$;
REVOKE ALL ON FUNCTION public.loyalty_daily_used(uuid) FROM PUBLIC, anon, authenticated;

-- Expiration PARESSEUSE des bons échus d'un compte (appelée au point de vente
-- et dans l'app — pas besoin de cron pour être juste au moment décisif).
CREATE OR REPLACE FUNCTION public.loyalty_expire_due(p_account uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v public.loyalty_vouchers%ROWTYPE;
  v_prog uuid;
  v_n integer := 0;
BEGIN
  FOR v IN
    SELECT * FROM public.loyalty_vouchers
     WHERE account_id = p_account AND status = 'granted' AND expires_at < now()
     FOR UPDATE
  LOOP
    v_prog := public.loyalty_program_account(v.merchant_id);
    INSERT INTO public.loyalty_entries
      (account_id, merchant_id, counterparty_account_id, type, amount_da,
       voucher_id, client_operation_id, note)
    VALUES
      (v.account_id, v.merchant_id, v_prog, 'voucher_expire', -v.amount_da,
       v.id, 'vexp:' || v.id, 'Bon expiré'),
      (v_prog, v.merchant_id, v.account_id, 'voucher_expire', v.amount_da,
       v.id, 'vexp:' || v.id || ':p', NULL);
    UPDATE public.loyalty_vouchers SET status = 'expired' WHERE id = v.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_expire_due(uuid) FROM PUBLIC, anon, authenticated;

-- Machine à états des cartes — SEUL chemin de changement de statut.
CREATE OR REPLACE FUNCTION public.loyalty_card_transition(
  p_card_id uuid,
  p_to public.loyalty_card_status,
  p_actor text,
  p_actor_id uuid,
  p_note text DEFAULT NULL,
  p_customer uuid DEFAULT NULL,
  p_op text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v public.loyalty_cards%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.loyalty_cards WHERE id = p_card_id FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'loyalty_card_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v.status = p_to THEN RETURN; END IF;

  IF NOT (
    (v.status = 'printed'   AND p_to IN ('activated', 'linked', 'blocked')) OR
    (v.status = 'activated' AND p_to IN ('linked', 'blocked')) OR
    (v.status = 'linked'    AND p_to = 'blocked') OR
    (v.status = 'blocked'   AND p_to IN ('printed', 'activated', 'linked'))
  ) THEN
    RAISE EXCEPTION 'loyalty_invalid_transition:%->%', v.status, p_to
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.loyalty_cards SET
    status         = p_to,
    customer_id    = CASE WHEN p_to = 'linked' THEN COALESCE(p_customer, customer_id)
                          ELSE customer_id END,
    activated_at   = CASE WHEN p_to = 'activated' THEN COALESCE(activated_at, now())
                          ELSE activated_at END,
    linked_at      = CASE WHEN p_to = 'linked' THEN COALESCE(linked_at, now())
                          ELSE linked_at END,
    blocked_at     = CASE WHEN p_to = 'blocked' THEN now() ELSE NULL END,
    blocked_by     = CASE WHEN p_to = 'blocked' THEN p_actor ELSE NULL END,
    blocked_reason = CASE WHEN p_to = 'blocked' THEN p_note ELSE NULL END
  WHERE id = p_card_id;

  INSERT INTO public.loyalty_card_events
    (card_id, from_status, to_status, actor, actor_id, client_operation_id, note)
  VALUES (p_card_id, v.status, p_to, p_actor, p_actor_id, p_op, p_note);
END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_card_transition(uuid, public.loyalty_card_status, text, uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- Résolution d'un identifiant scanné/saisi → carte et/ou client porteur.
CREATE OR REPLACE FUNCTION public.loyalty_resolve_target(
  p_identifier text,
  p_lock boolean DEFAULT false,
  OUT o_error text,          -- 'not_found' | 'blocked' | NULL
  OUT o_kind text,           -- 'card' | 'customer'
  OUT o_card public.loyalty_cards,
  OUT o_customer uuid,
  OUT o_customer_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind text;
  v_val  text;
BEGIN
  SELECT p.o_kind, p.o_value INTO v_kind, v_val
  FROM public.loyalty_parse_identifier(p_identifier) p;

  IF v_kind IS NULL THEN o_error := 'not_found'; RETURN; END IF;

  IF v_kind = 'handle' THEN
    SELECT c.id, c.full_name INTO o_customer, o_customer_name
    FROM public.customers c WHERE c.pay_handle = v_val;
    IF o_customer IS NULL THEN o_error := 'not_found'; RETURN; END IF;
    o_kind := 'customer';
    RETURN;
  END IF;

  IF p_lock THEN
    SELECT * INTO o_card FROM public.loyalty_cards WHERE card_code = v_val FOR UPDATE;
  ELSE
    SELECT * INTO o_card FROM public.loyalty_cards WHERE card_code = v_val;
  END IF;
  IF o_card.id IS NULL THEN o_error := 'not_found'; RETURN; END IF;
  o_kind := 'card';
  IF o_card.status = 'blocked' THEN o_error := 'blocked'; RETURN; END IF;
  IF o_card.customer_id IS NOT NULL THEN
    o_customer := o_card.customer_id;
    SELECT full_name INTO o_customer_name FROM public.customers WHERE id = o_customer;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_resolve_target(text, boolean) FROM PUBLIC, anon, authenticated;

-- Étiquette affichée en caisse : prénom si identifié, sinon n° masqué.
CREATE OR REPLACE FUNCTION public.loyalty_display_label(
  p_customer_name text, p_card_code text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN btrim(COALESCE(p_customer_name, '')) <> ''
      THEN split_part(btrim(p_customer_name), ' ', 1)
    WHEN p_card_code IS NOT NULL
      THEN 'Carte •••• ' || right(p_card_code, 4)
    ELSE 'Client'
  END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_display_label(text, text) FROM PUBLIC, anon, authenticated;

-- Bloc « solde + bons + progression » d'un compte (NULL-safe : compte absent
-- = tout à zéro), avec les règles du programme pour la barre de progression.
CREATE OR REPLACE FUNCTION public.loyalty_account_summary(
  p_account uuid,
  p_threshold integer,
  p_reward integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance integer := 0;
  v_vval    integer := 0;
  v_prog    integer := 0;
  v_vouchers jsonb := '[]'::jsonb;
BEGIN
  IF p_account IS NOT NULL THEN
    v_balance := public.loyalty_account_balance(p_account);
    v_vval    := public.loyalty_account_voucher_value(p_account);
    v_prog    := public.loyalty_account_progress(p_account);
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', id, 'amount_da', amount_da, 'expires_at', expires_at
           ) ORDER BY expires_at), '[]'::jsonb)
      INTO v_vouchers
      FROM public.loyalty_vouchers
     WHERE account_id = p_account AND status = 'granted' AND expires_at >= now();
  END IF;

  RETURN jsonb_build_object(
    'balance_da', v_balance,
    'available_da', GREATEST(0, v_balance - v_vval),
    'vouchers', v_vouchers,
    'progress', CASE WHEN p_threshold IS NULL THEN NULL ELSE jsonb_build_object(
      'spent_da', v_prog,
      'threshold_da', p_threshold,
      'reward_da', p_reward,
      'remaining_da', GREATEST(0, p_threshold - v_prog)
    ) END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_account_summary(uuid, integer, integer) FROM PUBLIC, anon, authenticated;

-- Transfert de TOUS les comptes d'une carte (anonyme) vers un client ou une
-- carte de remplacement : solde + progression + bons, commerçant par
-- commerçant (le cloisonnement est préservé par construction — même
-- merchant_id de bout en bout, garanti par les FK composites).
CREATE OR REPLACE FUNCTION public.loyalty_move_accounts(
  p_card uuid, p_to_customer uuid, p_to_card uuid, p_op text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_acc RECORD;
  v_bal integer;
  v_prog integer;
  v_vcount integer;
  v_target uuid;
  v_moved jsonb := '[]'::jsonb;
BEGIN
  FOR v_acc IN
    SELECT a.id, a.merchant_id, m.name AS merchant_name
      FROM public.loyalty_accounts a
      JOIN public.merchants m ON m.id = a.merchant_id
     WHERE a.card_id = p_card AND a.owner_kind = 'card'
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('loyalty:' || v_acc.id));
    v_bal  := public.loyalty_account_balance(v_acc.id);
    v_prog := public.loyalty_account_progress(v_acc.id);
    SELECT count(*) INTO v_vcount FROM public.loyalty_vouchers
     WHERE account_id = v_acc.id AND status = 'granted';
    CONTINUE WHEN v_bal = 0 AND v_prog = 0 AND v_vcount = 0;

    v_target := public.loyalty_get_or_create_account(v_acc.merchant_id, p_to_customer, p_to_card);
    PERFORM pg_advisory_xact_lock(hashtext('loyalty:' || v_target));

    INSERT INTO public.loyalty_entries
      (account_id, merchant_id, counterparty_account_id, type, amount_da,
       client_operation_id, note)
    VALUES
      (v_acc.id, v_acc.merchant_id, v_target, 'transfer_out', -v_bal, p_op,
       'Transfert de solde fidélité');
    INSERT INTO public.loyalty_entries
      (account_id, merchant_id, counterparty_account_id, type, amount_da,
       purchase_amount_da, client_operation_id, note)
    VALUES
      (v_target, v_acc.merchant_id, v_acc.id, 'transfer_in', v_bal,
       NULLIF(v_prog, 0), p_op, 'Transfert de solde fidélité');

    UPDATE public.loyalty_vouchers SET account_id = v_target
     WHERE account_id = v_acc.id AND status = 'granted';

    v_moved := v_moved || jsonb_build_object(
      'merchant_id', v_acc.merchant_id,
      'merchant_name', v_acc.merchant_name,
      'amount_da', v_bal,
      'vouchers', v_vcount
    );
  END LOOP;
  RETURN v_moved;
END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_move_accounts(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. CÔTÉ COMMERÇANT — scanner unifié (fiche), crédit, déduction
-- ---------------------------------------------------------------------------

-- Fiche fidélité du porteur CHEZ CE COMMERÇANT (lecture seule : ne crée aucun
-- compte, n'active pas la carte — l'activation vit dans loyalty_credit).
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
    -- Bons échus purgés AVANT affichage (jamais montrer une valeur morte).
    BEGIN
      PERFORM public.loyalty_expire_due(v_account);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'kind', r.o_kind,
    'linked', r.o_customer IS NOT NULL,
    'label', public.loyalty_display_label(r.o_customer_name, (r.o_card).card_code),
    'card_status', (r.o_card).status,
    'will_activate', ((r.o_card).status = 'printed'),
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
REVOKE ALL ON FUNCTION public.loyalty_resolve_scan(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.loyalty_resolve_scan(text) TO authenticated;

-- CRÉDIT en caisse : le caissier saisit le montant de l'achat du jour.
-- Active une carte `printed` au passage (premier scan en caisse = activation).
-- Idempotent (client_operation_id) ; plafond de valeur / 24 h par compte ;
-- paliers débloqués dans la même transaction (différés si plafond atteint).
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
  v_settings public.loyalty_platform_settings%ROWTYPE;
  r RECORD;
  v_account uuid;
  v_prog_acc uuid;
  v_prev public.loyalty_entries%ROWTYPE;
  v_earn integer;
  v_used integer;
  v_capped boolean := false;
  v_activated boolean := false;
  v_progress integer;
  v_voucher_id uuid;
  v_granted jsonb := '[]'::jsonb;
  v_expires timestamptz;
  v_n integer := 0;
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

  SELECT * INTO v_settings FROM public.loyalty_platform_settings WHERE id = 1;
  IF p_purchase_da IS NULL OR p_purchase_da <= 0
     OR p_purchase_da > v_settings.max_purchase_per_credit_da THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount',
                              'max_da', v_settings.max_purchase_per_credit_da);
  END IF;

  SELECT * INTO v_program FROM public.loyalty_programs WHERE merchant_id = v_merchant;
  IF v_program.merchant_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_program');
  END IF;
  IF NOT v_program.enabled THEN
    RETURN jsonb_build_object('ok', false, 'error', 'program_disabled');
  END IF;

  -- FOR UPDATE sur la carte : sérialise avec une liaison simultanée (sinon un
  -- crédit pourrait atterrir sur un compte-carte déjà transféré).
  SELECT * INTO r FROM public.loyalty_resolve_target(p_identifier, true);
  IF r.o_error IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', r.o_error);
  END IF;

  IF r.o_customer IS NOT NULL THEN
    v_account := public.loyalty_get_or_create_account(v_merchant, r.o_customer, NULL);
  ELSE
    v_account := public.loyalty_get_or_create_account(v_merchant, NULL, (r.o_card).id);
  END IF;

  -- (a) Idempotence par pré-lecture : rejeu (double scan, resync hors-ligne)
  --     = même réponse, zéro double crédit. Cherché à l'échelle du COMMERÇANT :
  --     si la carte a été liée entre l'appel et le rejeu, le compte a changé
  --     mais l'opération reste reconnue.
  SELECT * INTO v_prev FROM public.loyalty_entries
   WHERE merchant_id = v_merchant AND client_operation_id = p_client_operation_id
     AND type = 'credit' AND amount_da >= 0;
  IF v_prev.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'already', true,
      'earned_da', v_prev.amount_da,
      'label', public.loyalty_display_label(r.o_customer_name, (r.o_card).card_code),
      'summary', public.loyalty_account_summary(
        v_account, v_program.tier_threshold_da, v_program.tier_reward_da));
  END IF;

  -- Anti-rafale : nombre d'opérations de crédit par compte / 24 h.
  IF NOT public.loyalty_rate_ok('loyalty_credit_acc', v_account::text, 40, 86400) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('loyalty:' || v_account));
  PERFORM public.loyalty_expire_due(v_account);

  -- Activation au premier crédit en caisse (un lot volé `printed` ne vaut rien
  -- tant qu'aucun commerçant authentifié ne l'a activé).
  IF r.o_kind = 'card' AND (r.o_card).status = 'printed' THEN
    PERFORM public.loyalty_card_transition(
      (r.o_card).id, 'activated', 'merchant', v_merchant,
      'Activée au premier crédit en caisse', NULL, p_client_operation_id);
    v_activated := true;
  END IF;

  -- Cashback, borné par le plafond / 24 h (clampe ; zéro restant = refus).
  v_earn := round(p_purchase_da * v_program.earn_rate_pct / 100.0)::int;
  v_used := public.loyalty_daily_used(v_account);
  IF v_earn > 0 THEN
    IF v_used >= v_program.daily_credit_cap_da THEN
      RETURN jsonb_build_object('ok', false, 'error', 'cap_reached');
    END IF;
    IF v_used + v_earn > v_program.daily_credit_cap_da THEN
      v_earn := v_program.daily_credit_cap_da - v_used;
      v_capped := true;
    END IF;
  END IF;

  v_prog_acc := public.loyalty_program_account(v_merchant);

  BEGIN
    INSERT INTO public.loyalty_entries
      (account_id, merchant_id, counterparty_account_id, type, amount_da,
       purchase_amount_da, order_id, client_operation_id, created_by)
    VALUES
      (v_account, v_merchant, v_prog_acc, 'credit', v_earn,
       p_purchase_da, p_order_id, p_client_operation_id, auth.uid());
  EXCEPTION WHEN unique_violation THEN
    -- (b) Idempotence par contrainte : course entre deux rejeux simultanés.
    RETURN jsonb_build_object(
      'ok', true, 'already', true,
      'label', public.loyalty_display_label(r.o_customer_name, (r.o_card).card_code),
      'summary', public.loyalty_account_summary(
        v_account, v_program.tier_threshold_da, v_program.tier_reward_da));
  END;
  INSERT INTO public.loyalty_entries
    (account_id, merchant_id, counterparty_account_id, type, amount_da,
     order_id, client_operation_id, created_by)
  VALUES
    (v_prog_acc, v_merchant, v_account, 'credit', -v_earn,
     p_order_id, p_client_operation_id || ':p', auth.uid());

  -- Paliers : « tous les X DA dépensés → bon de Y DA », répétable. Un palier
  -- qui dépasserait le plafond / 24 h est DIFFÉRÉ (la progression reste, le
  -- bon partira au prochain crédit).
  IF v_program.tier_threshold_da IS NOT NULL THEN
    v_progress := public.loyalty_account_progress(v_account);
    WHILE v_progress >= v_program.tier_threshold_da AND v_n < 10 LOOP
      EXIT WHEN public.loyalty_daily_used(v_account) + v_program.tier_reward_da
                > v_program.daily_credit_cap_da;
      v_expires := now() + make_interval(days => v_program.voucher_validity_days);
      INSERT INTO public.loyalty_vouchers
        (account_id, merchant_id, granted_account_id, amount_da,
         progress_consumed_da, expires_at)
      VALUES
        (v_account, v_merchant, v_account, v_program.tier_reward_da,
         v_program.tier_threshold_da, v_expires)
      RETURNING id INTO v_voucher_id;
      INSERT INTO public.loyalty_entries
        (account_id, merchant_id, counterparty_account_id, type, amount_da,
         voucher_id, client_operation_id)
      VALUES
        (v_account, v_merchant, v_prog_acc, 'voucher_grant',
         v_program.tier_reward_da, v_voucher_id, 'vgrant:' || v_voucher_id),
        (v_prog_acc, v_merchant, v_account, 'voucher_grant',
         -v_program.tier_reward_da, v_voucher_id, 'vgrant:' || v_voucher_id || ':p');
      v_granted := v_granted || jsonb_build_object(
        'id', v_voucher_id, 'amount_da', v_program.tier_reward_da, 'expires_at', v_expires);
      v_progress := v_progress - v_program.tier_threshold_da;
      v_n := v_n + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'already', false,
    'earned_da', v_earn,
    'capped', v_capped,
    'activated', v_activated,
    'vouchers_granted', v_granted,
    'label', public.loyalty_display_label(r.o_customer_name, (r.o_card).card_code),
    'summary', public.loyalty_account_summary(
      v_account, v_program.tier_threshold_da, v_program.tier_reward_da));
END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_credit(text, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.loyalty_credit(text, integer, text, uuid) TO authenticated;

-- DÉDUCTION en caisse : un BON précis (p_voucher_id) OU un montant de cashback
-- (p_amount_da). Atomique, idempotente, EXIGE la connexion (jamais en file
-- hors-ligne — anti double-dépense, spec 2.5). Reste possible programme
-- désactivé : la valeur déjà gagnée est honorée.
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
  v_prog_acc uuid;
  v_prev public.loyalty_entries%ROWTYPE;
  v_voucher public.loyalty_vouchers%ROWTYPE;
  v_amount integer;
  v_available integer;
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
  IF (p_voucher_id IS NULL) = (p_amount_da IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_args');
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

  SELECT * INTO v_prev FROM public.loyalty_entries
   WHERE merchant_id = v_merchant AND client_operation_id = p_client_operation_id
     AND type IN ('redeem', 'voucher_redeem') AND amount_da <= 0;
  IF v_prev.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'already', true, 'deducted_da', -v_prev.amount_da,
      'summary', public.loyalty_account_summary(
        v_account, v_program.tier_threshold_da, v_program.tier_reward_da));
  END IF;

  IF NOT public.loyalty_rate_ok('loyalty_redeem_acc', v_account::text, 40, 86400) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('loyalty:' || v_account));
  PERFORM public.loyalty_expire_due(v_account);
  v_prog_acc := public.loyalty_program_account(v_merchant);

  IF p_voucher_id IS NOT NULL THEN
    SELECT * INTO v_voucher FROM public.loyalty_vouchers
     WHERE id = p_voucher_id AND account_id = v_account FOR UPDATE;
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
        (v_account, v_merchant, v_prog_acc, 'voucher_redeem', -v_amount,
         v_voucher.id, p_client_operation_id, auth.uid());
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', true, 'already', true, 'deducted_da', v_amount,
        'summary', public.loyalty_account_summary(
          v_account, v_program.tier_threshold_da, v_program.tier_reward_da));
    END;
    INSERT INTO public.loyalty_entries
      (account_id, merchant_id, counterparty_account_id, type, amount_da,
       voucher_id, client_operation_id, created_by)
    VALUES
      (v_prog_acc, v_merchant, v_account, 'voucher_redeem', v_amount,
       v_voucher.id, p_client_operation_id || ':p', auth.uid());
    UPDATE public.loyalty_vouchers
       SET status = 'redeemed', redeemed_at = now() WHERE id = v_voucher.id;
  ELSE
    IF p_amount_da <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
    END IF;
    v_available := GREATEST(0, public.loyalty_account_balance(v_account)
                               - public.loyalty_account_voucher_value(v_account));
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
        (v_account, v_merchant, v_prog_acc, 'redeem', -v_amount,
         p_client_operation_id, auth.uid());
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', true, 'already', true, 'deducted_da', v_amount,
        'summary', public.loyalty_account_summary(
          v_account, v_program.tier_threshold_da, v_program.tier_reward_da));
    END;
    INSERT INTO public.loyalty_entries
      (account_id, merchant_id, counterparty_account_id, type, amount_da,
       client_operation_id, created_by)
    VALUES
      (v_prog_acc, v_merchant, v_account, 'redeem', v_amount,
       p_client_operation_id || ':p', auth.uid());
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'already', false,
    'deducted_da', v_amount,
    'label', public.loyalty_display_label(r.o_customer_name, (r.o_card).card_code),
    'summary', public.loyalty_account_summary(
      v_account, v_program.tier_threshold_da, v_program.tier_reward_da));
END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_redeem(text, text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.loyalty_redeem(text, text, uuid, integer) TO authenticated;

-- État du programme pour l'écran de config commerçant (+ bornes + mini-stats).
CREATE OR REPLACE FUNCTION public.merchant_loyalty_state()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_merchant uuid;
  v_program public.loyalty_programs%ROWTYPE;
  v_settings public.loyalty_platform_settings%ROWTYPE;
  v_prog_acc uuid;
BEGIN
  SELECT id INTO v_merchant FROM public.merchants WHERE user_id = auth.uid();
  IF v_merchant IS NULL THEN
    RAISE EXCEPTION 'not_a_merchant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_settings FROM public.loyalty_platform_settings WHERE id = 1;
  SELECT * INTO v_program FROM public.loyalty_programs WHERE merchant_id = v_merchant;
  SELECT id INTO v_prog_acc FROM public.loyalty_accounts
   WHERE merchant_id = v_merchant AND owner_kind = 'program';

  RETURN jsonb_build_object(
    'program', CASE WHEN v_program.merchant_id IS NULL THEN NULL ELSE jsonb_build_object(
      'enabled', v_program.enabled,
      'earn_rate_pct', v_program.earn_rate_pct,
      'tier_threshold_da', v_program.tier_threshold_da,
      'tier_reward_da', v_program.tier_reward_da,
      'voucher_validity_days', v_program.voucher_validity_days,
      'daily_credit_cap_da', v_program.daily_credit_cap_da,
      'link_bonus_da', v_program.link_bonus_da
    ) END,
    'bounds', jsonb_build_object(
      'min_earn_rate_pct', v_settings.min_earn_rate_pct,
      'max_earn_rate_pct', v_settings.max_earn_rate_pct,
      'min_tier_threshold_da', v_settings.min_tier_threshold_da,
      'max_tier_reward_da', v_settings.max_tier_reward_da,
      'max_daily_credit_cap_da', v_settings.max_daily_credit_cap_da,
      'max_link_bonus_da', v_settings.max_link_bonus_da,
      'min_voucher_validity_days', v_settings.min_voucher_validity_days,
      'max_voucher_validity_days', v_settings.max_voucher_validity_days
    ),
    'stats', jsonb_build_object(
      'members', (SELECT count(*) FROM public.loyalty_accounts a
                   WHERE a.merchant_id = v_merchant AND a.owner_kind <> 'program'
                     AND EXISTS (SELECT 1 FROM public.loyalty_entries e
                                  WHERE e.account_id = a.id)),
      'outstanding_da', COALESCE(-(SELECT SUM(e.amount_da) FROM public.loyalty_entries e
                                    WHERE e.account_id = v_prog_acc), 0),
      'earned_30d_da', COALESCE((SELECT SUM(e.amount_da) FROM public.loyalty_entries e
                                  JOIN public.loyalty_accounts a ON a.id = e.account_id
                                 WHERE e.merchant_id = v_merchant
                                   AND a.owner_kind <> 'program' AND e.amount_da > 0
                                   AND e.type IN ('credit', 'voucher_grant', 'link_bonus')
                                   AND e.created_at >= now() - interval '30 days'), 0),
      'redeemed_30d_da', COALESCE(-(SELECT SUM(e.amount_da) FROM public.loyalty_entries e
                                     JOIN public.loyalty_accounts a ON a.id = e.account_id
                                    WHERE e.merchant_id = v_merchant
                                      AND a.owner_kind <> 'program' AND e.amount_da < 0
                                      AND e.type IN ('redeem', 'voucher_redeem')
                                      AND e.created_at >= now() - interval '30 days'), 0)
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.merchant_loyalty_state() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merchant_loyalty_state() TO authenticated;

-- Config du programme par le commerçant — TOUJOURS toutes les valeurs (jamais
-- de patch partiel, cf. piège « champ retiré = colonne effacée »). Bornes
-- re-vérifiées ici (codes propres) ET par le trigger (bypass-proof).
CREATE OR REPLACE FUNCTION public.merchant_update_loyalty_program(
  p_enabled boolean,
  p_earn_rate_pct numeric,
  p_tier_threshold_da integer,
  p_tier_reward_da integer,
  p_voucher_validity_days integer,
  p_daily_credit_cap_da integer,
  p_link_bonus_da integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_merchant uuid;
  s public.loyalty_platform_settings%ROWTYPE;
BEGIN
  SELECT id INTO v_merchant FROM public.merchants WHERE user_id = auth.uid();
  IF v_merchant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_merchant');
  END IF;
  SELECT * INTO s FROM public.loyalty_platform_settings WHERE id = 1;

  IF p_earn_rate_pct IS NULL OR p_earn_rate_pct < s.min_earn_rate_pct
     OR p_earn_rate_pct > s.max_earn_rate_pct THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bounds_earn_rate',
      'min', s.min_earn_rate_pct, 'max', s.max_earn_rate_pct);
  END IF;
  IF (p_tier_threshold_da IS NULL) <> (p_tier_reward_da IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bounds_tier_pair');
  END IF;
  IF p_tier_threshold_da IS NOT NULL AND p_tier_threshold_da < s.min_tier_threshold_da THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bounds_tier_threshold',
      'min', s.min_tier_threshold_da);
  END IF;
  IF p_tier_reward_da IS NOT NULL
     AND (p_tier_reward_da <= 0 OR p_tier_reward_da > s.max_tier_reward_da) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bounds_tier_reward',
      'max', s.max_tier_reward_da);
  END IF;
  IF p_voucher_validity_days IS NULL
     OR p_voucher_validity_days < s.min_voucher_validity_days
     OR p_voucher_validity_days > s.max_voucher_validity_days THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bounds_validity',
      'min', s.min_voucher_validity_days, 'max', s.max_voucher_validity_days);
  END IF;
  IF p_daily_credit_cap_da IS NULL OR p_daily_credit_cap_da <= 0
     OR p_daily_credit_cap_da > s.max_daily_credit_cap_da THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bounds_daily_cap',
      'max', s.max_daily_credit_cap_da);
  END IF;
  IF p_link_bonus_da IS NULL OR p_link_bonus_da < 0
     OR p_link_bonus_da > s.max_link_bonus_da THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bounds_link_bonus',
      'max', s.max_link_bonus_da);
  END IF;

  INSERT INTO public.loyalty_programs
    (merchant_id, enabled, earn_rate_pct, tier_threshold_da, tier_reward_da,
     voucher_validity_days, daily_credit_cap_da, link_bonus_da, updated_by)
  VALUES
    (v_merchant, COALESCE(p_enabled, false), p_earn_rate_pct, p_tier_threshold_da,
     p_tier_reward_da, p_voucher_validity_days, p_daily_credit_cap_da,
     p_link_bonus_da, auth.uid())
  ON CONFLICT (merchant_id) DO UPDATE SET
    enabled               = EXCLUDED.enabled,
    earn_rate_pct         = EXCLUDED.earn_rate_pct,
    tier_threshold_da     = EXCLUDED.tier_threshold_da,
    tier_reward_da        = EXCLUDED.tier_reward_da,
    voucher_validity_days = EXCLUDED.voucher_validity_days,
    daily_credit_cap_da   = EXCLUDED.daily_credit_cap_da,
    link_bonus_da         = EXCLUDED.link_bonus_da,
    updated_by            = EXCLUDED.updated_by,
    updated_at            = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.merchant_update_loyalty_program(boolean, numeric, integer, integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merchant_update_loyalty_program(boolean, numeric, integer, integer, integer, integer, integer)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. CÔTÉ CLIENT — liaison, vue d'ensemble, historique, blocage
-- ---------------------------------------------------------------------------

-- Liaison d'une carte au compte : transfert des soldes/bons/progression vers
-- les comptes du client (par commerçant), puis la carte devient un alias.
-- Une carte ne se lie qu'à UN seul compte, à vie.
CREATE OR REPLACE FUNCTION public.loyalty_link_card(
  p_card_code text,
  p_client_operation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer uuid;
  v_code text;
  v_card public.loyalty_cards%ROWTYPE;
  v_moved jsonb;
  v_bonus integer := 0;
  v_bonus_merchant text := NULL;
  v_program public.loyalty_programs%ROWTYPE;
  v_account uuid;
  v_prog_acc uuid;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_customer');
  END IF;
  IF public.feature_blocked('loyalty') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'feature_disabled');
  END IF;
  IF NOT public.loyalty_rate_ok('loyalty_link_cust', v_customer::text, 10, 86400) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  -- Accepte le code tapé OU l'URL du QR scanné.
  SELECT p.o_value INTO v_code
  FROM public.loyalty_parse_identifier(p_card_code) p WHERE p.o_kind = 'card';
  IF v_code IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT * INTO v_card FROM public.loyalty_cards WHERE card_code = v_code FOR UPDATE;
  IF v_card.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_card.status = 'blocked' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'blocked');
  END IF;
  IF v_card.customer_id IS NOT NULL THEN
    IF v_card.customer_id = v_customer THEN
      RETURN jsonb_build_object('ok', true, 'already', true, 'moved', '[]'::jsonb,
                                'bonus_da', 0);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'already_linked');
  END IF;

  -- Transfert AVANT la transition (les comptes-carte existent encore).
  v_moved := public.loyalty_move_accounts(
    v_card.id, v_customer, NULL,
    COALESCE(p_client_operation_id, 'link:' || v_card.id));

  PERFORM public.loyalty_card_transition(
    v_card.id, 'linked', 'customer', v_customer,
    'Carte liée au compte', v_customer,
    COALESCE(p_client_operation_id, 'link:' || v_card.id));

  -- Bonus de liaison du commerçant du lot (si configuré et programme actif).
  IF v_card.merchant_id IS NOT NULL THEN
    SELECT * INTO v_program FROM public.loyalty_programs
     WHERE merchant_id = v_card.merchant_id;
    IF v_program.enabled AND v_program.link_bonus_da > 0 THEN
      v_account := public.loyalty_get_or_create_account(v_card.merchant_id, v_customer, NULL);
      v_prog_acc := public.loyalty_program_account(v_card.merchant_id);
      PERFORM pg_advisory_xact_lock(hashtext('loyalty:' || v_account));
      BEGIN
        INSERT INTO public.loyalty_entries
          (account_id, merchant_id, counterparty_account_id, type, amount_da,
           client_operation_id, note)
        VALUES
          (v_account, v_card.merchant_id, v_prog_acc, 'link_bonus',
           v_program.link_bonus_da, 'lbonus:' || v_card.id, 'Bonus de liaison de carte'),
          (v_prog_acc, v_card.merchant_id, v_account, 'link_bonus',
           -v_program.link_bonus_da, 'lbonus:' || v_card.id || ':p', NULL);
        v_bonus := v_program.link_bonus_da;
        SELECT name INTO v_bonus_merchant FROM public.merchants WHERE id = v_card.merchant_id;
      EXCEPTION WHEN unique_violation THEN
        NULL; -- bonus déjà versé (rejeu)
      END;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'already', false,
    'moved', v_moved,
    'bonus_da', v_bonus,
    'bonus_merchant', v_bonus_merchant
  );
END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_link_card(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.loyalty_link_card(text, text) TO authenticated;

-- Vue d'ensemble « Cashback & Fidélité » : une carte-magasin par commerçant,
-- cloisonnement rendu ÉVIDENT par la structure même de la réponse.
CREATE OR REPLACE FUNCTION public.my_loyalty_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer uuid;
  v_handle text := NULL;
  v_accounts jsonb;
  v_cards jsonb;
  v_acc RECORD;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'not_a_customer' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Purge paresseuse des bons échus (best-effort — l'affichage reste juste).
  FOR v_acc IN
    SELECT a.id FROM public.loyalty_accounts a
     WHERE a.customer_id = v_customer AND a.owner_kind = 'customer'
  LOOP
    BEGIN
      PERFORM public.loyalty_expire_due(v_acc.id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;

  -- Le QR personnel réutilise le handle Coligo Pay (le compte SERT de carte).
  BEGIN
    v_handle := public.coligo_pay_my_handle();
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  SELECT COALESCE(jsonb_agg(row_json ORDER BY last_at DESC NULLS LAST), '[]'::jsonb)
    INTO v_accounts
  FROM (
    SELECT
      jsonb_build_object(
        'merchant_id', m.id,
        'merchant_name', m.name,
        'merchant_slug', m.slug,
        'merchant_logo', m.logo_url,
        'program', CASE WHEN p.merchant_id IS NULL THEN NULL ELSE jsonb_build_object(
          'enabled', p.enabled,
          'earn_rate_pct', p.earn_rate_pct,
          'tier_threshold_da', p.tier_threshold_da,
          'tier_reward_da', p.tier_reward_da
        ) END,
        'summary', public.loyalty_account_summary(a.id, p.tier_threshold_da, p.tier_reward_da)
      ) AS row_json,
      (SELECT max(e.created_at) FROM public.loyalty_entries e
        WHERE e.account_id = a.id) AS last_at
    FROM public.loyalty_accounts a
    JOIN public.merchants m ON m.id = a.merchant_id
    LEFT JOIN public.loyalty_programs p ON p.merchant_id = a.merchant_id
    WHERE a.customer_id = v_customer AND a.owner_kind = 'customer'
      AND EXISTS (SELECT 1 FROM public.loyalty_entries e WHERE e.account_id = a.id)
  ) t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'code_masked', '•••• ' || right(c.card_code, 4),
           'status', c.status,
           'merchant_name', m.name
         ) ORDER BY c.linked_at DESC), '[]'::jsonb)
    INTO v_cards
  FROM public.loyalty_cards c
  LEFT JOIN public.merchants m ON m.id = c.merchant_id
  WHERE c.customer_id = v_customer;

  RETURN jsonb_build_object(
    'handle', v_handle,
    'accounts', v_accounts,
    'cards', v_cards
  );
END;
$$;
REVOKE ALL ON FUNCTION public.my_loyalty_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_loyalty_overview() TO authenticated;

-- Historique des gains/utilisations (tous commerçants ou un seul).
CREATE OR REPLACE FUNCTION public.my_loyalty_history(
  p_merchant_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid, merchant_id uuid, merchant_name text,
  type public.loyalty_entry_type, amount_da integer,
  purchase_amount_da integer, note text, created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.id, e.merchant_id, m.name, e.type, e.amount_da,
         e.purchase_amount_da, e.note, e.created_at
  FROM public.loyalty_entries e
  JOIN public.loyalty_accounts a ON a.id = e.account_id
  JOIN public.merchants m ON m.id = e.merchant_id
  WHERE a.owner_kind = 'customer'
    AND a.customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
    AND (p_merchant_id IS NULL OR e.merchant_id = p_merchant_id)
  ORDER BY e.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$$;
REVOKE ALL ON FUNCTION public.my_loyalty_history(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_loyalty_history(uuid, integer) TO authenticated;

-- Blocage d'une carte LIÉE par son propriétaire (perte/vol). Le solde ne
-- bouge pas : il vit déjà sur le compte client.
CREATE OR REPLACE FUNCTION public.my_loyalty_block_card(p_card_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer uuid;
  v_card public.loyalty_cards%ROWTYPE;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_customer');
  END IF;
  SELECT * INTO v_card FROM public.loyalty_cards
   WHERE id = p_card_id AND customer_id = v_customer FOR UPDATE;
  IF v_card.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_card.status = 'blocked' THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;
  PERFORM public.loyalty_card_transition(
    v_card.id, 'blocked', 'customer', v_customer, 'Bloquée par le client');
  RETURN jsonb_build_object('ok', true, 'already', false);
END;
$$;
REVOKE ALL ON FUNCTION public.my_loyalty_block_card(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_loyalty_block_card(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. LANDING PUBLIQUE (/c/<code>) — consultation LIMITÉE, anonyme.
--    JAMAIS de donnée personnelle (règle propriétaire) : une carte liée ne
--    montre NI nom NI solde — juste « déjà liée à un compte ».
-- ---------------------------------------------------------------------------
-- (VOLATILE : le compteur de rate-limit s'incrémente à chaque consultation.)
CREATE OR REPLACE FUNCTION public.loyalty_card_public_peek(p_card_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text;
  v_card public.loyalty_cards%ROWTYPE;
  v_balances jsonb;
  v_total integer;
  v_brand_name text;
  v_brand_logo text;
BEGIN
  v_code := public.loyalty_normalize_code(p_card_code);
  IF v_code IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF NOT public.loyalty_rate_ok('loyalty_peek', v_code, 60, 3600) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  SELECT * INTO v_card FROM public.loyalty_cards WHERE card_code = v_code;
  IF v_card.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT m.name, m.logo_url INTO v_brand_name, v_brand_logo
  FROM public.merchants m WHERE m.id = v_card.merchant_id;

  IF v_card.status = 'blocked' THEN
    RETURN jsonb_build_object('ok', true, 'status', 'blocked',
                              'brand_name', v_brand_name, 'brand_logo', v_brand_logo);
  END IF;
  IF v_card.customer_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'status', 'linked',
                              'brand_name', v_brand_name, 'brand_logo', v_brand_logo);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'merchant_name', m.name,
           'merchant_logo', m.logo_url,
           'balance_da', b.bal,
           'vouchers_da', b.vval
         ) ORDER BY b.bal DESC), '[]'::jsonb),
         COALESCE(SUM(b.bal), 0)::int
    INTO v_balances, v_total
  FROM (
    SELECT a.merchant_id,
           public.loyalty_account_balance(a.id) AS bal,
           public.loyalty_account_voucher_value(a.id) AS vval
    FROM public.loyalty_accounts a
    WHERE a.card_id = v_card.id AND a.owner_kind = 'card'
  ) b
  JOIN public.merchants m ON m.id = b.merchant_id
  WHERE b.bal > 0 OR b.vval > 0;

  RETURN jsonb_build_object(
    'ok', true,
    'status', v_card.status,      -- printed | activated
    'brand_name', v_brand_name,
    'brand_logo', v_brand_logo,
    'total_da', v_total,
    'balances', v_balances
  );
END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_card_public_peek(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.loyalty_card_public_peek(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. SUPER-ADMIN — bornes, lots, blocage/déblocage, transfert, recherche
--    Garde : admin_can('commercants') + trace admin_audit_log.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_loyalty_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.loyalty_platform_settings%ROWTYPE;
BEGIN
  IF NOT public.admin_can('commercants') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO s FROM public.loyalty_platform_settings WHERE id = 1;
  RETURN to_jsonb(s);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_loyalty_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_loyalty_update_settings(
  p_min_earn_rate_pct numeric,
  p_max_earn_rate_pct numeric,
  p_min_tier_threshold_da integer,
  p_max_tier_reward_da integer,
  p_max_daily_credit_cap_da integer,
  p_max_link_bonus_da integer,
  p_min_voucher_validity_days integer,
  p_max_voucher_validity_days integer,
  p_max_purchase_per_credit_da integer,
  p_max_batch_quantity integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old jsonb;
BEGIN
  IF NOT public.admin_can('commercants') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_min_earn_rate_pct IS NULL OR p_max_earn_rate_pct IS NULL
     OR p_min_earn_rate_pct < 0 OR p_max_earn_rate_pct > 100
     OR p_min_earn_rate_pct > p_max_earn_rate_pct
     OR COALESCE(p_min_tier_threshold_da, 0) <= 0
     OR COALESCE(p_max_tier_reward_da, 0) <= 0
     OR COALESCE(p_max_daily_credit_cap_da, 0) <= 0
     OR COALESCE(p_max_link_bonus_da, -1) < 0
     OR COALESCE(p_min_voucher_validity_days, 0) <= 0
     OR COALESCE(p_max_voucher_validity_days, 0) < COALESCE(p_min_voucher_validity_days, 0)
     OR COALESCE(p_max_purchase_per_credit_da, 0) <= 0
     OR COALESCE(p_max_batch_quantity, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_bounds');
  END IF;

  SELECT to_jsonb(s) INTO v_old FROM public.loyalty_platform_settings s WHERE id = 1;

  UPDATE public.loyalty_platform_settings SET
    min_earn_rate_pct          = p_min_earn_rate_pct,
    max_earn_rate_pct          = p_max_earn_rate_pct,
    min_tier_threshold_da      = p_min_tier_threshold_da,
    max_tier_reward_da         = p_max_tier_reward_da,
    max_daily_credit_cap_da    = p_max_daily_credit_cap_da,
    max_link_bonus_da          = p_max_link_bonus_da,
    min_voucher_validity_days  = p_min_voucher_validity_days,
    max_voucher_validity_days  = p_max_voucher_validity_days,
    max_purchase_per_credit_da = p_max_purchase_per_credit_da,
    max_batch_quantity         = p_max_batch_quantity,
    updated_by                 = auth.uid(),
    updated_at                 = now()
  WHERE id = 1;

  INSERT INTO public.admin_audit_log
    (admin_email, action, target_kind, target_id, note, old_value, new_value)
  VALUES (
    COALESCE(NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''), 'inconnu'),
    'loyalty.bounds_update', 'loyalty_settings', NULL,
    'Bornes fidélité mises à jour', v_old,
    (SELECT to_jsonb(s) FROM public.loyalty_platform_settings s WHERE id = 1)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_loyalty_update_settings(numeric, numeric, integer, integer, integer, integer, integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_update_settings(numeric, numeric, integer, integer, integer, integer, integer, integer, integer, integer)
  TO authenticated;

-- Génération d'un LOT de cartes pré-enregistrées `printed` (Phase 4 : le PDF
-- lit ce lot). Codes uniques à haute entropie, reprise sur collision.
CREATE OR REPLACE FUNCTION public.admin_loyalty_create_batch(
  p_merchant_id uuid,
  p_quantity integer,
  p_template_key text DEFAULT 'classic',
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.loyalty_platform_settings%ROWTYPE;
  v_batch uuid;
  v_code text;
  i integer;
BEGIN
  IF NOT public.admin_can('commercants') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO s FROM public.loyalty_platform_settings WHERE id = 1;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > s.max_batch_quantity THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_quantity',
                              'max', s.max_batch_quantity);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.merchants WHERE id = p_merchant_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'merchant_not_found');
  END IF;

  INSERT INTO public.loyalty_card_batches
    (merchant_id, template_key, quantity, note, created_by)
  VALUES (p_merchant_id, COALESCE(NULLIF(btrim(p_template_key), ''), 'classic'),
          p_quantity, p_note, auth.uid())
  RETURNING id INTO v_batch;

  FOR i IN 1..p_quantity LOOP
    LOOP
      v_code := public.loyalty_generate_card_code();
      BEGIN
        INSERT INTO public.loyalty_cards (card_code, batch_id, merchant_id)
        VALUES (v_code, v_batch, p_merchant_id);
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        NULL; -- collision (≈ jamais à 80 bits) : on retire
      END;
    END LOOP;
  END LOOP;

  INSERT INTO public.admin_audit_log
    (admin_email, action, target_kind, target_id, note)
  VALUES (
    COALESCE(NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''), 'inconnu'),
    'loyalty.batch_create', 'loyalty_batch', v_batch,
    format('%s cartes pour le commerçant %s', p_quantity, p_merchant_id)
  );

  RETURN jsonb_build_object('ok', true, 'batch_id', v_batch, 'quantity', p_quantity);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_loyalty_create_batch(uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_create_batch(uuid, integer, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_loyalty_block_card(p_card_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_card public.loyalty_cards%ROWTYPE;
BEGIN
  IF NOT public.admin_can('commercants') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_card FROM public.loyalty_cards WHERE id = p_card_id FOR UPDATE;
  IF v_card.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_card.status = 'blocked' THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;
  PERFORM public.loyalty_card_transition(
    v_card.id, 'blocked', 'admin', auth.uid(),
    COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), 'Bloquée par l''équipe Coligo'));
  INSERT INTO public.admin_audit_log (admin_email, action, target_kind, target_id, note)
  VALUES (
    COALESCE(NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''), 'inconnu'),
    'loyalty.card_block', 'loyalty_card', p_card_id, p_note);
  RETURN jsonb_build_object('ok', true, 'already', false);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_loyalty_block_card(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_block_card(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_loyalty_unblock_card(p_card_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_card public.loyalty_cards%ROWTYPE;
  v_to public.loyalty_card_status;
BEGIN
  IF NOT public.admin_can('commercants') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_card FROM public.loyalty_cards WHERE id = p_card_id FOR UPDATE;
  IF v_card.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_card.status <> 'blocked' THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;
  v_to := CASE
    WHEN v_card.customer_id IS NOT NULL THEN 'linked'::public.loyalty_card_status
    WHEN v_card.activated_at IS NOT NULL THEN 'activated'::public.loyalty_card_status
    ELSE 'printed'::public.loyalty_card_status
  END;
  PERFORM public.loyalty_card_transition(
    v_card.id, v_to, 'admin', auth.uid(), 'Débloquée par l''équipe Coligo');
  INSERT INTO public.admin_audit_log (admin_email, action, target_kind, target_id)
  VALUES (
    COALESCE(NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''), 'inconnu'),
    'loyalty.card_unblock', 'loyalty_card', p_card_id);
  RETURN jsonb_build_object('ok', true, 'already', false);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_loyalty_unblock_card(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_unblock_card(uuid) TO authenticated;

-- Perte de carte ANONYME : blocage puis transfert de TOUT (soldes, bons,
-- progression) vers une carte de remplacement OU un compte client.
CREATE OR REPLACE FUNCTION public.admin_loyalty_transfer_card(
  p_from_card_id uuid,
  p_to_identifier text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from public.loyalty_cards%ROWTYPE;
  r RECORD;
  v_moved jsonb;
  v_op text;
BEGIN
  IF NOT public.admin_can('commercants') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_from FROM public.loyalty_cards WHERE id = p_from_card_id FOR UPDATE;
  IF v_from.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_from.status <> 'blocked' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_blocked');
  END IF;
  IF v_from.customer_id IS NOT NULL THEN
    -- Carte liée : le solde vit déjà sur le compte client, rien à transférer.
    RETURN jsonb_build_object('ok', false, 'reason', 'card_linked');
  END IF;

  SELECT * INTO r FROM public.loyalty_resolve_target(p_to_identifier, true);
  IF r.o_error IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'target_' || r.o_error);
  END IF;

  v_op := 'xfer:' || v_from.id;
  IF r.o_kind = 'card' THEN
    IF (r.o_card).customer_id IS NOT NULL OR (r.o_card).status = 'linked' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'target_linked');
    END IF;
    IF (r.o_card).status = 'printed' THEN
      PERFORM public.loyalty_card_transition(
        (r.o_card).id, 'activated', 'admin', auth.uid(), 'Carte de remplacement');
    END IF;
    v_moved := public.loyalty_move_accounts(v_from.id, NULL, (r.o_card).id, v_op);
  ELSE
    v_moved := public.loyalty_move_accounts(v_from.id, r.o_customer, NULL, v_op);
  END IF;

  INSERT INTO public.admin_audit_log (admin_email, action, target_kind, target_id, note, new_value)
  VALUES (
    COALESCE(NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''), 'inconnu'),
    'loyalty.card_transfer', 'loyalty_card', p_from_card_id, p_note, v_moved);

  RETURN jsonb_build_object('ok', true, 'moved', v_moved);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_loyalty_transfer_card(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_transfer_card(uuid, text, text) TO authenticated;

-- Recherche support : carte par code (état + soldes par commerçant + journal).
CREATE OR REPLACE FUNCTION public.admin_loyalty_card_lookup(p_query text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text;
  v_card public.loyalty_cards%ROWTYPE;
BEGIN
  IF NOT public.admin_can('commercants') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT p.o_value INTO v_code
  FROM public.loyalty_parse_identifier(p_query) p WHERE p.o_kind = 'card';
  IF v_code IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_query');
  END IF;
  SELECT * INTO v_card FROM public.loyalty_cards WHERE card_code = v_code;
  IF v_card.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'card', jsonb_build_object(
      'id', v_card.id, 'card_code', v_card.card_code, 'status', v_card.status,
      'customer_id', v_card.customer_id, 'batch_id', v_card.batch_id,
      'merchant_id', v_card.merchant_id, 'created_at', v_card.created_at,
      'activated_at', v_card.activated_at, 'linked_at', v_card.linked_at,
      'blocked_at', v_card.blocked_at, 'blocked_reason', v_card.blocked_reason
    ),
    'accounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'merchant_name', m.name,
        'balance_da', public.loyalty_account_balance(a.id),
        'vouchers_da', public.loyalty_account_voucher_value(a.id)
      ))
      FROM public.loyalty_accounts a
      JOIN public.merchants m ON m.id = a.merchant_id
      WHERE a.card_id = v_card.id AND a.owner_kind = 'card'
    ), '[]'::jsonb),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'from', from_status, 'to', to_status, 'actor', actor,
        'note', note, 'at', created_at
      ) ORDER BY created_at DESC)
      FROM (SELECT * FROM public.loyalty_card_events
             WHERE card_id = v_card.id ORDER BY created_at DESC LIMIT 10) ev
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_loyalty_card_lookup(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_card_lookup(text) TO authenticated;

-- Expiration GLOBALE (cron/maintenance) — l'expiration paresseuse au point de
-- vente reste la garantie de justesse au moment décisif.
CREATE OR REPLACE FUNCTION public.loyalty_expire_vouchers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_acc uuid;
  v_n integer := 0;
BEGIN
  IF public.feature_blocked('loyalty') THEN RETURN 0; END IF;
  FOR v_acc IN
    SELECT DISTINCT account_id FROM public.loyalty_vouchers
     WHERE status = 'granted' AND expires_at < now()
     LIMIT 500
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('loyalty:' || v_acc));
    v_n := v_n + public.loyalty_expire_due(v_acc);
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_expire_vouchers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.loyalty_expire_vouchers() TO service_role;

-- =============================================================================
-- VÉRIFICATION :
--   SELECT public.loyalty_card_public_peek('AAAAAAAAAAAAAAAA'); -- anon: not_found
--   SELECT public.loyalty_credit(...) sans session               -- not_merchant
--   npm run test:loyalty                                          -- suite complète
-- =============================================================================
