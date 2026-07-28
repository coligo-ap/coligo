-- =============================================================================
-- 0418 — CYCLE DE VIE des notifications (cloche) : suppression par
-- l'utilisateur + purge automatique. Jusqu'ici, AUCUNE notification n'était
-- jamais supprimée (user_notifications mig 0363, driver_notifications mig
-- 0352) : la cloche gardait à vie des événements transitoires périmés.
--
-- Logique métier :
--   • L'utilisateur peut supprimer DÉFINITIVEMENT une notification ou tout
--     effacer (RPC scopées auth.uid() — jamais de DELETE direct, aucune
--     policy DELETE).
--   • Purge quotidienne (cron serveur, service_role) :
--       - événements TRANSITOIRES (cycle de course/commande, déjà périmés
--         quelques minutes après) → 7 jours ;
--       - notifications LUES → 30 jours ;
--       - tout le reste → 90 jours.
-- =============================================================================

-- Suppression par l'utilisateur (client / chauffeur / commerçant).
CREATE OR REPLACE FUNCTION public.delete_user_notifications(
  p_audience TEXT,
  p_ids UUID[] DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;
  DELETE FROM public.user_notifications
   WHERE user_id = auth.uid()
     AND audience = p_audience
     AND (p_ids IS NULL OR id = ANY(p_ids));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_user_notifications(TEXT, UUID[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_user_notifications(TEXT, UUID[])
  TO authenticated;

-- Suppression par le LIVREUR (table historique driver_notifications).
CREATE OR REPLACE FUNCTION public.driver_delete_notifications(
  p_ids UUID[] DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver UUID;
  v_count  INTEGER;
BEGIN
  SELECT id INTO v_driver FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver IS NULL THEN RETURN 0; END IF;
  DELETE FROM public.driver_notifications
   WHERE driver_id = v_driver
     AND (p_ids IS NULL OR id = ANY(p_ids));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.driver_delete_notifications(UUID[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_delete_notifications(UUID[])
  TO authenticated;

-- Purge quotidienne — appelée par le cron serveur en service_role UNIQUEMENT.
CREATE OR REPLACE FUNCTION public.purge_notifications()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  n_transient INTEGER;
  n_read      INTEGER;
  n_old       INTEGER;
  n_drv       INTEGER;
BEGIN
  -- Transitoires : information périmée quelques minutes après l'événement.
  DELETE FROM public.user_notifications
   WHERE created_at < now() - interval '7 days'
     AND kind IN (
       'ride_accepted', 'ride_arriving', 'ride_arrived', 'ride_started',
       'ride_cancelled_by_customer', 'ride_cancelled_by_chauffeur',
       'ride_payment_timeout', 'ride_call', 'order_message'
     );
  GET DIAGNOSTICS n_transient = ROW_COUNT;

  DELETE FROM public.user_notifications
   WHERE read_at IS NOT NULL AND read_at < now() - interval '30 days';
  GET DIAGNOSTICS n_read = ROW_COUNT;

  DELETE FROM public.user_notifications
   WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS n_old = ROW_COUNT;

  DELETE FROM public.driver_notifications
   WHERE (read_at IS NOT NULL AND read_at < now() - interval '30 days')
      OR created_at < now() - interval '90 days';
  GET DIAGNOSTICS n_drv = ROW_COUNT;

  RETURN jsonb_build_object(
    'transient', n_transient, 'read', n_read, 'old', n_old, 'driver', n_drv
  );
END;
$$;
REVOKE ALL ON FUNCTION public.purge_notifications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_notifications() TO service_role;
