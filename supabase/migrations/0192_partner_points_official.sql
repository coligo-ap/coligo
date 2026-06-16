-- =============================================================================
-- 0192 — Points de recharge « officiels » : gérant, registre commerce, documents
-- =============================================================================
-- Enrichit les points partenaires (operator_wallets.is_partner) avec les infos
-- d'un point officiel : nom du gérant, n° de registre de commerce, et pièces
-- justificatives (registre commerce, pièce d'identité…) téléversées par l'admin.
-- Les infos publiques (nom commerce, position, horaires, tél, coordonnées) sont
-- déjà sur operator_wallets et exposées par recharge_points_nearby (mig 0189).
-- Les DOCUMENTS restent internes (admin seulement) — KYC du point.
-- =============================================================================

-- 1. Infos gérant / immatriculation sur le portefeuille partenaire.
ALTER TABLE public.operator_wallets
  ADD COLUMN IF NOT EXISTS owner_name        TEXT,   -- prénom + nom du gérant
  ADD COLUMN IF NOT EXISTS registre_commerce TEXT;   -- n° RC (référence rapide)

-- 2. Pièces justificatives du point (téléversées par l'admin).
CREATE TABLE IF NOT EXISTS public.partner_documents (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id  UUID NOT NULL REFERENCES public.operator_wallets(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN
               ('registre_commerce','piece_identite','autre')),
  url        TEXT NOT NULL,            -- chemin dans le bucket partner-docs
  label      TEXT,                     -- libellé libre (ex. « RC 2024 »)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_documents_wallet
  ON public.partner_documents (wallet_id, created_at DESC);

ALTER TABLE public.partner_documents ENABLE ROW LEVEL SECURITY;
-- accès via service_role (admin) uniquement ; pas de policy pour authenticated.

-- 3. Bucket privé des pièces (admin only).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('partner-docs', 'partner-docs', false, 10 * 1024 * 1024,
        ARRAY['image/png','image/jpeg','image/webp','application/pdf'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS partner_docs_admin_all ON storage.objects;
CREATE POLICY partner_docs_admin_all ON storage.objects
  FOR ALL USING (bucket_id = 'partner-docs' AND public.is_super_admin())
  WITH CHECK (bucket_id = 'partner-docs' AND public.is_super_admin());
