-- =============================================================================
-- 0384 — Retrait Coligo Pay en libre-service (chauffeur / livreur)
-- =============================================================================
-- « Retirer » depuis le portefeuille Coligo Pay ouvrait la page Gains : aucun
-- retrait réel n'existait. On crée le flux SYMÉTRIQUE des recharges manuelles
-- (mig 0187) : le partenaire dépose une DEMANDE (montant + destination CCP /
-- BaridiMob), l'équipe Coligo la paie puis le solde est débité — écriture
-- `payout` (type déjà autorisé par 0271), idempotente, avec garde de solde.
--
-- Règles métier :
--   • réservé aux portefeuilles driver / chauffeur (le commerçant a DÉJÀ son
--     canal de versement : payout_requests / Finances) ;
--   • montant ≤ solde effectif (jamais de retrait à découvert) ;
--   • UNE seule demande en cours par portefeuille ;
--   • le débit n'a lieu qu'au PAIEMENT par l'admin, avec re-contrôle du solde.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.wallet_withdrawal_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id   UUID NOT NULL REFERENCES public.operator_wallets(id) ON DELETE CASCADE,
  method      TEXT NOT NULL CHECK (method IN ('ccp','baridimob')),
  amount_da   INTEGER NOT NULL CHECK (amount_da > 0),
  destination TEXT NOT NULL,           -- n° CCP (avec clé) ou RIP BaridiMob
  destination_name TEXT,               -- titulaire (optionnel)
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','paid','rejected')),
  review_note TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Accès UNIQUEMENT via RPC (definer) + service_role admin : RLS sans policy.
ALTER TABLE public.wallet_withdrawal_requests ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_wwr_pending
  ON public.wallet_withdrawal_requests (created_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_wwr_wallet
  ON public.wallet_withdrawal_requests (wallet_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 1. CRÉER UNE DEMANDE (opérateur, pour SON portefeuille)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_operator_withdrawal(
  p_method TEXT, p_amount_da INTEGER, p_destination TEXT, p_destination_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_wallet UUID := public.my_operator_wallet();
        v_owner TEXT; v_avail INTEGER; v_id UUID;
BEGIN
  IF v_wallet IS NULL THEN
    RAISE EXCEPTION 'Aucun portefeuille opérateur' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT owner_type INTO v_owner FROM public.operator_wallets WHERE id = v_wallet;
  IF v_owner NOT IN ('driver','chauffeur') THEN
    RAISE EXCEPTION 'Retrait indisponible pour ce profil' USING ERRCODE = 'check_violation';
  END IF;
  IF p_method NOT IN ('ccp','baridimob') THEN
    RAISE EXCEPTION 'Méthode invalide' USING ERRCODE = 'check_violation';
  END IF;
  IF p_destination IS NULL OR length(trim(p_destination)) < 6
     OR length(trim(p_destination)) > 40 THEN
    RAISE EXCEPTION 'Compte de destination invalide' USING ERRCODE = 'check_violation';
  END IF;
  v_avail := public.operator_effective_balance(v_wallet);
  IF p_amount_da < 100 OR p_amount_da > v_avail THEN
    RAISE EXCEPTION 'Montant hors limite (disponible : % DA)', v_avail
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wallet_withdrawal_requests
             WHERE wallet_id = v_wallet AND status = 'pending') THEN
    RAISE EXCEPTION 'Une demande de retrait est déjà en cours'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.wallet_withdrawal_requests
    (wallet_id, method, amount_da, destination, destination_name)
  VALUES (v_wallet, p_method, p_amount_da, trim(p_destination),
          NULLIF(trim(COALESCE(p_destination_name,'')), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_operator_withdrawal(TEXT,INTEGER,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_operator_withdrawal(TEXT,INTEGER,TEXT,TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. MES DEMANDES (suivi côté partenaire)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_operator_withdrawals(p_limit INT DEFAULT 10)
RETURNS TABLE (
  id UUID, method TEXT, amount_da INTEGER, destination TEXT,
  status TEXT, review_note TEXT, created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT w.id, w.method, w.amount_da, w.destination, w.status, w.review_note, w.created_at
  FROM public.wallet_withdrawal_requests w
  WHERE w.wallet_id = public.my_operator_wallet()
  ORDER BY w.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 10), 50));
$$;
REVOKE ALL ON FUNCTION public.my_operator_withdrawals(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_operator_withdrawals(INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. PAYER une demande (super-admin) → débit `payout` idempotent, solde gardé
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pay_withdrawal_request(p_request_id UUID)
RETURNS TABLE (entry_id UUID, new_balance_da INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.wallet_withdrawal_requests%ROWTYPE; v_admin UUID := auth.uid();
        v_email TEXT; v_op TEXT; v_entry UUID;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Réservé au super-admin' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO r FROM public.wallet_withdrawal_requests
    WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demande introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'Demande déjà traitée (%)', r.status USING ERRCODE = 'check_violation';
  END IF;
  -- Re-contrôle au PAIEMENT : le solde a pu baisser depuis la demande.
  IF public.operator_effective_balance(r.wallet_id) < r.amount_da THEN
    RAISE EXCEPTION 'Solde insuffisant au paiement' USING ERRCODE = 'check_violation';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_admin;
  v_op := 'wd_req:' || p_request_id::text;

  -- débit idempotent (une seule écriture par demande)
  SELECT id INTO v_entry FROM public.operator_wallet_entries
    WHERE wallet_id = r.wallet_id AND client_operation_id = v_op;
  IF v_entry IS NULL THEN
    INSERT INTO public.operator_wallet_entries
      (wallet_id, type, amount_da, note, created_by, client_operation_id)
    VALUES (r.wallet_id, 'payout', -r.amount_da,
            'Retrait ' || r.method || ' vers ' || r.destination
              || ' [admin:' || COALESCE(v_email,'?') || ']',
            v_admin, v_op)
    RETURNING id INTO v_entry;
  END IF;

  UPDATE public.wallet_withdrawal_requests
    SET status = 'paid', reviewed_by = v_admin, reviewed_at = now()
    WHERE id = p_request_id AND status <> 'paid';

  RETURN QUERY SELECT v_entry, public.operator_balance(r.wallet_id);
END;
$$;
REVOKE ALL ON FUNCTION public.pay_withdrawal_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_withdrawal_request(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. REFUSER une demande (super-admin)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_withdrawal_request(p_request_id UUID, p_note TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Réservé au super-admin' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.wallet_withdrawal_requests
    SET status = 'rejected', review_note = NULLIF(trim(COALESCE(p_note,'')), ''),
        reviewed_by = auth.uid(), reviewed_at = now()
    WHERE id = p_request_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demande introuvable ou déjà traitée' USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.reject_withdrawal_request(UUID,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_withdrawal_request(UUID,TEXT) TO authenticated;
