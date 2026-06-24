-- =============================================================================
-- 0257 — chauffeur_nearby_rides : id chauffeur EXPLICITE (service_role)
-- =============================================================================
-- BUG dispatch « 0 course » : la réception (getNearbyRides) dépendait de
-- `auth.uid()` dans la Server Action. Selon l'état du token de session (refresh
-- rotatif, course entre sous-appels), `auth.uid()` pouvait être NULL par
-- intermittence → 0 ligne EN SILENCE, alors que la course existe (getDriveHome,
-- qui tourne juste avant, la voit : req=1 mais near=0).
--
-- Correctif : on permet de passer le chauffeur EXPLICITEMENT (`p_chauffeur_id`)
-- — utilisé UNIQUEMENT quand l'appel vient du SERVICE_ROLE (auth.uid() IS NULL,
-- ex. client admin serveur). Un utilisateur authentifié garde son auth.uid()
-- (p_chauffeur_id ignoré → impossible d'usurper un autre chauffeur). La Server
-- Action résout le chauffeur via getCurrentChauffeur (fiable) puis appelle ce
-- RPC en service_role → la requête ne dépend plus du token de session.
-- =============================================================================

-- DROP de l'ancienne signature 3-params (sinon la 4-params crée une SURCHARGE →
-- PostgREST ne sait plus laquelle appeler = erreur d'ambiguïté).
DROP FUNCTION IF EXISTS public.chauffeur_nearby_rides(
  DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC
);

CREATE OR REPLACE FUNCTION public.chauffeur_nearby_rides(
  p_lat          DOUBLE PRECISION,
  p_lng          DOUBLE PRECISION,
  p_radius_km    NUMERIC DEFAULT NULL,
  p_chauffeur_id UUID DEFAULT NULL
)
RETURNS TABLE(
  id uuid, pickup_text text, dest_text text,
  pickup_lat double precision, pickup_lng double precision,
  dest_lat double precision, dest_lng double precision,
  distance_km numeric, proposed_price_da integer, suggested_price_da integer,
  boost_amount_da integer, gamme text, female_only boolean, payment_method text,
  pickup_dist_km numeric, created_at timestamp with time zone,
  my_offer_da integer, customer_name text, customer_rating numeric,
  customer_since timestamp with time zone
)
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

  -- Résolution du chauffeur : auth.uid() en priorité (utilisateur authentifié) ;
  -- p_chauffeur_id UNIQUEMENT en l'absence de session (service_role) → pas
  -- d'usurpation possible par un user authentifié.
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
      AND (r.payment_method <> 'card' OR r.online_paid_at IS NOT NULL)
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

GRANT EXECUTE ON FUNCTION public.chauffeur_nearby_rides(
  DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, UUID
) TO authenticated, service_role;
