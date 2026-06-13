-- =============================================================================
-- 0174 — Drive : faire respecter les règles de zone WILAYA / COMMUNE
-- =============================================================================
-- BUG : request_ride (0169/0172) appelait evaluate_service_zone(..., NULL, NULL,
--   ...) pour le départ ET l'arrivée → les règles de scope 'wilaya'/'commune'
--   ne pouvaient JAMAIS matcher (elles exigent p_wilaya_code/p_commune). Seules
--   les règles géométriques (radius/polygon/country) bloquaient le Drive. Donc
--   bloquer une commune (ex. « Akbou ») n'avait AUCUN effet : le client pouvait
--   choisir un prix puis lancer la recherche normalement.
--
-- CORRECTIF : on ajoute 4 paramètres (wilaya/commune du départ + de l'arrivée),
--   renseignés par l'action serveur via reverse-geocode (comme le checkout le
--   fait déjà pour orders.delivery_wilaya_code/commune), et on les transmet à
--   evaluate_service_zone. Comportement par défaut inchangé (params NULL →
--   identique à avant tant que l'appelant n'envoie rien). Le reste du corps est
--   repris À L'IDENTIQUE de 0172 (anti-fraude distance recalculée serveur, etc.).
--
-- On DROP l'ancienne signature 15-args puis on CREATE la nouvelle 19-args : les
-- 4 nouveaux ont un DEFAULT NULL, donc les appels nommés existants (15 args)
-- continuent de résoudre sans ambiguïté (une seule fonction request_ride).
-- =============================================================================

DROP FUNCTION IF EXISTS public.request_ride(
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT, NUMERIC, INTEGER, TEXT, TEXT, INTEGER, BOOLEAN, TEXT, TEXT, TEXT);

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
  p_operation_id TEXT DEFAULT NULL,
  -- Nouveaux (mig 0174) : reverse-géocodés côté action serveur.
  p_pickup_wilaya  TEXT DEFAULT NULL,
  p_pickup_commune TEXT DEFAULT NULL,
  p_dest_wilaya    TEXT DEFAULT NULL,
  p_dest_commune   TEXT DEFAULT NULL
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

  -- === MOTEUR DE ZONES (0169/0174) : couverture départ + arrivée ===
  -- wilaya/commune transmis (reverse-géocodés par l'action) → les règles de
  -- scope commune/wilaya s'appliquent enfin au Drive, en plus du géométrique.
  SELECT * INTO v_org FROM public.evaluate_service_zone(
    'drive', p_pickup_lat, p_pickup_lng, p_pickup_wilaya, p_pickup_commune, 'origin');
  IF NOT v_org.allowed THEN
    RAISE EXCEPTION 'drive_zone_origin:%', COALESCE(v_org.reason, 'blocked') USING ERRCODE='check_violation';
  END IF;
  SELECT * INTO v_dst FROM public.evaluate_service_zone(
    'drive', p_dest_lat, p_dest_lng, p_dest_wilaya, p_dest_commune, 'destination');
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

GRANT EXECUTE ON FUNCTION public.request_ride(
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT, NUMERIC, INTEGER, TEXT, TEXT, INTEGER, BOOLEAN, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- =============================================================================
-- VÉRIF : node scripts/test-zones.mjs
--   + bloquer une commune dans /admin/zones et tester une course Drive dedans.
-- =============================================================================
