-- =============================================================================
-- 0419 — Notifications anti-fraude : SILENCE sur les mises hors ligne AUTO.
--
-- Constat (audit 28/07) : 40 des 64 notifications en base étaient
-- « Tu as été mis hors ligne » (fraud_force_offline, source auto = simple
-- ménage d'inactivité stale_pull). Recevoir une alerte en boucle « alors
-- qu'on n'a rien fait » mine la confiance : l'UI chauffeur/livreur montre
-- déjà l'état hors ligne au retour. On ne notifie plus QUE les force_offline
-- décidés par un ADMIN (source <> 'auto'). L'action reste journalisée dans
-- fraud_actions (traçabilité intacte) et marquée notified_at (pas de re-file).
--
-- Bonus : purge_notifications (mig 0418) — kinds transitoires étendus
-- (fraud_force_offline, order_status, order_en_route) → 7 jours.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fraud_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_last TIMESTAMPTZ;
  v_stale_chf INT := public.fraud_setting_num('chauffeur_stale_offline_min', 8)::int;
  v_stale_drv INT := public.fraud_setting_num('driver_stale_offline_min', 10)::int;
  ch RECORD; dr RECORD; a RECORD;
  pr public.fraud_partner_presence%ROWTYPE;
  n_chf INT := 0; n_drv INT := 0;
  sess NUMERIC; idle BOOLEAN;
  notifs JSONB := '[]'::jsonb;
  v_title TEXT; v_body TEXT;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('fraud_tick')) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'lock');
  END IF;
  SELECT NULLIF(value #>> '{}', '')::timestamptz INTO v_last
    FROM public.fraud_settings WHERE key = 'last_sweep_at';
  IF v_last IS NOT NULL AND v_last > now()
       - make_interval(secs => public.fraud_setting_num('sweep_min_interval_s', 60)) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'throttle');
  END IF;
  INSERT INTO public.fraud_settings (key, value, label)
  VALUES ('last_sweep_at', to_jsonb(now()::text), 'Dernière passe du sweep (interne)')
  ON CONFLICT (key) DO UPDATE SET value = to_jsonb(now()::text);

  -- 1) Chauffeurs « en ligne » à présence muette → hors ligne forcé + notif
  FOR ch IN
    SELECT cp.chauffeur_id, cp.updated_at, c.user_id, c.full_name
      FROM public.chauffeur_presence cp
      JOIN public.chauffeurs c ON c.id = cp.chauffeur_id
     WHERE cp.is_online AND cp.updated_at < now() - make_interval(mins => v_stale_chf)
  LOOP
    UPDATE public.chauffeur_presence SET is_online = false
     WHERE chauffeur_id = ch.chauffeur_id;
    SELECT * INTO pr FROM public.fraud_partner_presence
     WHERE actor_kind = 'chauffeur' AND actor_id = ch.chauffeur_id;
    sess := CASE WHEN pr.actor_id IS NOT NULL AND pr.is_online
                 THEN round(extract(epoch FROM now() - pr.online_since) / 60.0)
                 ELSE NULL END;
    idle := pr.actor_id IS NOT NULL
            AND (pr.last_moved_at IS NULL OR pr.last_moved_at < now() - interval '45 minutes');
    INSERT INTO public.fraud_partner_presence AS fpp
      (actor_kind, actor_id, user_id, is_online, online_since, last_seen_at, forced_offline_at)
    VALUES ('chauffeur', ch.chauffeur_id, ch.user_id, false, now(), ch.updated_at, now())
    ON CONFLICT (actor_kind, actor_id) DO UPDATE SET
      is_online = false, forced_offline_at = now(), user_id = EXCLUDED.user_id;
    INSERT INTO public.fraud_events
      (actor_kind, actor_id, user_id, event_type, meta)
    VALUES ('chauffeur', ch.chauffeur_id, ch.user_id, 'forced_offline',
            jsonb_build_object('cause', 'stale_presence',
                               'session_min', sess, 'idle', COALESCE(idle, false)));
    INSERT INTO public.fraud_actions
      (actor_kind, actor_id, user_id, action, source, reason, meta, expires_at)
    VALUES ('chauffeur', ch.chauffeur_id, ch.user_id, 'force_offline', 'auto',
            'Présence muette depuis plus de ' || v_stale_chf || ' min — mise hors ligne automatique',
            jsonb_build_object('cause', 'stale_presence'), now());
    n_chf := n_chf + 1;
  END LOOP;

  -- 2) Livreurs sans pull Express récent → présence close (bookkeeping silencieux)
  FOR dr IN
    SELECT * FROM public.fraud_partner_presence
     WHERE actor_kind = 'driver' AND is_online
       AND last_seen_at < now() - make_interval(mins => v_stale_drv)
  LOOP
    sess := round(extract(epoch FROM dr.last_seen_at - dr.online_since) / 60.0);
    idle := dr.last_moved_at IS NULL OR dr.last_moved_at < dr.last_seen_at - interval '45 minutes';
    UPDATE public.fraud_partner_presence
       SET is_online = false, last_offer_id = NULL, last_offer_at = NULL
     WHERE actor_kind = 'driver' AND actor_id = dr.actor_id;
    INSERT INTO public.fraud_events
      (actor_kind, actor_id, user_id, event_type, meta)
    VALUES ('driver', dr.actor_id, dr.user_id, 'went_offline',
            jsonb_build_object('cause', 'stale_pull',
                               'session_min', GREATEST(sess, 0), 'idle', idle));
    n_drv := n_drv + 1;
  END LOOP;

  -- 3) Notifications en attente (actions auto/admin) → retournées à l'appelant
  --    (le serveur Node envoie push + cloche via storeAndPushNotification).
  FOR a IN
    SELECT * FROM public.fraud_actions
     WHERE notified_at IS NULL
     ORDER BY created_at LIMIT 50
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.fraud_actions SET notified_at = now() WHERE id = a.id;
    IF a.user_id IS NULL OR a.action IN ('note', 'require_ack')
       OR (a.action = 'force_offline' AND a.source = 'auto') THEN CONTINUE; END IF;
    v_title := CASE a.action
      WHEN 'warn' THEN 'Avertissement Coligo'
      WHEN 'limit' THEN 'Compte limité temporairement'
      WHEN 'force_offline' THEN 'Tu as été mis hors ligne'
      WHEN 'require_idv' THEN 'Vérification d''identité requise'
      WHEN 'suspend' THEN 'Compte suspendu'
      WHEN 'restore' THEN 'Compte rétabli'
      ELSE 'Information Coligo' END;
    v_body := CASE a.action
      WHEN 'warn' THEN 'Une activité inhabituelle a été détectée sur ton compte. Merci de respecter les règles d''utilisation.'
      WHEN 'limit' THEN 'Certaines fonctionnalités sont limitées. Contacte le support pour en savoir plus.'
      WHEN 'force_offline' THEN COALESCE(NULLIF(a.reason, ''), 'Inactivité détectée — repasse en ligne quand tu es disponible.')
      WHEN 'require_idv' THEN 'Vérifie ton identité pour continuer à utiliser Coligo.'
      WHEN 'suspend' THEN 'Ton compte est suspendu. Contacte le support Coligo.'
      WHEN 'restore' THEN 'Ton compte a été rétabli. Merci de ta patience.'
      ELSE a.reason END;
    notifs := notifs || jsonb_build_array(jsonb_build_object(
      'user_id', a.user_id, 'audience', a.actor_kind,
      'kind', 'fraud_' || a.action, 'title', v_title, 'body', v_body));
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'chauffeurs_offline', n_chf,
                            'drivers_closed', n_drv, 'notifications', notifs);
END $function$
;

-- Purge (mig 0418) : kinds transitoires étendus — l'historique de statut de
-- commande et les mises hors ligne auto n'ont aucune valeur après 7 jours.
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
  DELETE FROM public.user_notifications
   WHERE created_at < now() - interval '7 days'
     AND kind IN (
       'ride_accepted', 'ride_arriving', 'ride_arrived', 'ride_started',
       'ride_cancelled_by_customer', 'ride_cancelled_by_chauffeur',
       'ride_payment_timeout', 'ride_call', 'order_message',
       'fraud_force_offline', 'order_status', 'order_en_route'
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

-- Nettoyage immédiat : les « mis hors ligne » auto déjà accumulés sortent des
-- cloches (l'événement reste tracé dans fraud_actions).
DELETE FROM public.user_notifications WHERE kind = 'fraud_force_offline';
