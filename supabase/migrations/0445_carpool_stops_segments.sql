-- =============================================================================
-- 0445 — COVOITURAGE v2 : ARRÊTS INTERMÉDIAIRES + RÉSERVATION PAR SEGMENT
-- =============================================================================
-- Modèle BlaBlaCar complet : un départ = une suite d'ARRÊTS ordonnés
-- (Béjaïa → Bouira → Alger) ; une réservation = un SEGMENT (montée → descente).
--   · Les PLACES se comptent PAR TRONÇON : 2 places Béjaïa→Bouira + 2 places
--     Bouira→Alger tiennent dans une voiture de 2 places (pas de chevauchement).
--   · PRIX PAR SEGMENT automatique : proportionnel aux km du tronçon, arrondi
--     à 50 DA, plancher 100 — le chauffeur ne fixe QUE le prix du trajet complet.
--   · HEURE DE MONTÉE à chaque arrêt : départ + km cumulés à ~70 km/h.
--   · Départ/arrivée au niveau COMMUNE (texte libre + lat/lng du gazetteer),
--     plus seulement le chef-lieu de wilaya.
-- Cycle de vie ajusté : au DÉMARRAGE, seuls les absents de l'ORIGINE (seq 0)
-- passent no-show (les passagers des arrêts suivants montent plus tard) ; à la
-- CLÔTURE, toute réservation jamais embarquée est no-show + remboursée.
-- =============================================================================

-- ── 1. Arrêts ordonnés d'un départ ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.carpool_trip_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.carpool_trips(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq >= 0),
  wilaya TEXT NOT NULL REFERENCES public.wilaya_centroids(code),
  place_text TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  km_from_origin NUMERIC NOT NULL DEFAULT 0,
  UNIQUE (trip_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_carpool_stops_wilaya
  ON public.carpool_trip_stops (wilaya, trip_id);
ALTER TABLE public.carpool_trip_stops ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.carpool_bookings
  ADD COLUMN IF NOT EXISTS from_seq INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS to_seq   INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT carpool_bookings_seg CHECK (to_seq > from_seq);

-- Backfill : chaque départ existant reçoit ses 2 arrêts (origine + destination).
INSERT INTO public.carpool_trip_stops (trip_id, seq, wilaya, place_text, lat, lng, km_from_origin)
SELECT t.id, 0, t.from_wilaya, t.from_text, t.from_lat, t.from_lng, 0
  FROM public.carpool_trips t
 WHERE NOT EXISTS (SELECT 1 FROM public.carpool_trip_stops s WHERE s.trip_id = t.id)
UNION ALL
SELECT t.id, 1, t.to_wilaya, t.to_text, t.to_lat, t.to_lng, t.distance_km
  FROM public.carpool_trips t
 WHERE NOT EXISTS (SELECT 1 FROM public.carpool_trip_stops s WHERE s.trip_id = t.id);

-- ── 2. Helpers segment ─────────────────────────────────────────────────────
-- Prix d'un segment : proportionnel aux km, pas de 50 DA, plancher 100 ; le
-- trajet COMPLET vaut exactement le prix affiché (pas d'effet d'arrondi).
CREATE OR REPLACE FUNCTION public.carpool_segment_price(
  p_total_price INTEGER, p_seg_km NUMERIC, p_total_km NUMERIC
) RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_seg_km >= p_total_km THEN p_total_price
    ELSE GREATEST(100, LEAST(p_total_price,
      (round((p_total_price * p_seg_km / GREATEST(p_total_km, 1)) / 50) * 50)::INTEGER))
  END;
$$;

-- Places restantes sur un SEGMENT = capacité − pic d'occupation sur les
-- tronçons élémentaires couverts (réservations vivantes qui chevauchent).
CREATE OR REPLACE FUNCTION public.carpool_seats_left_seg(
  p_trip_id UUID, p_from_seq INTEGER, p_to_seq INTEGER
) RETURNS INTEGER LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_total INTEGER;
  v_peak INTEGER;
BEGIN
  SELECT seats_total INTO v_total FROM public.carpool_trips WHERE id = p_trip_id;
  IF v_total IS NULL THEN RETURN 0; END IF;
  SELECT COALESCE(MAX(occ), 0) INTO v_peak FROM (
    SELECT gs.s,
           COALESCE((SELECT SUM(b.seats) FROM public.carpool_bookings b
                      WHERE b.trip_id = p_trip_id
                        AND b.status IN ('booked','boarded')
                        AND b.from_seq <= gs.s AND b.to_seq > gs.s), 0) AS occ
      FROM generate_series(p_from_seq, p_to_seq - 1) AS gs(s)
  ) x;
  RETURN GREATEST(0, v_total - v_peak);
END; $$;

-- Places restantes du trajet COMPLET (pire tronçon) — même signature qu'avant.
CREATE OR REPLACE FUNCTION public.carpool_seats_left(p_trip_id UUID)
RETURNS INTEGER LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT public.carpool_seats_left_seg(
    p_trip_id, 0,
    COALESCE((SELECT MAX(s.seq) FROM public.carpool_trip_stops s
               WHERE s.trip_id = p_trip_id), 1));
$$;

-- ── 3. Publication v2 : communes + arrêts intermédiaires ───────────────────
DROP FUNCTION IF EXISTS public.carpool_publish_trip(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,INTEGER,INTEGER,BOOLEAN);
CREATE OR REPLACE FUNCTION public.carpool_publish_trip(
  p_from_wilaya TEXT, p_to_wilaya TEXT,
  p_from_text TEXT, p_to_text TEXT,
  p_departure_at TIMESTAMPTZ, p_seats INTEGER, p_price_da INTEGER,
  p_female_only BOOLEAN DEFAULT false,
  p_from_lat DOUBLE PRECISION DEFAULT NULL, p_from_lng DOUBLE PRECISION DEFAULT NULL,
  p_to_lat DOUBLE PRECISION DEFAULT NULL, p_to_lng DOUBLE PRECISION DEFAULT NULL,
  -- Arrêts INTERMÉDIAIRES ordonnés : [{"wilaya","text","lat","lng"}] (≤ 3).
  p_stops JSONB DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ch public.chauffeurs%ROWTYPE;
  v_from public.wilaya_centroids%ROWTYPE;
  v_to   public.wilaya_centroids%ROWTYPE;
  v_trip UUID; v_active INTEGER;
  v_stop JSONB; v_n INTEGER; v_prev_w TEXT;
  v_lat DOUBLE PRECISION; v_lng DOUBLE PRECISION; v_w TEXT;
  v_pts JSONB := '[]'::jsonb;            -- points ordonnés (origine…destination)
  v_km NUMERIC := 0; v_prev_lat DOUBLE PRECISION; v_prev_lng DOUBLE PRECISION;
  v_seq INTEGER := 0;
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

  -- Points ordonnés : origine (commune si fournie, sinon chef-lieu) → arrêts
  -- validés (wilaya connue, ≠ voisins consécutifs) → destination.
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

  -- Kilométrage cumulé le long des points.
  FOR v_n IN 1 .. jsonb_array_length(v_pts) - 1 LOOP
    v_km := v_km + public.km_between(
      (v_pts->(v_n-1)->>'lat')::DOUBLE PRECISION, (v_pts->(v_n-1)->>'lng')::DOUBLE PRECISION,
      (v_pts->v_n->>'lat')::DOUBLE PRECISION, (v_pts->v_n->>'lng')::DOUBLE PRECISION)::NUMERIC;
  END LOOP;
  IF v_km < 35 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_interwilaya');
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

  -- Arrêts persistés avec km cumulés (base du prix + de l'heure de montée).
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

-- ── 4. Recherche v2 : correspondance PAR SEGMENT (façon BlaBlaCar) ─────────
DROP FUNCTION IF EXISTS public.carpool_search_trips(TEXT,TEXT,DATE);
CREATE OR REPLACE FUNCTION public.carpool_search_trips(
  p_from_wilaya TEXT DEFAULT NULL, p_to_wilaya TEXT DEFAULT NULL,
  p_date DATE DEFAULT NULL
) RETURNS TABLE(
  id UUID, from_wilaya TEXT, to_wilaya TEXT, from_text TEXT, to_text TEXT,
  distance_km NUMERIC, departure_at TIMESTAMPTZ,
  seats_total INTEGER, seats_left INTEGER, price_per_seat_da INTEGER,
  female_only BOOLEAN, chauffeur_name TEXT, chauffeur_rating NUMERIC,
  gamme TEXT, my_booking_id UUID,
  -- Segment correspondant à la recherche (montée → descente) :
  from_seq INTEGER, to_seq INTEGER,
  seg_from_wilaya TEXT, seg_to_wilaya TEXT,
  seg_from_text TEXT, seg_to_text TEXT,
  seg_km NUMERIC, seg_price_da INTEGER, seg_departure_at TIMESTAMPTZ,
  -- Itinéraire complet (wilayas ordonnées) pour l'affichage « via … » :
  route_wilayas TEXT[], route_texts TEXT[]
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_customer UUID;
BEGIN
  IF public.feature_blocked('drive')
     OR public.feature_blocked('drive_interwilaya')
     OR public.feature_blocked('drive_carpool') THEN
    RETURN;
  END IF;
  SELECT cu.id INTO v_customer FROM public.customers cu WHERE cu.user_id = auth.uid();
  RETURN QUERY
  SELECT t.id, t.from_wilaya, t.to_wilaya, t.from_text, t.to_text,
         t.distance_km, t.departure_at, t.seats_total,
         public.carpool_seats_left_seg(t.id, s1.seq, s2.seq) AS seats_left,
         t.price_per_seat_da, t.female_only,
         COALESCE(NULLIF(split_part(ch.full_name, ' ', 1), ''), 'Chauffeur'),
         (SELECT round(avg(r.chauffeur_rating)::NUMERIC, 1) FROM public.rides r
           WHERE r.chauffeur_id = t.chauffeur_id AND r.chauffeur_rating IS NOT NULL),
         ch.gamme,
         (SELECT b.id FROM public.carpool_bookings b
           WHERE b.trip_id = t.id AND b.customer_id = v_customer
             AND b.status IN ('booked','boarded') LIMIT 1),
         s1.seq, s2.seq,
         s1.wilaya, s2.wilaya, s1.place_text, s2.place_text,
         (s2.km_from_origin - s1.km_from_origin) AS seg_km,
         public.carpool_segment_price(t.price_per_seat_da,
           s2.km_from_origin - s1.km_from_origin, t.distance_km) AS seg_price_da,
         t.departure_at
           + make_interval(mins => round(s1.km_from_origin / 70.0 * 60)::INTEGER)
           AS seg_departure_at,
         (SELECT array_agg(s.wilaya ORDER BY s.seq) FROM public.carpool_trip_stops s
           WHERE s.trip_id = t.id),
         (SELECT array_agg(COALESCE(s.place_text, '') ORDER BY s.seq)
            FROM public.carpool_trip_stops s WHERE s.trip_id = t.id)
    FROM public.carpool_trips t
    JOIN public.chauffeurs ch ON ch.id = t.chauffeur_id
    CROSS JOIN LATERAL (
      SELECT s.* FROM public.carpool_trip_stops s
       WHERE s.trip_id = t.id
         AND ((p_from_wilaya IS NULL AND s.seq = 0)
              OR (p_from_wilaya IS NOT NULL AND s.wilaya = p_from_wilaya))
       ORDER BY s.seq ASC LIMIT 1
    ) s1
    CROSS JOIN LATERAL (
      SELECT s.* FROM public.carpool_trip_stops s
       WHERE s.trip_id = t.id AND s.seq > s1.seq
         AND ((p_to_wilaya IS NULL
               AND s.seq = (SELECT MAX(s3.seq) FROM public.carpool_trip_stops s3
                             WHERE s3.trip_id = t.id))
              OR (p_to_wilaya IS NOT NULL AND s.wilaya = p_to_wilaya))
       ORDER BY s.seq DESC LIMIT 1
    ) s2
   WHERE t.status = 'published'
     -- L'heure qui compte pour le passager : sa MONTÉE à son arrêt.
     AND t.departure_at
         + make_interval(mins => round(s1.km_from_origin / 70.0 * 60)::INTEGER) > now()
     AND (p_date IS NULL OR ((t.departure_at
          + make_interval(mins => round(s1.km_from_origin / 70.0 * 60)::INTEGER))
          AT TIME ZONE 'Africa/Algiers')::date = p_date)
     AND public.carpool_seats_left_seg(t.id, s1.seq, s2.seq) > 0
   ORDER BY seg_departure_at ASC
   LIMIT 50;
END; $$;

-- ── 5. Réservation v2 : PAR SEGMENT ────────────────────────────────────────
DROP FUNCTION IF EXISTS public.carpool_book_seats(UUID,INTEGER,TEXT,TEXT);
CREATE OR REPLACE FUNCTION public.carpool_book_seats(
  p_trip_id UUID, p_seats INTEGER, p_payment TEXT, p_operation_id TEXT DEFAULT NULL,
  p_from_seq INTEGER DEFAULT NULL, p_to_seq INTEGER DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_customer UUID; v_trip public.carpool_trips%ROWTYPE;
  v_left INTEGER; v_amount INTEGER; v_bal NUMERIC; v_pin TEXT; v_id UUID;
  v_existing public.carpool_bookings%ROWTYPE;
  v_last INTEGER; v_f INTEGER; v_t INTEGER; v_seg_km NUMERIC;
BEGIN
  SELECT cu.id INTO v_customer FROM public.customers cu WHERE cu.user_id = auth.uid();
  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_customer');
  END IF;
  IF p_seats IS NULL OR p_seats < 1 OR p_seats > 4
     OR p_payment NOT IN ('coligo_pay','cash') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_input');
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
  -- La montée du passager doit être dans le futur.
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

-- ── 6. Lectures v2 : segments visibles partout ─────────────────────────────
DROP FUNCTION IF EXISTS public.carpool_my_bookings();
CREATE OR REPLACE FUNCTION public.carpool_my_bookings()
RETURNS TABLE(
  id UUID, status TEXT, seats INTEGER, amount_da INTEGER,
  payment_method TEXT, pin TEXT, refunded_da INTEGER,
  trip_id UUID, trip_status TEXT, from_wilaya TEXT, to_wilaya TEXT,
  from_text TEXT, to_text TEXT, departure_at TIMESTAMPTZ,
  price_per_seat_da INTEGER, chauffeur_name TEXT, created_at TIMESTAMPTZ,
  seg_from_wilaya TEXT, seg_to_wilaya TEXT, seg_from_text TEXT, seg_to_text TEXT,
  seg_departure_at TIMESTAMPTZ
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
         t.departure_at + make_interval(mins => round(s1.km_from_origin / 70.0 * 60)::INTEGER)
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

DROP FUNCTION IF EXISTS public.carpool_trip_bookings(UUID);
CREATE OR REPLACE FUNCTION public.carpool_trip_bookings(p_trip_id UUID)
RETURNS TABLE(
  id UUID, status TEXT, seats INTEGER, amount_da INTEGER,
  payment_method TEXT, customer_name TEXT, created_at TIMESTAMPTZ,
  seg_from_wilaya TEXT, seg_to_wilaya TEXT, seg_from_text TEXT, seg_to_text TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ch UUID;
BEGIN
  SELECT c.id INTO v_ch FROM public.chauffeurs c WHERE c.user_id = auth.uid();
  IF v_ch IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT b.id, b.status, b.seats, b.amount_da, b.payment_method,
         COALESCE(NULLIF(split_part(cu.full_name, ' ', 1), ''), 'Client'),
         b.created_at,
         s1.wilaya, s2.wilaya, s1.place_text, s2.place_text
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

DROP FUNCTION IF EXISTS public.carpool_my_trips();
CREATE OR REPLACE FUNCTION public.carpool_my_trips()
RETURNS TABLE(
  id UUID, status TEXT, from_wilaya TEXT, to_wilaya TEXT,
  from_text TEXT, to_text TEXT, distance_km NUMERIC,
  departure_at TIMESTAMPTZ, seats_total INTEGER, price_per_seat_da INTEGER,
  female_only BOOLEAN, seats_booked INTEGER, revenue_da INTEGER,
  created_at TIMESTAMPTZ, route_wilayas TEXT[], route_texts TEXT[]
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ch UUID;
BEGIN
  SELECT c.id INTO v_ch FROM public.chauffeurs c WHERE c.user_id = auth.uid();
  IF v_ch IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT t.id, t.status, t.from_wilaya, t.to_wilaya, t.from_text, t.to_text,
         t.distance_km, t.departure_at, t.seats_total, t.price_per_seat_da,
         t.female_only,
         -- Pic d'occupation (le « pire tronçon ») — cohérent avec les places
         -- restantes du trajet complet.
         (t.seats_total - public.carpool_seats_left(t.id))::INTEGER,
         COALESCE((SELECT SUM(b.amount_da) FROM public.carpool_bookings b
                    WHERE b.trip_id = t.id AND b.status IN ('booked','boarded','completed')), 0)::INTEGER,
         t.created_at,
         (SELECT array_agg(s.wilaya ORDER BY s.seq) FROM public.carpool_trip_stops s
           WHERE s.trip_id = t.id),
         (SELECT array_agg(COALESCE(s.place_text, '') ORDER BY s.seq)
            FROM public.carpool_trip_stops s WHERE s.trip_id = t.id)
    FROM public.carpool_trips t
   WHERE t.chauffeur_id = v_ch
   ORDER BY (t.status IN ('published','started')) DESC, t.departure_at DESC
   LIMIT 30;
END; $$;

-- ── 7. Cycle de vie : no-show par arrêt ────────────────────────────────────
-- Au DÉMARRAGE : seuls les absents de l'ORIGINE (from_seq = 0) sont no-show
-- (les passagers des arrêts suivants montent en route).
CREATE OR REPLACE FUNCTION public.carpool_start_trip(p_trip_id UUID)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ch UUID; v_trip public.carpool_trips%ROWTYPE; b public.carpool_bookings%ROWTYPE;
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
            WHERE trip_id = p_trip_id AND status = 'booked' AND from_seq = 0
            FOR UPDATE
  LOOP
    PERFORM public._carpool_refund_booking(b, 'passager absent au départ');
    UPDATE public.carpool_bookings SET status = 'no_show' WHERE id = b.id;
  END LOOP;
  UPDATE public.carpool_trips SET status = 'started', started_at = now()
   WHERE id = p_trip_id;
  RETURN jsonb_build_object('ok', true);
END; $$;

-- À la CLÔTURE : embarqués = argent (inchangé) ; jamais embarqués = no-show
-- remboursés (passagers d'arrêts intermédiaires absents).
CREATE OR REPLACE FUNCTION public.carpool_complete_trip(p_trip_id UUID)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ch UUID; v_trip public.carpool_trips%ROWTYPE; b public.carpool_bookings%ROWTYPE;
  v_rate NUMERIC(5,4); v_c INTEGER; v_paid INTEGER := 0; v_cash INTEGER := 0;
BEGIN
  SELECT c.id INTO v_ch FROM public.chauffeurs c WHERE c.user_id = auth.uid();
  SELECT * INTO v_trip FROM public.carpool_trips WHERE id = p_trip_id FOR UPDATE;
  IF v_ch IS NULL OR v_trip.id IS NULL OR v_trip.chauffeur_id <> v_ch THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_your_trip');
  END IF;
  IF v_trip.status = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already_completed');
  END IF;
  IF v_trip.status <> 'started' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_started');
  END IF;
  v_rate := public.resolve_vtc_commission(v_ch);

  FOR b IN SELECT * FROM public.carpool_bookings
            WHERE trip_id = p_trip_id AND status = 'boarded' FOR UPDATE
  LOOP
    v_c := round(b.amount_da * v_rate)::INTEGER;
    INSERT INTO public.carpool_ledger (chauffeur_id, trip_id, booking_id, type, amount_da)
    VALUES (v_ch, p_trip_id, b.id, 'chauffeur_payout', b.amount_da - v_c)
    ON CONFLICT (booking_id, type) DO NOTHING;
    IF b.payment_method = 'coligo_pay' THEN
      IF v_c > 0 THEN
        INSERT INTO public.platform_ledger (order_id, type, amount_da)
        VALUES (NULL, 'vtc_commission_income', v_c);
      END IF;
      UPDATE public.carpool_bookings SET escrow_da = 0, status = 'completed'
       WHERE id = b.id;
      v_paid := v_paid + b.amount_da;
    ELSE
      INSERT INTO public.carpool_ledger (chauffeur_id, trip_id, booking_id, type, amount_da)
      VALUES (v_ch, p_trip_id, b.id, 'chauffeur_cash_collected', b.amount_da)
      ON CONFLICT (booking_id, type) DO NOTHING;
      IF v_c > 0 THEN
        INSERT INTO public.carpool_ledger (chauffeur_id, trip_id, booking_id, type, amount_da)
        VALUES (v_ch, p_trip_id, b.id, 'chauffeur_owes_platform', v_c)
        ON CONFLICT (booking_id, type) DO NOTHING;
      END IF;
      UPDATE public.carpool_bookings SET status = 'completed' WHERE id = b.id;
      v_cash := v_cash + b.amount_da;
    END IF;
  END LOOP;

  -- Jamais embarqués (arrêts intermédiaires) : no-show remboursés.
  FOR b IN SELECT * FROM public.carpool_bookings
            WHERE trip_id = p_trip_id AND status = 'booked' FOR UPDATE
  LOOP
    PERFORM public._carpool_refund_booking(b, 'passager absent à son arrêt');
    UPDATE public.carpool_bookings SET status = 'no_show' WHERE id = b.id;
  END LOOP;

  UPDATE public.carpool_trips SET status = 'completed', completed_at = now()
   WHERE id = p_trip_id;
  RETURN jsonb_build_object('ok', true, 'online_da', v_paid, 'cash_da', v_cash);
END; $$;

-- ── 8. GRANTs des signatures recréées ──────────────────────────────────────
REVOKE ALL ON FUNCTION public.carpool_publish_trip(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,INTEGER,INTEGER,BOOLEAN,DOUBLE PRECISION,DOUBLE PRECISION,DOUBLE PRECISION,DOUBLE PRECISION,JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carpool_search_trips(TEXT,TEXT,DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carpool_book_seats(UUID,INTEGER,TEXT,TEXT,INTEGER,INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carpool_my_bookings() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carpool_trip_bookings(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carpool_my_trips() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carpool_seats_left_seg(UUID,INTEGER,INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carpool_segment_price(INTEGER,NUMERIC,NUMERIC) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.carpool_publish_trip(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,INTEGER,INTEGER,BOOLEAN,DOUBLE PRECISION,DOUBLE PRECISION,DOUBLE PRECISION,DOUBLE PRECISION,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carpool_search_trips(TEXT,TEXT,DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carpool_book_seats(UUID,INTEGER,TEXT,TEXT,INTEGER,INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carpool_my_bookings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.carpool_trip_bookings(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carpool_my_trips() TO authenticated;
