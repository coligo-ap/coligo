-- =============================================================================
-- 0111 — Demandes de modification STRUCTURÉES (payload appliqué à l'approbation)
-- =============================================================================
-- Toute modification d'un livreur VÉRIFIÉ passe par une demande : elle est
-- « En cours de vérification » et n'est PRISE EN COMPTE qu'à l'approbation du
-- super-admin (le payload est alors appliqué aux tables réelles). On trace la
-- date d'application. Le livreur peut uploader un scan PROPOSÉ dans son dossier
-- (bucket privé) même vérifié — il ne sera rattaché qu'à l'approbation.
-- =============================================================================

ALTER TABLE public.driver_change_requests
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;

-- Le livreur peut écrire dans SON dossier du bucket privé (scans proposés),
-- quel que soit l'état de vérification (la pièce n'est créée qu'à l'approbation).
DROP POLICY IF EXISTS "driver_docs_owner_write" ON storage.objects;
CREATE POLICY "driver_docs_owner_write" ON storage.objects
  FOR ALL USING (
    bucket_id = 'driver-docs'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.drivers WHERE user_id = auth.uid()
    )
  ) WITH CHECK (
    bucket_id = 'driver-docs'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.drivers WHERE user_id = auth.uid()
    )
  );

-- =============================================================================
-- VÉRIF : SELECT applied_at FROM public.driver_change_requests LIMIT 1;
-- =============================================================================
