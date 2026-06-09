-- =============================================================================
-- 0112 — Pièces livreur : statut de vérification + verrouillage après envoi
-- =============================================================================
-- Une pièce envoyée par le livreur passe « en vérification » : elle APPARAÎT
-- (avec son scan), reste consultable, mais n'est NI modifiable NI supprimable
-- par le livreur (c'est déjà en cours de vérification par l'admin). L'admin
-- approuve (→ vérifiée) ou refuse. Le tri/aperçu/remplacement AVANT envoi est
-- géré côté client (aucune écriture tant que non envoyé).
-- =============================================================================

ALTER TABLE public.driver_documents
  ADD COLUMN IF NOT EXISTS status      TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS review_note TEXT;

-- Backfill : les pièces déjà saisies (par l'admin notamment) restent valides.
UPDATE public.driver_documents SET status = 'approved' WHERE status = 'pending';

-- ----------------------------------------------------------------------------
-- RLS : le livreur peut AJOUTER ses pièces (INSERT) et les LIRE, mais ne peut
-- ni les modifier ni les supprimer une fois envoyées. L'admin garde tout.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS driver_documents_owner_write ON public.driver_documents;
DROP POLICY IF EXISTS driver_documents_owner_insert ON public.driver_documents;
CREATE POLICY driver_documents_owner_insert ON public.driver_documents
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = driver_documents.driver_id AND d.user_id = auth.uid()
    )
  );
-- (driver_documents_owner_read = SELECT, driver_documents_admin_write = ALL :
--  conservées telles quelles.)

-- Scans : le livreur peut DÉPOSER et LIRE son scan, pas le supprimer/écraser.
DROP POLICY IF EXISTS "driver_docs_owner_write" ON storage.objects;
DROP POLICY IF EXISTS "driver_docs_owner_insert" ON storage.objects;
CREATE POLICY "driver_docs_owner_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'driver-docs'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.drivers WHERE user_id = auth.uid()
    )
  );

-- =============================================================================
-- VÉRIF :
--   SELECT status, count(*) FROM public.driver_documents GROUP BY status;
-- =============================================================================
