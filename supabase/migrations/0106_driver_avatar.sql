-- =============================================================================
-- 0106 — Photo de profil du livreur
-- =============================================================================
-- `drivers.avatar_url` (URL publique) + bucket PUBLIC `driver-avatars`
-- (photo de profil = non sensible, affichée dans l'app livreur / l'admin).
-- Chemin : driver-avatars/{driver_id}/{uuid}.{ext}.
-- Accès : lecture publique ; écriture super-admin OU le livreur dans son dossier.
-- =============================================================================

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

INSERT INTO storage.buckets (id, name, public)
VALUES ('driver-avatars', 'driver-avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Lecture publique des avatars.
DROP POLICY IF EXISTS "driver_avatars_public_read" ON storage.objects;
CREATE POLICY "driver_avatars_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'driver-avatars');

-- Écriture super-admin (toutes opérations).
DROP POLICY IF EXISTS "driver_avatars_admin_write" ON storage.objects;
CREATE POLICY "driver_avatars_admin_write" ON storage.objects
  FOR ALL USING (
    bucket_id = 'driver-avatars' AND public.is_super_admin()
  ) WITH CHECK (
    bucket_id = 'driver-avatars' AND public.is_super_admin()
  );

-- Écriture du livreur dans SON dossier {driver_id}/ (self-service futur).
DROP POLICY IF EXISTS "driver_avatars_owner_write" ON storage.objects;
CREATE POLICY "driver_avatars_owner_write" ON storage.objects
  FOR ALL USING (
    bucket_id = 'driver-avatars'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.drivers WHERE user_id = auth.uid()
    )
  ) WITH CHECK (
    bucket_id = 'driver-avatars'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.drivers WHERE user_id = auth.uid()
    )
  );

-- =============================================================================
-- VÉRIF :
--   SELECT id, public FROM storage.buckets WHERE id = 'driver-avatars';
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='drivers' AND column_name='avatar_url';
-- =============================================================================
