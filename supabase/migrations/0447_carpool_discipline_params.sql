-- =============================================================================
-- 0447 — COVOITURAGE : DISCIPLINE PARAMÉTRABLE (super-admin) + fenêtre 21 j
-- =============================================================================
--   · `cancelled_by` sur les réservations : 'customer' / 'chauffeur' / 'system'
--     — on ne punit JAMAIS un client pour une annulation du chauffeur.
--   · CLIENT : ≥ carpool_client_cancel_limit (déf. 4) annulations SIENNES sur
--     7 j → réservation BLOQUÉE carpool_client_block_days (déf. 3 j) après la
--     dernière annulation (reason booking_blocked). Dur mais réversible.
--   · CHAUFFEUR (durci façon Uber) : ≥ carpool_driver_cancel_limit (déf. 2)
--     départs annulés AVEC passagers sur 30 j → publication bloquée
--     carpool_driver_block_days (déf. 7 j) après la dernière annulation.
--   · Fenêtre de publication/réservation : carpool_max_advance_days (déf. 21) —
--     pas de départs à 2-3 mois, l'offre reste fraîche et fiable.
-- =============================================================================

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS carpool_max_advance_days INTEGER NOT NULL DEFAULT 21,
  ADD COLUMN IF NOT EXISTS carpool_client_cancel_limit INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS carpool_client_block_days INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS carpool_driver_cancel_limit INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS carpool_driver_block_days INTEGER NOT NULL DEFAULT 7;

ALTER TABLE public.carpool_bookings
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT
    CHECK (cancelled_by IN ('customer','chauffeur','system'));

-- ── Annulation CLIENT : origine tracée ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.carpool_cancel_booking(p_booking_id UUID)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_customer UUID; v_b public.carpool_bookings%ROWTYPE;
  v_trip public.carpool_trips%ROWTYPE; v_board_at TIMESTAMPTZ; v_late BOOLEAN;
BEGIN
  SELECT cu.id INTO v_customer FROM public.customers cu WHERE cu.user_id = auth.uid();
  SELECT * INTO v_b FROM public.carpool_bookings WHERE id = p_booking_id FOR UPDATE;
  IF v_customer IS NULL OR v_b.id IS NULL OR v_b.customer_id <> v_customer THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_your_booking');
  END IF;
  IF v_b.status NOT IN ('booked','boarded') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_active');
  END IF;
  SELECT * INTO v_trip FROM public.carpool_trips WHERE id = v_b.trip_id FOR UPDATE;
  IF v_trip.status <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trip_started');
  END IF;
  v_board_at := v_trip.departure_at + make_interval(mins => round(
    COALESCE((SELECT s.km_from_origin FROM public.carpool_trip_stops s
               WHERE s.trip_id = v_trip.id AND s.seq = v_b.from_seq), 0)
    / 70.0 * 60)::INTEGER);
  v_late := now() > v_board_at - INTERVAL '2 hours';
  PERFORM public._carpool_refund_booking(v_b, 'annulation par le passager');
  UPDATE public.carpool_bookings
     SET status = 'cancelled', late_cancel = v_late, cancelled_by = 'customer'
   WHERE id = p_booking_id;
  RETURN jsonb_build_object('ok', true, 'refunded_da', v_b.escrow_da,
                            'late', v_late);
END; $$;

-- ── Annulation CHAUFFEUR / expiration SYSTÈME : origine tracée ─────────────
CREATE OR REPLACE FUNCTION public.carpool_cancel_trip(p_trip_id UUID)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ch UUID; v_trip public.carpool_trips%ROWTYPE; b public.carpool_bookings%ROWTYPE; v_n INTEGER := 0;
BEGIN
  SELECT c.id INTO v_ch FROM public.chauffeurs c WHERE c.user_id = auth.uid();
  SELECT * INTO v_trip FROM public.carpool_trips WHERE id = p_trip_id FOR UPDATE;
  IF v_ch IS NULL OR v_trip.id IS NULL OR v_trip.chauffeur_id <> v_ch THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_your_trip');
  END IF;
  IF v_trip.status <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_published');
  END IF;
  FOR b IN SELECT * FROM public.carpool_bookings
            WHERE trip_id = p_trip_id AND status IN ('booked','boarded') FOR UPDATE
  LOOP
    PERFORM public._carpool_refund_booking(b, 'départ annulé par le chauffeur');
    UPDATE public.carpool_bookings
       SET status = 'cancelled', cancelled_by = 'chauffeur' WHERE id = b.id;
    v_n := v_n + 1;
  END LOOP;
  UPDATE public.carpool_trips SET status = 'cancelled', cancelled_at = now()
   WHERE id = p_trip_id;
  RETURN jsonb_build_object('ok', true, 'refunded_bookings', v_n);
END; $$;

CREATE OR REPLACE FUNCTION public.carpool_expire_stale()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t RECORD; b public.carpool_bookings%ROWTYPE; v_n INTEGER := 0;
BEGIN
  FOR t IN SELECT * FROM public.carpool_trips
            WHERE status = 'published' AND departure_at < now() - INTERVAL '2 hours'
            FOR UPDATE SKIP LOCKED
  LOOP
    FOR b IN SELECT * FROM public.carpool_bookings
              WHERE trip_id = t.id AND status IN ('booked','boarded')
    LOOP
      PERFORM public._carpool_refund_booking(b, 'départ expiré');
      UPDATE public.carpool_bookings
         SET status = 'cancelled', cancelled_by = 'system' WHERE id = b.id;
    END LOOP;
    UPDATE public.carpool_trips SET status = 'cancelled', cancelled_at = now()
     WHERE id = t.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END; $$;

-- ── Publication v4 : fenêtre paramétrée + récidive DURCIE et bornée ────────
CREATE OR REPLACE FUNCTION public.carpool_publish_trip(
  p_from_wilaya TEXT, p_to_wilaya TEXT,
  p_from_text TEXT, p_to_text TEXT,
  p_departure_at TIMESTAMPTZ, p_seats INTEGER, p_price_da INTEGER,
  p_female_only BOOLEAN DEFAULT false,
  p_from_lat DOUBLE PRECISION DEFAULT NULL, p_from_lng DOUBLE PRECISION DEFAULT NULL,
  p_to_lat DOUBLE PRECISION DEFAULT NULL, p_to_lng DOUBLE PRECISION DEFAULT NULL,
  p_stops JSONB DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ch public.chauffeurs%ROWTYPE;
  v_from public.wilaya_centroids%ROWTYPE;
  v_to   public.wilaya_centroids%ROWTYPE;
  v_trip UUID; v_active INTEGER; v_cancel30 INTEGER; v_last_cancel TIMESTAMPTZ;
  v_stop JSONB; v_n INTEGER; v_prev_w TEXT;
  v_lat DOUBLE PRECISION; v_lng DOUBLE PRECISION; v_w TEXT;
  v_pts JSONB := '[]'::jsonb;
  v_km NUMERIC := 0; v_prev_lat DOUBLE PRECISION; v_prev_lng DOUBLE PRECISION;
  v_new_end TIMESTAMPTZ;
  v_max_days INTEGER; v_limit INTEGER; v_block_days INTEGER;
BEGIN
  SELECT c.* INTO v_ch FROM public.chauffeurs c
   WHERE c.user_id = auth.uid()
     AND c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked;
  IF v_ch.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_chauffeur');
  END IF;
  IF p_female_only AND NOT v_ch.is_female_verified THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_female_verified');
  END IF;
  SELECT * INTO v_from FROM public.wilaya_centroids WHERE code = p_from_wilaya;
  SELECT * INTO v_to   FROM public.wilaya_centroids WHERE code = p_to_wilaya;
  IF v_from.code IS NULL OR v_to.code IS NULL OR v_from.code = v_to.code THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_route');
  END IF;

  SELECT COALESCE(ps.carpool_max_advance_days, 21),
         COALESCE(ps.carpool_driver_cancel_limit, 2),
         COALESCE(ps.carpool_driver_block_days, 7)
    INTO v_max_days, v_limit, v_block_days
    FROM public.platform_settings ps WHERE ps.id = true;

  IF p_departure_at IS NULL OR p_departure_at < now() + INTERVAL '30 minutes'
     OR p_departure_at > now() + make_interval(days => v_max_days) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_departure',
                              'max_days', v_max_days);
  END IF;
  IF p_seats IS NULL OR p_seats < 1 OR p_seats > 8
     OR p_price_da IS NULL OR p_price_da < 100 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_input');
  END IF;
  IF jsonb_typeof(COALESCE(p_stops, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_stops, '[]'::jsonb)) > 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_stops');
  END IF;
  SELECT COUNT(*) INTO v_active FROM public.carpool_trips
   WHERE chauffeur_id = v_ch.id AND status IN ('published','started');
  IF v_active >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_many_trips');
  END IF;

  -- Récidive DURCIE (façon Uber) : ≥ limite d'annulations avec passagers sur
  -- 30 j → publication bloquée block_days après la DERNIÈRE annulation.
  SELECT COUNT(*), MAX(t.cancelled_at)
    INTO v_cancel30, v_last_cancel
    FROM public.carpool_trips t
   WHERE t.chauffeur_id = v_ch.id AND t.status = 'cancelled'
     AND t.cancelled_at > now() - INTERVAL '30 days'
     AND EXISTS (SELECT 1 FROM public.carpool_bookings b WHERE b.trip_id = t.id);
  IF v_cancel30 >= v_limit
     AND now() < v_last_cancel + make_interval(days => v_block_days) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_many_cancellations',
      'blocked_until', v_last_cancel + make_interval(days => v_block_days));
  END IF;

  v_pts := jsonb_build_array(jsonb_build_object(
    'w', v_from.code, 'txt', NULLIF(btrim(COALESCE(p_from_text,'')),''),
    'lat', COALESCE(p_from_lat, v_from.lat), 'lng', COALESCE(p_from_lng, v_from.lng)));
  v_prev_w := v_from.code;
  FOR v_stop IN SELECT * FROM jsonb_array_elements(COALESCE(p_stops, '[]'::jsonb))
  LOOP
    v_w := v_stop->>'wilaya';
    IF v_w IS NULL OR v_w = v_prev_w OR v_w = v_to.code
       OR NOT EXISTS (SELECT 1 FROM public.wilaya_centroids w WHERE w.code = v_w) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'bad_stops');
    END IF;
    SELECT lat, lng INTO v_lat, v_lng FROM public.wilaya_centroids WHERE code = v_w;
    v_pts := v_pts || jsonb_build_object(
      'w', v_w, 'txt', NULLIF(btrim(COALESCE(v_stop->>'text','')),''),
      'lat', COALESCE((v_stop->>'lat')::DOUBLE PRECISION, v_lat),
      'lng', COALESCE((v_stop->>'lng')::DOUBLE PRECISION, v_lng));
    v_prev_w := v_w;
  END LOOP;
  v_pts := v_pts || jsonb_build_object(
    'w', v_to.code, 'txt', NULLIF(btrim(COALESCE(p_to_text,'')),''),
    'lat', COALESCE(p_to_lat, v_to.lat), 'lng', COALESCE(p_to_lng, v_to.lng));

  FOR v_n IN 1 .. jsonb_array_length(v_pts) - 1 LOOP
    v_km := v_km + public.km_between(
      (v_pts->(v_n-1)->>'lat')::DOUBLE PRECISION, (v_pts->(v_n-1)->>'lng')::DOUBLE PRECISION,
      (v_pts->v_n->>'lat')::DOUBLE PRECISION, (v_pts->v_n->>'lng')::DOUBLE PRECISION)::NUMERIC;
  END LOOP;
  IF v_km < 35 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_interwilaya');
  END IF;

  IF p_price_da > GREATEST(500, round(v_km * 20))::INTEGER THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'price_too_high',
                              'max_da', GREATEST(500, round(v_km * 20))::INTEGER);
  END IF;

  v_new_end := p_departure_at
    + make_interval(mins => round(v_km / 70.0 * 60)::INTEGER + 60);
  IF EXISTS (
    SELECT 1 FROM public.carpool_trips t
     WHERE t.chauffeur_id = v_ch.id AND t.status IN ('published','started')
       AND p_departure_at < t.departure_at
             + make_interval(mins => round(t.distance_km / 70.0 * 60)::INTEGER + 60)
       AND t.departure_at < v_new_end
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'overlapping_trip');
  END IF;

  INSERT INTO public.carpool_trips
    (chauffeur_id, from_wilaya, to_wilaya, from_text, to_text,
     from_lat, from_lng, to_lat, to_lng, distance_km,
     departure_at, seats_total, price_per_seat_da, female_only)
  VALUES
    (v_ch.id, v_from.code, v_to.code,
     NULLIF(btrim(COALESCE(p_from_text,'')),''), NULLIF(btrim(COALESCE(p_to_text,'')),''),
     COALESCE(p_from_lat, v_from.lat), COALESCE(p_from_lng, v_from.lng),
     COALESCE(p_to_lat, v_to.lat), COALESCE(p_to_lng, v_to.lng), round(v_km),
     p_departure_at, p_seats, p_price_da, COALESCE(p_female_only, false))
  RETURNING id INTO v_trip;

  v_km := 0; v_prev_lat := NULL;
  FOR v_n IN 0 .. jsonb_array_length(v_pts) - 1 LOOP
    v_lat := (v_pts->v_n->>'lat')::DOUBLE PRECISION;
    v_lng := (v_pts->v_n->>'lng')::DOUBLE PRECISION;
    IF v_prev_lat IS NOT NULL THEN
      v_km := v_km + public.km_between(v_prev_lat, v_prev_lng, v_lat, v_lng)::NUMERIC;
    END IF;
    INSERT INTO public.carpool_trip_stops (trip_id, seq, wilaya, place_text, lat, lng, km_from_origin)
    VALUES (v_trip, v_n, v_pts->v_n->>'w', v_pts->v_n->>'txt', v_lat, v_lng, round(v_km));
    v_prev_lat := v_lat; v_prev_lng := v_lng;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'trip_id', v_trip);
END; $$;

-- ── Réservation v5 : blocage client paramétré (annulations en série) ───────
CREATE OR REPLACE FUNCTION public.carpool_book_seats(
  p_trip_id UUID, p_seats INTEGER, p_payment TEXT, p_operation_id TEXT DEFAULT NULL,
  p_from_seq INTEGER DEFAULT NULL, p_to_seq INTEGER DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_customer UUID; v_trip public.carpool_trips%ROWTYPE;
  v_left INTEGER; v_amount INTEGER; v_bal NUMERIC; v_pin TEXT; v_id UUID;
  v_existing public.carpool_bookings%ROWTYPE;
  v_last INTEGER; v_f INTEGER; v_t INTEGER; v_seg_km NUMERIC;
  v_actives INTEGER; v_strikes INTEGER;
  v_cancels INTEGER; v_last_cancel TIMESTAMPTZ;
  v_limit INTEGER; v_block_days INTEGER;
BEGIN
  SELECT cu.id INTO v_customer FROM public.customers cu WHERE cu.user_id = auth.uid();
  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_customer');
  END IF;
  IF p_seats IS NULL OR p_seats < 1 OR p_seats > 4
     OR p_payment NOT IN ('coligo_pay','cash') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_input');
  END IF;

  SELECT COUNT(*) INTO v_actives FROM public.carpool_bookings b
   WHERE b.customer_id = v_customer AND b.status IN ('booked','boarded');
  IF v_actives >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_many_bookings');
  END IF;

  -- BLOCAGE annulations en série (comportement suspect/ennuyant pour les
  -- chauffeurs) : ≥ limite d'annulations DU CLIENT sur 7 j → réservation
  -- bloquée block_days (déf. 3 j) après la dernière annulation. Les
  -- annulations du CHAUFFEUR / système ne comptent JAMAIS contre le client.
  SELECT COALESCE(ps.carpool_client_cancel_limit, 4),
         COALESCE(ps.carpool_client_block_days, 3)
    INTO v_limit, v_block_days
    FROM public.platform_settings ps WHERE ps.id = true;
  SELECT COUNT(*), MAX(b.created_at)
    INTO v_cancels, v_last_cancel
    FROM public.carpool_bookings b
   WHERE b.customer_id = v_customer
     AND b.status = 'cancelled' AND b.cancelled_by = 'customer'
     AND b.created_at > now() - INTERVAL '7 days';
  IF v_cancels >= v_limit
     AND now() < v_last_cancel + make_interval(days => v_block_days) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'booking_blocked',
      'blocked_until', v_last_cancel + make_interval(days => v_block_days));
  END IF;

  IF p_payment = 'cash' THEN
    SELECT COUNT(*) INTO v_strikes FROM public.carpool_bookings b
     WHERE b.customer_id = v_customer
       AND b.created_at > now() - INTERVAL '30 days'
       AND (b.status = 'no_show' OR b.late_cancel);
    IF v_strikes >= 3 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'cash_blocked');
    END IF;
  END IF;

  SELECT * INTO v_trip FROM public.carpool_trips WHERE id = p_trip_id FOR UPDATE;
  IF v_trip.id IS NULL OR v_trip.status <> 'published' OR v_trip.departure_at <= now() - INTERVAL '2 hours' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trip_unavailable');
  END IF;
  SELECT MAX(s.seq) INTO v_last FROM public.carpool_trip_stops s WHERE s.trip_id = p_trip_id;
  v_f := COALESCE(p_from_seq, 0);
  v_t := COALESCE(p_to_seq, v_last);
  IF v_f < 0 OR v_t > v_last OR v_t <= v_f THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_segment');
  END IF;
  IF v_trip.departure_at + make_interval(mins => round(
       (SELECT s.km_from_origin FROM public.carpool_trip_stops s
         WHERE s.trip_id = p_trip_id AND s.seq = v_f) / 70.0 * 60)::INTEGER) <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trip_unavailable');
  END IF;
  IF EXISTS (SELECT 1 FROM public.chauffeurs c
              WHERE c.id = v_trip.chauffeur_id AND c.user_id = auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'own_trip');
  END IF;
  SELECT * INTO v_existing FROM public.carpool_bookings
   WHERE trip_id = p_trip_id AND customer_id = v_customer
     AND status IN ('booked','boarded') LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'booking_id', v_existing.id,
                              'pin', v_existing.pin, 'already', true);
  END IF;
  v_left := public.carpool_seats_left_seg(p_trip_id, v_f, v_t);
  IF v_left < p_seats THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_enough_seats', 'left', v_left);
  END IF;
  SELECT s2.km_from_origin - s1.km_from_origin INTO v_seg_km
    FROM public.carpool_trip_stops s1, public.carpool_trip_stops s2
   WHERE s1.trip_id = p_trip_id AND s1.seq = v_f
     AND s2.trip_id = p_trip_id AND s2.seq = v_t;
  v_amount := public.carpool_segment_price(v_trip.price_per_seat_da,
                COALESCE(v_seg_km, v_trip.distance_km), v_trip.distance_km) * p_seats;
  IF p_payment = 'coligo_pay' THEN
    SELECT public.customer_topup_balance(v_customer) INTO v_bal;
    IF COALESCE(v_bal, 0) < v_amount THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_balance',
                                'balance_da', COALESCE(v_bal, 0));
    END IF;
  END IF;
  v_pin := lpad(floor(random() * 10000)::TEXT, 4, '0');

  BEGIN
    INSERT INTO public.carpool_bookings
      (trip_id, customer_id, seats, amount_da, payment_method, escrow_da, pin,
       client_operation_id, from_seq, to_seq)
    VALUES
      (p_trip_id, v_customer, p_seats, v_amount, p_payment,
       CASE WHEN p_payment = 'coligo_pay' THEN v_amount ELSE 0 END, v_pin,
       NULLIF(btrim(COALESCE(p_operation_id,'')),''), v_f, v_t)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing FROM public.carpool_bookings
     WHERE (client_operation_id = p_operation_id AND p_operation_id IS NOT NULL)
        OR (trip_id = p_trip_id AND customer_id = v_customer
            AND status IN ('booked','boarded'))
     ORDER BY created_at DESC LIMIT 1;
    IF v_existing.id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'booking_id', v_existing.id,
                                'pin', v_existing.pin, 'already', true);
    END IF;
    RAISE;
  END;

  IF p_payment = 'coligo_pay' THEN
    INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
    VALUES (v_customer, NULL, 'topup_spent', 'topup', -v_amount,
            'Réservation covoiturage ' || p_seats || ' place(s) (séquestre)');
  END IF;
  RETURN jsonb_build_object('ok', true, 'booking_id', v_id, 'pin', v_pin,
                            'amount_da', v_amount);
END; $$;
