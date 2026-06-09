-- =============================================================================
-- 0105 — Bucket privé pour les scans de pièces livreur
-- =============================================================================
-- Les scans (CNI, permis, carte grise, passeport) sont SENSIBLES → bucket
-- PRIVÉ. Chemin : driver-docs/{driver_id}/{doc_id|uuid}-{fichier}.
-- Accès :
--   • super-admin : tout (upload/lecture/suppression) — via service-role ou
--     policy is_super_admin() ;
--   • livreur : lecture de SON dossier uniquement.
-- L'affichage admin passe par des URLs signées générées côté serveur.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('driver-docs', 'driver-docs', false)
ON CONFLICT (id) DO NOTHING;

-- Super-admin : accès complet au bucket.
DROP POLICY IF EXISTS "driver_docs_admin_all" ON storage.objects;
CREATE POLICY "driver_docs_admin_all" ON storage.objects
  FOR ALL USING (
    bucket_id = 'driver-docs' AND public.is_super_admin()
  ) WITH CHECK (
    bucket_id = 'driver-docs' AND public.is_super_admin()
  );

-- Livreur : lecture de son propre dossier {driver_id}/...
DROP POLICY IF EXISTS "driver_docs_owner_read" ON storage.objects;
CREATE POLICY "driver_docs_owner_read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'driver-docs'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.drivers WHERE user_id = auth.uid()
    )
  );

-- =============================================================================
-- VÉRIF :
--   SELECT id, public FROM storage.buckets WHERE id = 'driver-docs';
-- =============================================================================
