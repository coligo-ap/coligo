-- =============================================================================
-- 0187 — Canaux de recharge portefeuille opérateur (LOT 3, backend)
-- =============================================================================
-- Deux canaux :
--   • RECHARGE MANUELLE avec preuve (CCP / virement) : l'opérateur téléverse un
--     reçu → demande `pending` → validation super-admin → crédit `topup_manual`.
--   • RECHARGE CHARGILY : RPC idempotent appelé par le webhook (branche op_topup).
--
-- Tout crédit passe par le grand livre inviolable (mig 0184-0185), idempotent
-- via client_operation_id. Aucune écriture libre côté client (RLS fermé).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. RÉSOLUTION : le portefeuille de l'utilisateur connecté (driver/chauffeur/merchant)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_operator_wallet()
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid UUID := auth.uid(); v_id UUID;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT w.id INTO v_id FROM public.operator_wallets w
    JOIN public.drivers d ON d.id = w.owner_id
    WHERE w.owner_type = 'driver' AND d.user_id = v_uid LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT w.id INTO v_id FROM public.operator_wallets w
    JOIN public.chauffeurs ch ON ch.id = w.owner_id
    WHERE w.owner_type = 'chauffeur' AND ch.user_id = v_uid LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT w.id INTO v_id FROM public.operator_wallets w
    JOIN public.merchants m ON m.id = w.owner_id
    WHERE w.owner_type = 'merchant' AND m.user_id = v_uid LIMIT 1;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.my_operator_wallet() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. DEMANDES DE RECHARGE MANUELLE (preuve + validation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wallet_topup_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id   UUID NOT NULL REFERENCES public.operator_wallets(id) ON DELETE RESTRICT,
  method      TEXT NOT NULL CHECK (method IN ('ccp','virement')),
  amount_da   INTEGER NOT NULL CHECK (amount_da > 0),
  proof_url   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  review_note TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_topup_req_wallet ON public.wallet_topup_requests (wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_topup_req_pending ON public.wallet_topup_requests (created_at) WHERE status = 'pending';

ALTER TABLE public.wallet_topup_requests ENABLE ROW LEVEL SECURITY;

-- l'opérateur voit SES demandes ; le super-admin voit tout
DROP POLICY IF EXISTS topup_req_owner_read ON public.wallet_topup_requests;
CREATE POLICY topup_req_owner_read ON public.wallet_topup_requests
  FOR SELECT USING (wallet_id = public.my_operator_wallet());
DROP POLICY IF EXISTS topup_req_admin_all ON public.wallet_topup_requests;
CREATE POLICY topup_req_admin_all ON public.wallet_topup_requests
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
-- (création/validation passent par RPC SECURITY DEFINER ; pas de policy INSERT pour authenticated)

-- ---------------------------------------------------------------------------
-- 3. BUCKET PREUVES (privé) — dossier {wallet_id}/...
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('wallet-proofs', 'wallet-proofs', false, 10 * 1024 * 1024,
        ARRAY['image/png','image/jpeg','image/webp','application/pdf'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS wallet_proofs_admin_all ON storage.objects;
CREATE POLICY wallet_proofs_admin_all ON storage.objects
  FOR ALL USING (bucket_id = 'wallet-proofs' AND public.is_super_admin())
  WITH CHECK (bucket_id = 'wallet-proofs' AND public.is_super_admin());

DROP POLICY IF EXISTS wallet_proofs_owner_write ON storage.objects;
CREATE POLICY wallet_proofs_owner_write ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'wallet-proofs'
    AND (storage.foldername(name))[1] = public.my_operator_wallet()::text
  );
DROP POLICY IF EXISTS wallet_proofs_owner_read ON storage.objects;
CREATE POLICY wallet_proofs_owner_read ON storage.objects
  FOR SELECT USING (
    bucket_id = 'wallet-proofs'
    AND (storage.foldername(name))[1] = public.my_operator_wallet()::text
  );

-- ---------------------------------------------------------------------------
-- 4. CRÉER UNE DEMANDE (opérateur, pour SON portefeuille)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_operator_topup(
  p_method TEXT, p_amount_da INTEGER, p_proof_url TEXT
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_wallet UUID := public.my_operator_wallet(); v_max INTEGER; v_id UUID;
BEGIN
  IF v_wallet IS NULL THEN
    RAISE EXCEPTION 'Aucun portefeuille opérateur' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_method NOT IN ('ccp','virement') THEN
    RAISE EXCEPTION 'Méthode invalide' USING ERRCODE = 'check_violation';
  END IF;
  SELECT operator_topup_max_da INTO v_max FROM public.platform_settings WHERE id;
  IF p_amount_da <= 0 OR p_amount_da > COALESCE(v_max, 100000) THEN
    RAISE EXCEPTION 'Montant hors limite (max %)', v_max USING ERRCODE = 'check_violation';
  END IF;
  IF p_proof_url IS NULL OR length(trim(p_proof_url)) = 0 THEN
    RAISE EXCEPTION 'Preuve requise' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.wallet_topup_requests (wallet_id, method, amount_da, proof_url)
  VALUES (v_wallet, p_method, p_amount_da, p_proof_url)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_operator_topup(TEXT,INTEGER,TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. VALIDER une demande (super-admin) → crédit topup_manual idempotent
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_topup_request(p_request_id UUID)
RETURNS TABLE (entry_id UUID, new_balance_da INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.wallet_topup_requests%ROWTYPE; v_admin UUID := auth.uid();
        v_email TEXT; v_op TEXT; v_entry UUID;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Réservé au super-admin' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO r FROM public.wallet_topup_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demande introuvable' USING ERRCODE = 'no_data_found'; END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_admin;
  v_op := 'topup_req:' || p_request_id::text;

  -- crédit idempotent (une seule écriture par demande)
  SELECT id INTO v_entry FROM public.operator_wallet_entries
    WHERE wallet_id = r.wallet_id AND client_operation_id = v_op;
  IF v_entry IS NULL THEN
    INSERT INTO public.operator_wallet_entries
      (wallet_id, type, amount_da, note, created_by, client_operation_id)
    VALUES (r.wallet_id, 'topup_manual', r.amount_da,
            'Recharge manuelle ' || r.method || ' validée [admin:' || COALESCE(v_email,'?') || ']',
            v_admin, v_op)
    RETURNING id INTO v_entry;
  END IF;

  UPDATE public.wallet_topup_requests
    SET status = 'approved', reviewed_by = v_admin, reviewed_at = now()
    WHERE id = p_request_id AND status <> 'approved';

  RETURN QUERY SELECT v_entry, public.operator_balance(r.wallet_id);
END;
$$;
REVOKE ALL ON FUNCTION public.approve_topup_request(UUID) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. REFUSER une demande (super-admin)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_topup_request(p_request_id UUID, p_note TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_admin UUID := auth.uid();
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Réservé au super-admin' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.wallet_topup_requests
    SET status = 'rejected', review_note = p_note, reviewed_by = v_admin, reviewed_at = now()
    WHERE id = p_request_id AND status = 'pending';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.reject_topup_request(UUID,TEXT) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. CRÉDIT CHARGILY (idempotent) — appelé UNIQUEMENT par le webhook (service_role)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_operator_topup_chargily(
  p_wallet_id UUID, p_amount_da INTEGER, p_checkout_id TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_op TEXT := 'chargily:' || p_checkout_id;
BEGIN
  IF p_amount_da <= 0 OR p_checkout_id IS NULL THEN
    RAISE EXCEPTION 'Paramètres invalides' USING ERRCODE = 'check_violation';
  END IF;
  BEGIN
    INSERT INTO public.operator_wallet_entries
      (wallet_id, type, amount_da, note, client_operation_id)
    VALUES (p_wallet_id, 'topup_chargily', p_amount_da,
            'Recharge Chargily (' || p_checkout_id || ')', v_op);
  EXCEPTION WHEN unique_violation THEN
    NULL;  -- rejeu Chargily : déjà crédité, on ignore
  END;
  RETURN public.operator_balance(p_wallet_id);
END;
$$;
-- réservé service_role : surtout PAS de grant authenticated (sinon auto-crédit)
REVOKE ALL ON FUNCTION public.credit_operator_topup_chargily(UUID,INTEGER,TEXT) FROM public, anon, authenticated;
