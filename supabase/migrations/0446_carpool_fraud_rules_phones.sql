-- =============================================================================
-- 0446 — COVOITURAGE : RÈGLES MÉTIER ANTI-FRAUDE + COORDONNÉES (téléphones)
-- =============================================================================
-- Règles (toutes BYPASS-PROOF, appliquées dans les RPC — jamais côté front) :
--   R1  Un chauffeur ne peut pas publier deux départs qui se CHEVAUCHENT
--       (fenêtre = départ → départ + durée estimée à 70 km/h + 1 h de marge).
--   R2  ≥ 3 départs ANNULÉS AVEC passagers sur 30 j (annulation manuelle OU
--       départ fantôme expiré) → publication refusée (too_many_cancellations).
--   R3  Client : ≥ 3 strikes sur 30 j (no-show OU annulation tardive) →
--       réservation en ESPÈCES refusée (cash_blocked) — le paiement en ligne
--       (séquestre) reste ouvert : la discipline par le paiement, façon Uber.
--   R4  Annulation TARDIVE (< 2 h avant la montée à SON arrêt) = strike
--       (late_cancel), remboursement intégral conservé au lancement.
--   R5  = R2 (l'expiration +2 h pose cancelled_at → comptée).
--   R6  PIN d'embarquement : 5 échecs → verrou 10 min (anti-bruteforce).
--   R7  Prix/place plafonné à GREATEST(500, km × 20) DA (anti-prix abusifs).
--   R8  Téléphones échangés UNIQUEMENT entre parties d'une réservation VIVANTE
--       d'un départ VIVANT (jamais avant réservation, jamais après clôture).
--   + max 3 réservations actives simultanées par client (multi-départs).
-- =============================================================================

ALTER TABLE public.carpool_trips
  ADD COLUMN IF NOT EXISTS pin_fail_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_lock_until TIMESTAMPTZ;
ALTER TABLE public.carpool_bookings
  ADD COLUMN IF NOT EXISTS late_cancel BOOLEAN NOT NULL DEFAULT false;

-- ── R1 + R2 + R7 : publication v3 (même signature que 0445) ────────────────
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
  v_trip UUID; v_active INTEGER; v_cancel30 INTEGER;
  v_stop JSONB; v_n INTEGER; v_prev_w TEXT;
  v_lat DOUBLE PRECISION; v_lng DOUBLE PRECISION; v_w TEXT;
  v_pts JSONB := '[]'::jsonb;
  v_km NUMERIC := 0; v_prev_lat DOUBLE PRECISION; v_prev_lng DOUBLE PRECISION;
  v_new_end TIMESTAMPTZ;
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
  IF p_departure_at IS NULL OR p_departure_at < now() + INTERVAL '30 minutes'
     OR p_departure_at > now() + INTERVAL '30 days' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_departure');
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

  -- R2/R5 : récidive d'annulations AVEC passagers (30 jours glissants).
  SELECT COUNT(*) INTO v_cancel30 FROM public.carpool_trips t
   WHERE t.chauffeur_id = v_ch.id AND t.status = 'cancelled'
     AND t.cancelled_at > now() - INTERVAL '30 days'
     AND EXISTS (SELECT 1 FROM public.carpool_bookings b WHERE b.trip_id = t.id);
  IF v_cancel30 >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_many_cancellations');
  END IF;

  -- Points ordonnés : origine → arrêts validés → destination.
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

  -- R7 : prix/place plafonné (anti-abus) — plancher large pour rester libre.
  IF p_price_da > GREATEST(500, round(v_km * 20))::INTEGER THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'price_too_high',
                              'max_da', GREATEST(500, round(v_km * 20))::INTEGER);
  END IF;

  -- R1 : pas deux départs qui se chevauchent (durées estimées à 70 km/h + 1 h).
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

-- ── R6 : embarquement PIN avec verrou anti-bruteforce ──────────────────────
CREATE OR REPLACE FUNCTION public.carpool_board_passenger(p_trip_id UUID, p_pin TEXT)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ch UUID; v_trip public.carpool_trips%ROWTYPE; v_b public.carpool_bookings%ROWTYPE;
BEGIN
  SELECT c.id INTO v_ch FROM public.chauffeurs c WHERE c.user_id = auth.uid();
  SELECT * INTO v_trip FROM public.carpool_trips WHERE id = p_trip_id FOR UPDATE;
  IF v_ch IS NULL OR v_trip.id IS NULL OR v_trip.chauffeur_id <> v_ch THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_your_trip');
  END IF;
  IF v_trip.status NOT IN ('published','started') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trip_closed');
  END IF;
  IF v_trip.pin_lock_until IS NOT NULL AND v_trip.pin_lock_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pin_locked');
  END IF;
  SELECT * INTO v_b FROM public.carpool_bookings
   WHERE trip_id = p_trip_id AND pin = btrim(COALESCE(p_pin,'')) AND status = 'booked'
   FOR UPDATE;
  IF v_b.id IS NULL THEN
    UPDATE public.carpool_trips
       SET pin_lock_until = CASE WHEN pin_fail_count + 1 >= 5
                                 THEN now() + INTERVAL '10 minutes' ELSE NULL END,
           -- verrou posé (5ᵉ échec) → compteur remis pour le prochain cycle
           pin_fail_count = CASE WHEN pin_fail_count + 1 >= 5 THEN 0
                                 ELSE pin_fail_count + 1 END
     WHERE id = p_trip_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_pin');
  END IF;
  UPDATE public.carpool_trips SET pin_fail_count = 0, pin_lock_until = NULL
   WHERE id = p_trip_id;
  UPDATE public.carpool_bookings SET status = 'boarded' WHERE id = v_b.id;
  RETURN jsonb_build_object('ok', true, 'booking_id', v_b.id, 'seats', v_b.seats,
                            'payment_method', v_b.payment_method, 'amount_da', v_b.amount_da);
END; $$;

-- ── R4 : annulation client — strike si tardive (< 2 h avant SA montée) ─────
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
     SET status = 'cancelled', late_cancel = v_late
   WHERE id = p_booking_id;
  RETURN jsonb_build_object('ok', true, 'refunded_da', v_b.escrow_da,
                            'late', v_late);
END; $$;

-- ── R3 + plafond réservations : réservation v3 (même signature que 0445) ───
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
BEGIN
  SELECT cu.id INTO v_customer FROM public.customers cu WHERE cu.user_id = auth.uid();
  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_customer');
  END IF;
  IF p_seats IS NULL OR p_seats < 1 OR p_seats > 4
     OR p_payment NOT IN ('coligo_pay','cash') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_input');
  END IF;

  -- Plafond global : 3 réservations VIVANTES simultanées par client.
  SELECT COUNT(*) INTO v_actives FROM public.carpool_bookings b
   WHERE b.customer_id = v_customer AND b.status IN ('booked','boarded');
  IF v_actives >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_many_bookings');
  END IF;

  -- R3 : récidive no-show / annulation tardive (30 j) → espèces refusées,
  -- le séquestre Coligo Pay reste ouvert (discipline par le paiement).
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

-- ── R8 : coordonnées — MES réservations v3 (+ téléphone du chauffeur) ──────
DROP FUNCTION IF EXISTS public.carpool_my_bookings();
CREATE OR REPLACE FUNCTION public.carpool_my_bookings()
RETURNS TABLE(
  id UUID, status TEXT, seats INTEGER, amount_da INTEGER,
  payment_method TEXT, pin TEXT, refunded_da INTEGER,
  trip_id UUID, trip_status TEXT, from_wilaya TEXT, to_wilaya TEXT,
  from_text TEXT, to_text TEXT, departure_at TIMESTAMPTZ,
  price_per_seat_da INTEGER, chauffeur_name TEXT, created_at TIMESTAMPTZ,
  seg_from_wilaya TEXT, seg_to_wilaya TEXT, seg_from_text TEXT, seg_to_text TEXT,
  seg_departure_at TIMESTAMPTZ,
  chauffeur_phone TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_customer UUID;
BEGIN
  SELECT cu.id INTO v_customer FROM public.customers cu WHERE cu.user_id = auth.uid();
  IF v_customer IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT b.id, b.status, b.seats, b.amount_da, b.payment_method, b.pin,
         b.refunded_da, t.id, t.status, t.from_wilaya, t.to_wilaya,
         t.from_text, t.to_text, t.departure_at, t.price_per_seat_da,
         COALESCE(NULLIF(split_part(ch.full_name, ' ', 1), ''), 'Chauffeur'),
         b.created_at,
         s1.wilaya, s2.wilaya, s1.place_text, s2.place_text,
         t.departure_at + make_interval(mins => round(s1.km_from_origin / 70.0 * 60)::INTEGER),
         -- R8 : téléphone du chauffeur UNIQUEMENT si la réservation ET le
         -- départ sont vivants (jamais avant réservation ni après clôture).
         CASE WHEN b.status IN ('booked','boarded')
               AND t.status IN ('published','started')
              THEN ch.phone ELSE NULL END
    FROM public.carpool_bookings b
    JOIN public.carpool_trips t ON t.id = b.trip_id
    JOIN public.chauffeurs ch ON ch.id = t.chauffeur_id
    LEFT JOIN public.carpool_trip_stops s1
           ON s1.trip_id = t.id AND s1.seq = b.from_seq
    LEFT JOIN public.carpool_trip_stops s2
           ON s2.trip_id = t.id AND s2.seq = b.to_seq
   WHERE b.customer_id = v_customer
   ORDER BY (b.status IN ('booked','boarded')) DESC, t.departure_at DESC
   LIMIT 30;
END; $$;

-- ── R8 : réservations d'un départ v3 (+ téléphone du passager) ─────────────
DROP FUNCTION IF EXISTS public.carpool_trip_bookings(UUID);
CREATE OR REPLACE FUNCTION public.carpool_trip_bookings(p_trip_id UUID)
RETURNS TABLE(
  id UUID, status TEXT, seats INTEGER, amount_da INTEGER,
  payment_method TEXT, customer_name TEXT, created_at TIMESTAMPTZ,
  seg_from_wilaya TEXT, seg_to_wilaya TEXT, seg_from_text TEXT, seg_to_text TEXT,
  customer_phone TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ch UUID;
BEGIN
  SELECT c.id INTO v_ch FROM public.chauffeurs c WHERE c.user_id = auth.uid();
  IF v_ch IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT b.id, b.status, b.seats, b.amount_da, b.payment_method,
         COALESCE(NULLIF(split_part(cu.full_name, ' ', 1), ''), 'Client'),
         b.created_at,
         s1.wilaya, s2.wilaya, s1.place_text, s2.place_text,
         CASE WHEN b.status IN ('booked','boarded')
               AND t.status IN ('published','started')
              THEN cu.phone ELSE NULL END
    FROM public.carpool_bookings b
    JOIN public.carpool_trips t ON t.id = b.trip_id
    JOIN public.customers cu ON cu.id = b.customer_id
    LEFT JOIN public.carpool_trip_stops s1
           ON s1.trip_id = t.id AND s1.seq = b.from_seq
    LEFT JOIN public.carpool_trip_stops s2
           ON s2.trip_id = t.id AND s2.seq = b.to_seq
   WHERE b.trip_id = p_trip_id AND t.chauffeur_id = v_ch
   ORDER BY b.from_seq ASC, b.created_at ASC;
END; $$;

-- ── GRANTs des fonctions recréées ──────────────────────────────────────────
REVOKE ALL ON FUNCTION public.carpool_my_bookings() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carpool_trip_bookings(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carpool_my_bookings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.carpool_trip_bookings(UUID) TO authenticated;
