-- =============================================================================
-- 0364 — Badge temps réel des notifications LIVREUR
-- =============================================================================
-- `driver_notifications` (mig 0352) n'était pas publiée en Realtime : le badge
-- de la cloche livreur ne se mettait à jour qu'au rechargement. On aligne sur
-- `user_notifications` (mig 0363) : INSERT poussé instantanément, RLS inchangée
-- (le livreur ne voit que ses lignes).
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'driver_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_notifications;
  END IF;
END $$;
