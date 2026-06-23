-- =============================================================================
-- 0250 — Drive : annulation AUTOMATIQUE des recherches sans réponse (deadline)
-- =============================================================================
-- Une demande reste 'searching' jusqu'à son expires_at (TTL = drive_request_ttl_min,
-- ~30 min). Avant, une demande expirée RESTAIT 'searching' indéfiniment côté
-- client (aucun chauffeur ne la voyait — chauffeur_nearby_rides filtre déjà
-- expires_at > now — mais le client la croyait « en recherche »).
--
-- Désormais : si personne n'a répondu (aucune offre ACCEPTÉE) avant l'échéance,
-- la demande passe AUTOMATIQUEMENT en 'cancelled' (cancelled_by='system_timeout').
-- Déclenché à la volée (pas de cron) par les polls existants : côté client
-- (my_active_ride) et côté chauffeur (chauffeur_nearby_rides). Architecture
-- identique à drive_activate_due_scheduled.
--
-- SÉCURITÉ ARGENT : on n'auto-annule PAS une demande payée par CARTE (online_paid_at
-- renseigné) — elle nécessiterait un remboursement (traité hors de ce flux).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.drive_expire_stale_searches()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  UPDATE public.rides r
     SET status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = 'system_timeout'
   WHERE r.status = 'searching'
     AND r.expires_at IS NOT NULL
     AND r.expires_at < now()
     -- jamais une demande payée carte (remboursement requis, hors de ce flux)
     AND (r.payment_method <> 'card' OR r.online_paid_at IS NULL)
     -- et seulement si AUCUNE offre n'a été acceptée (sécurité)
     AND NOT EXISTS (
       SELECT 1 FROM public.ride_offers o
       WHERE o.ride_id = r.id AND o.status = 'accepted'
     );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_expire_stale_searches() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- my_active_ride : on EXPOSE désormais expires_at (échéance de la recherche) →
-- le client affiche le temps restant et sait quand la demande s'annule seule.
-- (Ajout d'une colonne de retour → DROP puis CREATE.)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.my_active_ride();
CREATE FUNCTION public.my_active_ride()
RETURNS TABLE(
  id uuid, status text, pickup_text text, dest_text text,
  pickup_lat double precision, pickup_lng double precision,
  dest_lat double precision, dest_lng double precision,
  distance_km numeric, proposed_price_da integer, agreed_price_da integer,
  boost_amount_da integer, gamme text, payment_method text, female_only boolean,
  proxy_name text, proxy_phone text, share_token text, end_code text,
  online_paid_at timestamptz, chauffeur_id uuid, ch_name text, ch_vehicle text,
  ch_plate text, ch_phone text, ch_rating numeric, ch_rides bigint,
  ch_is_female boolean, ch_is_premium boolean, ch_is_favorite boolean,
  ch_lat double precision, ch_lng double precision, created_at timestamptz,
  escrow_da integer, cash_due_da integer, expires_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_customer UUID;
BEGIN
  SELECT cu.id INTO v_customer FROM public.customers cu WHERE cu.user_id = auth.uid();
  IF v_customer IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT r.id, r.status::TEXT, r.pickup_text, r.dest_text,
         r.pickup_lat, r.pickup_lng, r.dest_lat, r.dest_lng,
         r.distance_km, r.proposed_price_da, r.agreed_price_da,
         r.boost_amount_da, r.gamme, r.payment_method,
         r.female_only, r.proxy_name, r.proxy_phone,
         r.share_token, r.end_code, r.online_paid_at,
         c.id,
         COALESCE(NULLIF(c.first_name,''), split_part(c.full_name,' ',1)),
         NULLIF(btrim(COALESCE(c.vehicle_make,'') || ' ' || COALESCE(c.vehicle_model,'')
           || CASE WHEN COALESCE(c.vehicle_color,'') <> '' THEN ' · ' || c.vehicle_color ELSE '' END), ''),
         c.vehicle_plate, c.phone,
         (SELECT round(avg(r2.chauffeur_rating)::NUMERIC, 1) FROM public.rides r2
           WHERE r2.chauffeur_id = c.id AND r2.chauffeur_rating IS NOT NULL),
         (SELECT count(*) FROM public.rides r3 WHERE r3.chauffeur_id = c.id AND r3.status = 'completed'),
         c.is_female_verified,
         (c.id IS NOT NULL AND (SELECT rp.plan FROM public.resolve_drive_plan(c.id) rp) = 'premium'),
         (c.id IS NOT NULL AND EXISTS (SELECT 1 FROM public.customer_favorite_chauffeurs f
            WHERE f.customer_id = v_customer AND f.chauffeur_id = c.id)),
         p.lat, p.lng,
         r.created_at, r.escrow_da, r.cash_due_da, r.expires_at
  FROM public.rides r
  LEFT JOIN public.chauffeurs c ON c.id = r.chauffeur_id
  LEFT JOIN public.chauffeur_presence p ON p.chauffeur_id = c.id
  WHERE r.customer_id = v_customer
    AND r.status IN ('searching','accepted','arriving','arrived','in_progress')
  ORDER BY r.created_at DESC
  LIMIT 1;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.my_active_ride() TO authenticated, service_role;
