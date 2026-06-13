-- =============================================================================
-- 0172 — Durcissement du moteur de zones (corrections d'audit)
-- =============================================================================
-- Issues détectées par scripts/test-zones.mjs :
--  1. _coligo_point_in_polygon CRASHE si l'anneau contient des coords non
--     numériques (cast text→double) → une règle polygone corrompue ferait
--     échouer toute évaluation (DoS). On gère l'exception → renvoie false.
--  2. request_ride : la distance max était comparée à p_distance_km (fourni par
--     le CLIENT) → un client pouvait mentir (« 1 km ») pour contourner la
--     limite. On recalcule la distance CÔTÉ SERVEUR (Haversine pickup↔dest).
--  3. zone_block_stats / zone_waitlist_stats : Postgres accorde EXECUTE à PUBLIC
--     par défaut → n'importe quel utilisateur authentifié/anon pouvait lire les
--     stats ops. On REVOKE FROM PUBLIC (réservé service_role / admin).
-- =============================================================================

-- ── 1. point_in_polygon robuste ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._coligo_point_in_polygon(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_ring JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  n INT; i INT; j INT;
  xi DOUBLE PRECISION; yi DOUBLE PRECISION;
  xj DOUBLE PRECISION; yj DOUBLE PRECISION;
  inside BOOLEAN := false;
BEGIN
  IF p_ring IS NULL OR jsonb_typeof(p_ring) <> 'array' THEN RETURN false; END IF;
  n := jsonb_array_length(p_ring);
  IF n < 3 THEN RETURN false; END IF;
  j := n - 1;
  FOR i IN 0..n - 1 LOOP
    xi := (p_ring -> i ->> 0)::DOUBLE PRECISION;  -- lng
    yi := (p_ring -> i ->> 1)::DOUBLE PRECISION;  -- lat
    xj := (p_ring -> j ->> 0)::DOUBLE PRECISION;
    yj := (p_ring -> j ->> 1)::DOUBLE PRECISION;
    IF ((yi > p_lat) <> (yj > p_lat))
       AND (p_lng < (xj - xi) * (p_lat - yi) / NULLIF(yj - yi, 0) + xi) THEN
      inside := NOT inside;
    END IF;
    j := i;
  END LOOP;
  RETURN inside;
EXCEPTION
  -- Anneau corrompu (coords non numériques, structure inattendue) → non couvert,
  -- jamais d'exception qui remonterait jusqu'à bloquer une commande/course.
  WHEN others THEN
    RETURN false;
END;
$$;

-- ── 2. request_ride : distance max recalculée côté serveur ──────────────────
CREATE OR REPLACE FUNCTION public.request_ride(
  p_pickup_lat   DOUBLE PRECISION,
  p_pickup_lng   DOUBLE PRECISION,
  p_pickup_text  TEXT,
  p_dest_lat     DOUBLE PRECISION,
  p_dest_lng     DOUBLE PRECISION,
  p_dest_text    TEXT,
  p_distance_km  NUMERIC,
  p_proposed_price INTEGER,
  p_payment_method TEXT DEFAULT 'cash',
  p_gamme        TEXT DEFAULT 'classic',
  p_boost_da     INTEGER DEFAULT 0,
  p_female_only  BOOLEAN DEFAULT false,
  p_proxy_name   TEXT DEFAULT NULL,
  p_proxy_phone  TEXT DEFAULT NULL,
  p_operation_id TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE;
  v_customer UUID; v_female_ok BOOLEAN; v_suggest INTEGER; v_floor INTEGER;
  v_boost INTEGER; v_ride UUID; v_existing UUID;
  v_org RECORD; v_dst RECORD; v_max_km NUMERIC; v_geo_km NUMERIC;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT cu.id, cu.is_female_verified INTO v_customer, v_female_ok
    FROM public.customers cu WHERE cu.user_id = auth.uid();
  IF v_customer IS NULL THEN RAISE EXCEPTION 'Profil client introuvable.' USING ERRCODE='check_violation'; END IF;
  IF p_payment_method NOT IN ('cash','card','coligo_pay') THEN p_payment_method := 'cash'; END IF;
  IF p_gamme NOT IN ('classic','confort','moto') THEN p_gamme := 'classic'; END IF;

  -- Idempotence : même opération → renvoyer la course existante.
  IF p_operation_id IS NOT NULL THEN
    SELECT r.id INTO v_existing FROM public.rides r
     WHERE r.customer_id = v_customer AND r.client_operation_id = p_operation_id;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  END IF;

  -- Anti-spam : une seule course active à la fois par client.
  IF EXISTS (SELECT 1 FROM public.rides WHERE customer_id = v_customer
             AND status IN ('searching','accepted','arriving','arrived','in_progress')) THEN
    RAISE EXCEPTION 'Vous avez déjà une course en cours.' USING ERRCODE='check_violation';
  END IF;

  -- « Femme au volant » : flag plateforme + cliente au profil vérifié.
  IF p_female_only AND NOT (s.drive_female_filter_enabled AND COALESCE(v_female_ok, false)) THEN
    p_female_only := false;
  END IF;

  -- === MOTEUR DE ZONES (0169) : couverture départ + arrivée ===
  SELECT * INTO v_org FROM public.evaluate_service_zone('drive', p_pickup_lat, p_pickup_lng, NULL, NULL, 'origin');
  IF NOT v_org.allowed THEN
    RAISE EXCEPTION 'drive_zone_origin:%', COALESCE(v_org.reason, 'blocked') USING ERRCODE='check_violation';
  END IF;
  SELECT * INTO v_dst FROM public.evaluate_service_zone('drive', p_dest_lat, p_dest_lng, NULL, NULL, 'destination');
  IF NOT v_dst.allowed THEN
    RAISE EXCEPTION 'drive_zone_dest:%', COALESCE(v_dst.reason, 'blocked') USING ERRCODE='check_violation';
  END IF;
  -- Distance max : recalculée CÔTÉ SERVEUR (Haversine), JAMAIS p_distance_km
  -- (fourni par le client → falsifiable). Anti-fraude (mig 0172).
  v_max_km := public.service_max_distance_km('drive');
  IF v_max_km IS NOT NULL THEN
    v_geo_km := 6371 * acos(LEAST(1, GREATEST(-1,
      cos(radians(p_pickup_lat)) * cos(radians(p_dest_lat)) *
        cos(radians(p_dest_lng) - radians(p_pickup_lng))
      + sin(radians(p_pickup_lat)) * sin(radians(p_dest_lat)))));
    IF v_geo_km IS NOT NULL AND v_geo_km > v_max_km THEN
      RAISE EXCEPTION 'drive_zone_maxdist:%', v_max_km USING ERRCODE='check_violation';
    END IF;
  END IF;
  -- ===========================================================================

  v_suggest := public.drive_recommended_price(p_distance_km, p_gamme);
  v_floor   := public.drive_price_floor(p_distance_km, p_gamme);
  v_boost := GREATEST(0, COALESCE(p_boost_da, 0));
  IF v_boost > 0 THEN
    v_boost := GREATEST(s.drive_boost_min_da, round(v_boost::NUMERIC / s.drive_boost_step_da) * s.drive_boost_step_da)::INTEGER;
  END IF;

  INSERT INTO public.rides (customer_id, status, pickup_lat, pickup_lng, pickup_text,
    dest_lat, dest_lng, dest_text, distance_km, suggested_price_da, proposed_price_da,
    payment_method, gamme, boost_amount_da, female_only, proxy_name, proxy_phone,
    client_operation_id, expires_at)
  VALUES (v_customer, 'searching', p_pickup_lat, p_pickup_lng, p_pickup_text,
    p_dest_lat, p_dest_lng, p_dest_text, GREATEST(0, p_distance_km), v_suggest,
    GREATEST(v_floor, COALESCE(NULLIF(p_proposed_price, 0), v_suggest)),
    p_payment_method, p_gamme, v_boost, p_female_only,
    NULLIF(btrim(COALESCE(p_proxy_name,'')),''), NULLIF(btrim(COALESCE(p_proxy_phone,'')),''),
    p_operation_id, now() + make_interval(mins => s.drive_request_ttl_min))
  RETURNING id INTO v_ride;

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (v_ride, NULL, 'searching',
    'Course demandée · ' || p_gamme
    || CASE WHEN v_boost > 0 THEN ' · boost +' || v_boost || ' DA' ELSE '' END
    || CASE WHEN p_female_only THEN ' · femme au volant' ELSE '' END);
  RETURN v_ride;
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_ride(DOUBLE PRECISION,DOUBLE PRECISION,TEXT,DOUBLE PRECISION,DOUBLE PRECISION,TEXT,NUMERIC,INTEGER,TEXT,TEXT,INTEGER,BOOLEAN,TEXT,TEXT,TEXT) TO authenticated;

-- ── 3. Stats ops réservées (retire l'EXECUTE PUBLIC par défaut) ─────────────
REVOKE EXECUTE ON FUNCTION public.zone_block_stats(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.zone_waitlist_stats(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.zone_block_stats(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.zone_waitlist_stats(INTEGER) TO service_role;

-- =============================================================================
-- VÉRIF : node scripts/test-zones.mjs
-- =============================================================================
