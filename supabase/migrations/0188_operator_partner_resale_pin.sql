-- =============================================================================
-- 0188 — Partenaire : PIN opérateur + revente de crédit SUM=0 (LOT 4)
-- =============================================================================
-- Le partenaire = `operator_wallets.is_partner=true` (créé/activé par l'admin au
-- LOT 6). Il recharge son solde en gros volume (LOT 3) puis REVEND du crédit à
-- un livreur/chauffeur : transfert double-entrée SUM=0, protégé par PIN, idempotent,
-- anti double-dépense (verrou + solde vérifié). Le bonus de rémunération est
-- crédité par l'admin via `admin_operator_credit` (type 'bonus', mig 0185).
--
-- PIN : copie fidèle du pattern Coligo Pay client (bcrypt, 5 essais → 15 min).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. SÉCURITÉ PIN par portefeuille
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.operator_wallet_security (
  wallet_id       UUID PRIMARY KEY REFERENCES public.operator_wallets(id) ON DELETE CASCADE,
  pin_hash        TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.operator_wallet_security ENABLE ROW LEVEL SECURITY;
-- aucune policy : accès uniquement via fonctions SECURITY DEFINER

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 2. PIN : définir / changer (4 chiffres, hashé bcrypt) — pour MON portefeuille
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operator_set_pin(p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_wallet UUID := public.my_operator_wallet();
BEGIN
  IF v_wallet IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_wallet');
  END IF;
  IF p_pin !~ '^[0-9]{4}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
  END IF;
  INSERT INTO public.operator_wallet_security (wallet_id, pin_hash, failed_attempts, locked_until, updated_at)
  VALUES (v_wallet, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), 0, NULL, now())
  ON CONFLICT (wallet_id) DO UPDATE
    SET pin_hash = EXCLUDED.pin_hash, failed_attempts = 0, locked_until = NULL, updated_at = now();
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.operator_set_pin(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. PIN : statut (défini ? verrouillé ?)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operator_pin_status()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_wallet UUID := public.my_operator_wallet(); v_row public.operator_wallet_security%ROWTYPE;
BEGIN
  IF v_wallet IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_wallet'); END IF;
  SELECT * INTO v_row FROM public.operator_wallet_security WHERE wallet_id = v_wallet;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'has_pin', false, 'locked', false); END IF;
  RETURN jsonb_build_object('ok', true, 'has_pin', true,
    'locked', (v_row.locked_until IS NOT NULL AND v_row.locked_until > now()),
    'locked_until', v_row.locked_until);
END;
$$;
GRANT EXECUTE ON FUNCTION public.operator_pin_status() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. PIN : vérification interne (lockout + bcrypt) — 'ok'|'wrong'|'locked'|'not_set'
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operator_pin_check_internal(p_wallet UUID, p_pin TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_row public.operator_wallet_security%ROWTYPE;
        v_max CONSTANT INTEGER := 5; v_lock CONSTANT INTERVAL := INTERVAL '15 minutes';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('opw_pin:' || p_wallet::text));
  SELECT * INTO v_row FROM public.operator_wallet_security WHERE wallet_id = p_wallet FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_set'; END IF;
  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN RETURN 'locked'; END IF;
  IF extensions.crypt(p_pin, v_row.pin_hash) = v_row.pin_hash THEN
    UPDATE public.operator_wallet_security SET failed_attempts = 0, locked_until = NULL, updated_at = now()
      WHERE wallet_id = p_wallet;
    RETURN 'ok';
  END IF;
  IF v_row.failed_attempts + 1 >= v_max THEN
    UPDATE public.operator_wallet_security SET failed_attempts = 0, locked_until = now() + v_lock, updated_at = now()
      WHERE wallet_id = p_wallet;
    RETURN 'locked';
  ELSE
    UPDATE public.operator_wallet_security SET failed_attempts = v_row.failed_attempts + 1, updated_at = now()
      WHERE wallet_id = p_wallet;
    RETURN 'wrong';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. PIN : vérification publique (déverrouillage écran) pour MON portefeuille
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operator_verify_pin(p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_wallet UUID := public.my_operator_wallet(); v_res TEXT;
BEGIN
  IF v_wallet IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_wallet'); END IF;
  v_res := public.operator_pin_check_internal(v_wallet, p_pin);
  RETURN jsonb_build_object('ok', v_res = 'ok', 'status', v_res);
END;
$$;
GRANT EXECUTE ON FUNCTION public.operator_verify_pin(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. RÉSOLUTION de l'acheteur par téléphone (livreur / chauffeur)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_operator_wallet_by_phone(p_phone TEXT)
RETURNS TABLE (wallet_id UUID, owner_type TEXT, name TEXT, status TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT w.id, 'driver', d.full_name, w.status
    FROM public.drivers d JOIN public.operator_wallets w
      ON w.owner_type = 'driver' AND w.owner_id = d.id
    WHERE d.phone = p_phone
  UNION ALL
  SELECT w.id, 'chauffeur', ch.full_name, w.status
    FROM public.chauffeurs ch JOIN public.operator_wallets w
      ON w.owner_type = 'chauffeur' AND w.owner_id = ch.id
    WHERE ch.phone = p_phone;
$$;
GRANT EXECUTE ON FUNCTION public.find_operator_wallet_by_phone(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. REVENTE DE CRÉDIT (partenaire → acheteur) — double-entrée SUM=0
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coligo_recharge_sell(
  p_target_wallet_id UUID, p_amount_da INTEGER, p_pin TEXT, p_op_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_seller UUID := public.my_operator_wallet();
  v_sw public.operator_wallets%ROWTYPE;
  v_tw public.operator_wallets%ROWTYPE;
  v_pin TEXT; v_existing UUID; v_bal INTEGER;
BEGIN
  IF v_seller IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_wallet'); END IF;
  IF p_op_id IS NULL OR length(trim(p_op_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_op_id'); END IF;
  IF p_amount_da IS NULL OR p_amount_da <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_amount'); END IF;
  IF p_target_wallet_id = v_seller THEN
    RETURN jsonb_build_object('ok', false, 'error', 'self_target'); END IF;

  -- verrou du vendeur (sérialise les ventes concurrentes → anti double-dépense)
  SELECT * INTO v_sw FROM public.operator_wallets WHERE id = v_seller FOR UPDATE;
  IF NOT v_sw.is_partner OR v_sw.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_active_partner'); END IF;

  SELECT * INTO v_tw FROM public.operator_wallets WHERE id = p_target_wallet_id;
  IF NOT FOUND OR v_tw.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'target_unavailable'); END IF;

  -- idempotence : si déjà vendu sous cet op_id, on renvoie le résultat
  SELECT id INTO v_existing FROM public.operator_wallet_entries
    WHERE wallet_id = v_seller AND client_operation_id = p_op_id;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true,
      'seller_balance', public.operator_balance(v_seller),
      'target_balance', public.operator_balance(p_target_wallet_id));
  END IF;

  -- PIN du vendeur
  v_pin := public.operator_pin_check_internal(v_seller, p_pin);
  IF v_pin <> 'ok' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pin_' || v_pin); END IF;

  -- solde suffisant (le partenaire ne descend pas sous 0)
  v_bal := public.operator_balance(v_seller);
  IF v_bal < p_amount_da THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient', 'balance', v_bal); END IF;

  -- double-entrée SUM=0
  INSERT INTO public.operator_wallet_entries
    (wallet_id, type, amount_da, counterparty_wallet_id, client_operation_id, note)
  VALUES
    (v_seller, 'recharge_sale', -p_amount_da, p_target_wallet_id, p_op_id, 'Revente de crédit'),
    (p_target_wallet_id, 'topup_partner', p_amount_da, v_seller, p_op_id, 'Recharge chez un point partenaire');

  RETURN jsonb_build_object('ok', true,
    'seller_balance', public.operator_balance(v_seller),
    'target_balance', public.operator_balance(p_target_wallet_id));
END;
$$;
GRANT EXECUTE ON FUNCTION public.coligo_recharge_sell(UUID,INTEGER,TEXT,TEXT) TO authenticated;
