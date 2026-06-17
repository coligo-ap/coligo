-- =============================================================================
-- 0196 — Auto-inscription Agent Coligo Pay + validation super-admin
-- =============================================================================
-- Permet à un point de recharge de DEMANDER lui-même son partenariat
-- (/partenaire/signup) au lieu d'être créé par l'admin. Le compte est créé en
-- statut `pending` (INERTE : ne peut ni revendre du crédit — coligo_recharge_sell
-- exige status='active' — ni apparaître dans recharge_points_nearby qui filtre
-- status='active'). Le super-admin examine le dossier (infos + pièces), peut
-- modifier, approuver (→ active), refuser (motif) et attribuer le badge vérifié.
--
-- Sécurité / anti-fraude :
--   • L'agent N'A AUCUN droit d'écriture sur operator_wallets (pas de policy
--     UPDATE pour authenticated) → il ne peut pas s'auto-activer ni se vérifier.
--   • Les pièces sont déposées dans SON dossier (RLS storage = wallet_id) et
--     insérées en statut 'pending' via RPC SECURITY DEFINER ; il ne peut pas
--     approuver ses propres pièces (réservé service_role / super-admin).
--   • Anti-doublon : l'email synthétique (<tel>@partners.coligo.local) est unique
--     côté auth ; un même téléphone ne peut donc pas créer deux comptes.
-- =============================================================================

-- 1. États & métadonnées de validation sur le portefeuille partenaire ----------
ALTER TABLE public.operator_wallets DROP CONSTRAINT IF EXISTS operator_wallets_status_check;
ALTER TABLE public.operator_wallets
  ADD CONSTRAINT operator_wallets_status_check
  CHECK (status IN ('active','suspended','disabled','pending','rejected'));

ALTER TABLE public.operator_wallets
  ADD COLUMN IF NOT EXISTS is_verified     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by     TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at    TIMESTAMPTZ,   -- horodatage de la demande
  ADD COLUMN IF NOT EXISTS rejected_reason TEXT,
  ADD COLUMN IF NOT EXISTS wilaya          TEXT,
  ADD COLUMN IF NOT EXISTS commune         TEXT;

CREATE INDEX IF NOT EXISTS idx_operator_wallets_partner_pending
  ON public.operator_wallets (submitted_at DESC)
  WHERE owner_type = 'partner' AND status = 'pending';

-- 2. Workflow de revue par pièce (statut + note + revue) -----------------------
ALTER TABLE public.partner_documents
  ADD COLUMN IF NOT EXISTS status      TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS review_note TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- L'agent voit SES propres pièces (et leur statut/motif) dans son dossier.
DROP POLICY IF EXISTS partner_docs_owner_read ON public.partner_documents;
CREATE POLICY partner_docs_owner_read ON public.partner_documents
  FOR SELECT USING (wallet_id = public.my_operator_wallet());
-- (INSERT via RPC SECURITY DEFINER ; UPDATE/validation = service_role admin.)

-- 3. Bucket partner-docs : l'agent peut déposer/lire DANS SON dossier ----------
--    (en plus de l'accès admin total déjà posé en mig 0192). Dossier = wallet_id.
DROP POLICY IF EXISTS partner_docs_owner_write ON storage.objects;
CREATE POLICY partner_docs_owner_write ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'partner-docs'
    AND (storage.foldername(name))[1] = public.my_operator_wallet()::text
  );
DROP POLICY IF EXISTS partner_docs_owner_read ON storage.objects;
CREATE POLICY partner_docs_owner_read ON storage.objects
  FOR SELECT USING (
    bucket_id = 'partner-docs'
    AND (storage.foldername(name))[1] = public.my_operator_wallet()::text
  );

-- 4. RPC : l'agent ajoute une pièce À SON dossier (statut 'pending') -----------
CREATE OR REPLACE FUNCTION public.partner_add_document(
  p_kind TEXT, p_url TEXT, p_label TEXT
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_wallet UUID := public.my_operator_wallet(); v_id UUID;
BEGIN
  IF v_wallet IS NULL THEN
    RAISE EXCEPTION 'Aucun portefeuille' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_kind NOT IN ('registre_commerce','piece_identite','autre') THEN
    RAISE EXCEPTION 'Type de document invalide' USING ERRCODE = 'check_violation';
  END IF;
  IF p_url IS NULL OR length(trim(p_url)) = 0 THEN
    RAISE EXCEPTION 'Fichier requis' USING ERRCODE = 'check_violation';
  END IF;
  -- Le chemin DOIT être dans le dossier du portefeuille (anti-usurpation).
  IF split_part(p_url, '/', 1) <> v_wallet::text THEN
    RAISE EXCEPTION 'Chemin non autorisé' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.partner_documents (wallet_id, kind, url, label, status)
  VALUES (v_wallet, p_kind, p_url,
          NULLIF(trim(COALESCE(p_label, '')), ''), 'pending')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.partner_add_document(TEXT,TEXT,TEXT) TO authenticated;
