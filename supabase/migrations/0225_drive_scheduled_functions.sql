-- ============================================================================
-- 0225 — Réservation programmée : index + fonctions (utilisent 'scheduled')
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_rides_scheduled
  ON public.rides (scheduled_at) WHERE status = 'scheduled';

-- Créer une course PROGRAMMÉE (espèces, gated, prix figé au devis programmé).
CREATE OR REPLACE FUNCTION public.request_scheduled_ride(
  p_pickup_lat   DOUBLE PRECISION,
  p_pickup_lng   DOUBLE PRECISION,
  p_pickup_text  TEXT,
  p_dest_lat     DOUBLE PRECISION,
  p_dest_lng     DOUBLE PRECISION,
  p_dest_text    TEXT,
  p_distance_km  NUMERIC,
  p_gamme        TEXT,
  p_scheduled_at TIMESTAMPTZ,
  p_proxy_name   TEXT DEFAULT NULL,
  p_proxy_phone  TEXT DEFAULT NULL,
  p_operation_id TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE;
  v_customer UUID; v_suggest INTEGER; v_floor INTEGER; v_ride UUID; v_existing UUID;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  IF NOT s.drive_scheduled_enabled THEN
    RAISE EXCEPTION 'Réservation programmée indisponible.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT cu.id INTO v_customer FROM public.customers cu WHERE cu.user_id = auth.uid();
  IF v_customer IS NULL THEN RAISE EXCEPTION 'Profil client introuvable.' USING ERRCODE='check_violation'; END IF;
  IF p_gamme NOT IN ('classic','confort','moto') THEN p_gamme := 'classic'; END IF;

  -- Idempotence (anti double-tap).
  IF p_operation_id IS NOT NULL THEN
    SELECT r.id INTO v_existing FROM public.rides r
     WHERE r.customer_id = v_customer AND r.client_operation_id = p_operation_id;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  END IF;

  -- Fenêtre valide : au moins lead min dans le futur, au plus max_days.
  IF p_scheduled_at IS NULL
     OR p_scheduled_at < now() + make_interval(mins => s.drive_scheduled_lead_min)
     OR p_scheduled_at > now() + make_interval(days => s.drive_scheduled_max_days) THEN
    RAISE EXCEPTION 'Date de réservation invalide.' USING ERRCODE='check_violation';
  END IF;

  -- Plafond : pas plus de 3 courses programmées en attente.
  IF (SELECT count(*) FROM public.rides r
        WHERE r.customer_id = v_customer AND r.status = 'scheduled') >= 3 THEN
    RAISE EXCEPTION 'Trop de courses programmées en attente.' USING ERRCODE='check_violation';
  END IF;

  -- Devis PROGRAMMÉ (prix stable, sans surge ni majoration horaire).
  SELECT q.reco_da INTO v_suggest
    FROM public.drive_smart_quote(p_distance_km, p_gamme, p_pickup_lat, p_pickup_lng, p_scheduled_at, true) q;
  v_floor := public.drive_price_floor(p_distance_km, p_gamme);

  INSERT INTO public.rides (customer_id, status, pickup_lat, pickup_lng, pickup_text,
    dest_lat, dest_lng, dest_text, distance_km, suggested_price_da, proposed_price_da,
    payment_method, gamme, boost_amount_da, female_only, proxy_name, proxy_phone,
    client_operation_id, scheduled_at)
  VALUES (v_customer, 'scheduled', p_pickup_lat, p_pickup_lng, p_pickup_text,
    p_dest_lat, p_dest_lng, p_dest_text, GREATEST(0, p_distance_km), v_suggest,
    GREATEST(v_floor, v_suggest), 'cash', p_gamme, 0, false,
    NULLIF(btrim(COALESCE(p_proxy_name,'')),''), NULLIF(btrim(COALESCE(p_proxy_phone,'')),''),
    p_operation_id, p_scheduled_at)
  RETURNING id INTO v_ride;

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (v_ride, NULL, 'scheduled',
    'Course programmée · ' || to_char(p_scheduled_at AT TIME ZONE 'Africa/Algiers', 'DD/MM HH24:MI'));
  RETURN v_ride;
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_scheduled_ride(DOUBLE PRECISION, DOUBLE PRECISION, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT) TO authenticated;

-- Bascule les courses programmées dont l'heure approche en 'searching' (diffusion).
-- Déclenchée par le poll chauffeur + filet cron Drive. Renvoie les ids activés.
CREATE OR REPLACE FUNCTION public.drive_activate_due_scheduled()
RETURNS TABLE(ride_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE s public.platform_settings%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  RETURN QUERY
  UPDATE public.rides r
     SET status = 'searching',
         expires_at = now() + make_interval(mins => s.drive_request_ttl_min),
         created_at = now()   -- repart « fraîche » pour le tri/diffusion
   WHERE r.status = 'scheduled'
     AND r.scheduled_at IS NOT NULL
     AND r.scheduled_at <= now() + make_interval(mins => s.drive_scheduled_lead_min)
  RETURNING r.id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_activate_due_scheduled() TO authenticated, service_role;
