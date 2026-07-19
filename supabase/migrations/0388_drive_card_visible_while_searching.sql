-- =============================================================================
-- 0388 — Coligo Drive : les courses CARTE sont visibles/diffusées EN RECHERCHE
-- =============================================================================
-- Régression introduite par le paiement À L'ACCEPTATION (0386) : de nombreuses
-- fonctions exigeaient `online_paid_at IS NOT NULL` pour une course carte
-- (ancien modèle « payer avant diffusion »). Or une course carte est désormais
-- NON PAYÉE pendant la recherche → elle devenait invisible pour les chauffeurs
-- (aucune notification, absente de « courses proches », pas d'escalade ni de
-- réponse démo). On aligne la carte sur les espèces PENDANT la recherche : le
-- paiement du prix exact a lieu à l'acceptation (drive_card_reserve_offer +
-- webhook). Le JS notifyChauffeursNewRide est corrigé en parallèle.
-- =============================================================================

-- 1) Courses proches (ce que voit le chauffeur) — retrait du filtre carte-payée.
CREATE OR REPLACE FUNCTION public.chauffeur_nearby_rides(p_lat double precision, p_lng double precision, p_radius_km numeric DEFAULT NULL::numeric, p_chauffeur_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, pickup_text text, dest_text text, pickup_lat double precision, pickup_lng double precision, dest_lat double precision, dest_lng double precision, distance_km numeric, proposed_price_da integer, suggested_price_da integer, boost_amount_da integer, gamme text, female_only boolean, payment_method text, pickup_dist_km numeric, created_at timestamp with time zone, my_offer_da integer, customer_name text, customer_rating numeric, customer_since timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ch public.chauffeurs%ROWTYPE;
  v_female_online BOOLEAN;
  v_radius NUMERIC;
  v_default NUMERIC;
  v_max    NUMERIC := 20;
  v_min    INTEGER := 6;
BEGIN
  IF public.feature_blocked('drive') THEN RETURN; END IF;

  SELECT c.* INTO v_ch FROM public.chauffeurs c
  WHERE (
          (auth.uid() IS NOT NULL AND c.user_id = auth.uid())
          OR (auth.uid() IS NULL AND p_chauffeur_id IS NOT NULL AND c.id = p_chauffeur_id)
        )
    AND c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked;
  IF v_ch.id IS NULL OR p_lat IS NULL OR p_lng IS NULL THEN RETURN; END IF;
  v_female_online := public.drive_female_online();

  SELECT COALESCE(ps.drive_default_radius_km, 10) INTO v_default
    FROM public.platform_settings ps WHERE ps.id = true;
  v_default := GREATEST(5, LEAST(COALESCE(v_default, 10), v_max));
  v_radius := GREATEST(5, LEAST(
    COALESCE(NULLIF(v_ch.work_zone_radius_km, 0), v_default, p_radius_km, 10), v_max));

  RETURN QUERY
  WITH elig AS (
    SELECT r.id, r.pickup_text, r.dest_text,
           r.pickup_lat, r.pickup_lng, r.dest_lat, r.dest_lng,
           r.distance_km, r.proposed_price_da, r.suggested_price_da,
           r.boost_amount_da, r.gamme, r.female_only, r.payment_method,
           public.km_between(p_lat, p_lng, r.pickup_lat, r.pickup_lng)::NUMERIC AS pdist,
           r.created_at, r.customer_id,
           cu.full_name AS cu_name, cu.created_at AS cu_since
    FROM public.rides r
    JOIN public.customers cu ON cu.id = r.customer_id
    WHERE r.status = 'searching'
      AND (r.expires_at IS NULL OR r.expires_at > now())
      -- Carte visible en recherche (paiement à l'acceptation, mig 0386/0388).
      AND NOT EXISTS (SELECT 1 FROM public.ride_offers od
                      WHERE od.ride_id = r.id AND od.chauffeur_id = v_ch.id AND od.status = 'declined')
      AND (CASE v_ch.gamme
            WHEN 'confort' THEN r.gamme IN ('classic','confort')
            WHEN 'classic' THEN r.gamme = 'classic'
            ELSE r.gamme = 'moto' END)
      AND (NOT r.female_only OR v_ch.is_female_verified OR NOT v_female_online)
      AND public.km_between(p_lat, p_lng, r.pickup_lat, r.pickup_lng) <= v_max
  ),
  ranked AS (
    SELECT e.*, row_number() OVER (ORDER BY e.pdist ASC) AS rn FROM elig e
  )
  SELECT k.id, k.pickup_text, k.dest_text,
         k.pickup_lat, k.pickup_lng, k.dest_lat, k.dest_lng,
         k.distance_km, k.proposed_price_da, k.suggested_price_da,
         k.boost_amount_da, k.gamme, k.female_only, k.payment_method,
         k.pdist AS pickup_dist_km,
         k.created_at,
         (SELECT o.price_da FROM public.ride_offers o
           WHERE o.ride_id = k.id AND o.chauffeur_id = v_ch.id AND o.status = 'offered') AS my_offer_da,
         COALESCE(NULLIF(split_part(k.cu_name, ' ', 1), ''), 'Client') AS customer_name,
         (SELECT round(avg(r2.client_rating)::NUMERIC, 1) FROM public.rides r2
           WHERE r2.customer_id = k.customer_id AND r2.client_rating IS NOT NULL) AS customer_rating,
         k.cu_since AS customer_since
  FROM ranked k
  WHERE k.pdist <= v_radius OR k.rn <= v_min
  ORDER BY (k.boost_amount_da > 0) DESC, k.created_at DESC
  LIMIT 30;
END;
$function$;

-- 2) Escalade de diffusion — retrait de la garde carte-payée.
CREATE OR REPLACE FUNCTION public.drive_escalate_dispatch(p_ride_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ride     public.rides%ROWTYPE;
  v_default  INTEGER;
  v_step     INTEGER := 5;
  v_max      INTEGER := 25;
  v_interval INTERVAL := INTERVAL '25 seconds';
  v_relance  INTERVAL := INTERVAL '60 seconds';
  v_cur      INTEGER;
  v_next     INTEGER;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_ride.customer_id NOT IN (
    SELECT id FROM public.customers WHERE user_id = auth.uid()
  ) THEN
    RETURN NULL;
  END IF;

  IF v_ride.status <> 'searching' OR v_ride.chauffeur_id IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- Carte : plus de garde online_paid_at (diffusion comme espèces, mig 0388).
  IF v_ride.expires_at IS NOT NULL AND v_ride.expires_at <= now() THEN
    RETURN NULL;
  END IF;

  IF v_ride.last_dispatch_at IS NOT NULL
     AND v_ride.last_dispatch_at > now() - v_interval THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(drive_default_radius_km, 10) INTO v_default
    FROM public.platform_settings WHERE id = true;

  v_cur  := COALESCE(v_ride.dispatch_radius_km, v_default);
  v_next := LEAST(v_max, v_cur + v_step);

  IF v_next > v_cur THEN
    UPDATE public.rides
      SET dispatch_radius_km = v_next, last_dispatch_at = now()
      WHERE id = p_ride_id;
    RETURN v_next;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ride_offers o
     WHERE o.ride_id = p_ride_id AND o.status = 'offered'
  ) THEN
    RETURN NULL;
  END IF;
  IF v_ride.last_dispatch_at IS NOT NULL
     AND v_ride.last_dispatch_at > now() - v_relance THEN
    RETURN NULL;
  END IF;

  DELETE FROM public.ride_offers o
   WHERE o.ride_id = p_ride_id AND o.status = 'declined';

  UPDATE public.rides SET last_dispatch_at = now() WHERE id = p_ride_id;
  RETURN v_cur;
END;
$function$;

-- 3) Répondeur DÉMO — répond aussi aux courses carte, et propose des prix
--    VARIÉS (pour tester le « prix convenu » du paiement à l'acceptation).
CREATE OR REPLACE FUNCTION public.drive_demo_respond(p_ride_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  s public.platform_settings%ROWTYPE;
  v_ride public.rides%ROWTYPE;
  v_total INTEGER; v_female_online BOOLEAN; v_n INTEGER := 0; rec RECORD;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride.id IS NULL OR v_ride.status <> 'searching'
     OR (v_ride.expires_at IS NOT NULL AND v_ride.expires_at < now()) THEN
    RETURN 0;
  END IF;
  v_total := v_ride.proposed_price_da + v_ride.boost_amount_da;
  v_female_online := public.drive_female_online();

  FOR rec IN
    SELECT c.id,
      (6371 * acos(LEAST(1, GREATEST(-1,
        cos(radians(v_ride.pickup_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(v_ride.pickup_lng))
        + sin(radians(v_ride.pickup_lat)) * sin(radians(p.lat)))))) AS dist
    FROM public.chauffeurs c
    JOIN public.chauffeur_presence p ON p.chauffeur_id = c.id
    WHERE c.is_demo AND c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked
      AND p.is_online
      AND (CASE c.gamme
            WHEN 'confort' THEN v_ride.gamme IN ('classic','confort')
            WHEN 'classic' THEN v_ride.gamme = 'classic'
            ELSE v_ride.gamme = 'moto' END)
      AND (NOT v_ride.female_only OR c.is_female_verified OR NOT v_female_online)
      AND NOT EXISTS (SELECT 1 FROM public.rides r2 WHERE r2.chauffeur_id = c.id
                      AND r2.status IN ('accepted','arriving','arrived','in_progress'))
      AND (6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(v_ride.pickup_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(v_ride.pickup_lng))
            + sin(radians(v_ride.pickup_lat)) * sin(radians(p.lat)))))) <= 30
    ORDER BY dist ASC
    LIMIT 4
  LOOP
    INSERT INTO public.ride_offers (ride_id, chauffeur_id, price_da, status, expires_at)
    VALUES (p_ride_id, rec.id,
      -- 1re offre au prix client, puis +20/+40/+60 (carte comprise : le client
      -- paiera à l'acceptation le prix EXACT de l'offre choisie).
      v_total + v_n * 20,
      'offered', now() + make_interval(mins => s.drive_offer_ttl_min))
    ON CONFLICT (ride_id, chauffeur_id) DO UPDATE
      SET price_da = EXCLUDED.price_da, status = 'offered',
          created_at = now(), expires_at = EXCLUDED.expires_at;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

-- 4) Expiration des recherches périmées : inchangée pour la carte (expire par
--    TTL comme les espèces) + nettoyage opportuniste des réservations périmées.
CREATE OR REPLACE FUNCTION public.drive_expire_stale_searches()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_n INTEGER;
BEGIN
  PERFORM public.drive_release_stale_reservations();

  UPDATE public.rides r
     SET status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = 'system_timeout'
   WHERE r.status = 'searching'
     AND r.expires_at IS NOT NULL
     AND r.expires_at < now()
     -- jamais une course carte DÉJÀ payée (remboursement requis, hors flux).
     AND (r.payment_method <> 'card' OR r.online_paid_at IS NULL)
     AND NOT EXISTS (
       SELECT 1 FROM public.ride_offers o
       WHERE o.ride_id = r.id AND o.status = 'accepted'
     );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
