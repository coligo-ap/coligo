-- =============================================================================
-- 0443 — COVOITURAGE PAR PLACES (inter-wilayas, phase 2 de 0442).
-- =============================================================================
-- Le chauffeur PUBLIE un départ programmé (wilaya → wilaya, date/heure, N
-- places, prix/place) ; les clients réservent leurs places et paient MOINS
-- cher qu'une réservation du véhicule entier. Un PIN 4 chiffres par
-- réservation, saisi par le chauffeur à l'embarquement (comme le PIN course).
--
-- ARGENT — miroir EXACT du modèle rides (complete_ride 0304, SUM=0) :
--   · Coligo Pay = séquestre INTÉGRAL à la réservation (customer_wallet_entries
--     'topup_spent' négatif) ; remboursement 'topup_credit' (annulation,
--     départ annulé, no-show au départ). Pas de partiel : solde insuffisant →
--     payer en espèces.
--   · Espèces = chauffeur custodian (cash_collected + owes_platform).
--   · À la clôture, PAR réservation embarquée : commission
--     resolve_vtc_commission(chauffeur) ; payout = montant − c ;
--     Coligo Pay → platform_ledger 'vtc_commission_income' c ;
--     espèces → carpool_ledger cash_collected + owes_platform.
--   Ledger dédié `carpool_ledger` (unique booking_id+type, résidu 0 prouvé
--   par scripts/test-carpool.mjs).
--
-- Kill-switch : flag `drive_carpool` + trigger BEFORE INSERT (aucune
-- exemption de rôle) — coupé aussi si `drive` ou `drive_interwilaya` l'est.
-- =============================================================================

-- ── 1. Tables ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.carpool_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chauffeur_id UUID NOT NULL REFERENCES public.chauffeurs(id),
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('published','started','completed','cancelled')),
  from_wilaya TEXT NOT NULL REFERENCES public.wilaya_centroids(code),
  to_wilaya   TEXT NOT NULL REFERENCES public.wilaya_centroids(code),
  from_text TEXT,                -- point de rendez-vous (libre)
  to_text   TEXT,
  from_lat DOUBLE PRECISION NOT NULL,
  from_lng DOUBLE PRECISION NOT NULL,
  to_lat   DOUBLE PRECISION NOT NULL,
  to_lng   DOUBLE PRECISION NOT NULL,
  distance_km NUMERIC NOT NULL DEFAULT 0,
  departure_at TIMESTAMPTZ NOT NULL,
  seats_total INTEGER NOT NULL CHECK (seats_total BETWEEN 1 AND 8),
  price_per_seat_da INTEGER NOT NULL CHECK (price_per_seat_da >= 50),
  female_only BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_wilaya <> to_wilaya)
);
CREATE INDEX IF NOT EXISTS idx_carpool_trips_search
  ON public.carpool_trips (status, departure_at);
CREATE INDEX IF NOT EXISTS idx_carpool_trips_chauffeur
  ON public.carpool_trips (chauffeur_id, status);

CREATE TABLE IF NOT EXISTS public.carpool_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.carpool_trips(id),
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  status TEXT NOT NULL DEFAULT 'booked'
    CHECK (status IN ('booked','boarded','completed','cancelled','no_show')),
  seats INTEGER NOT NULL CHECK (seats BETWEEN 1 AND 4),
  amount_da INTEGER NOT NULL CHECK (amount_da >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('coligo_pay','cash')),
  escrow_da INTEGER NOT NULL DEFAULT 0 CHECK (escrow_da >= 0),
  pin TEXT NOT NULL,
  client_operation_id TEXT UNIQUE,
  refunded_da INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Une seule réservation VIVANTE par client et par départ.
CREATE UNIQUE INDEX IF NOT EXISTS uq_carpool_booking_active
  ON public.carpool_bookings (trip_id, customer_id)
  WHERE status IN ('booked','boarded');
CREATE INDEX IF NOT EXISTS idx_carpool_bookings_trip
  ON public.carpool_bookings (trip_id);
CREATE INDEX IF NOT EXISTS idx_carpool_bookings_customer
  ON public.carpool_bookings (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.carpool_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chauffeur_id UUID NOT NULL REFERENCES public.chauffeurs(id),
  trip_id UUID NOT NULL REFERENCES public.carpool_trips(id),
  booking_id UUID NOT NULL REFERENCES public.carpool_bookings(id),
  type TEXT NOT NULL CHECK (type IN
    ('chauffeur_payout','chauffeur_cash_collected','chauffeur_owes_platform')),
  amount_da INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (booking_id, type)
);

-- RPC-only : RLS activée SANS policy (aucun accès direct ; service_role bypass).
ALTER TABLE public.carpool_trips    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carpool_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carpool_ledger   ENABLE ROW LEVEL SECURITY;

-- ── 2. Kill-switch (flag + trigger, aucune exemption de rôle) ─────────────
INSERT INTO public.feature_flags (key)
VALUES ('drive_carpool')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.enforce_feature_carpool()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF public.feature_blocked('drive')
     OR public.feature_blocked('drive_interwilaya')
     OR public.feature_blocked('drive_carpool') THEN
    RAISE EXCEPTION 'feature_disabled:drive_carpool' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_feature_carpool_trips ON public.carpool_trips;
CREATE TRIGGER trg_feature_carpool_trips BEFORE INSERT ON public.carpool_trips
  FOR EACH ROW EXECUTE FUNCTION public.enforce_feature_carpool();
DROP TRIGGER IF EXISTS trg_feature_carpool_bookings ON public.carpool_bookings;
CREATE TRIGGER trg_feature_carpool_bookings BEFORE INSERT ON public.carpool_bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_feature_carpool();

-- ── 3. Helpers internes ────────────────────────────────────────────────────
-- Places restantes d'un départ (réservations vivantes).
CREATE OR REPLACE FUNCTION public.carpool_seats_left(p_trip_id UUID)
RETURNS INTEGER LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT t.seats_total - COALESCE((
    SELECT SUM(b.seats) FROM public.carpool_bookings b
     WHERE b.trip_id = t.id AND b.status IN ('booked','boarded')), 0)::INTEGER
  FROM public.carpool_trips t WHERE t.id = p_trip_id;
$$;

-- Remboursement Coligo Pay d'une réservation (idempotent via refunded_da).
CREATE OR REPLACE FUNCTION public._carpool_refund_booking(p_booking public.carpool_bookings, p_note TEXT)
RETURNS VOID LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF p_booking.escrow_da > 0 AND p_booking.refunded_da = 0 THEN
    INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
    VALUES (p_booking.customer_id, NULL, 'topup_credit', 'topup', p_booking.escrow_da,
            'Remboursement covoiturage — ' || p_note);
    UPDATE public.carpool_bookings
       SET refunded_da = p_booking.escrow_da, escrow_da = 0
     WHERE id = p_booking.id;
  END IF;
END; $$;

-- Départs périmés jamais démarrés (départ + 2 h) → annulés + remboursés.
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
      UPDATE public.carpool_bookings SET status = 'cancelled' WHERE id = b.id;
    END LOOP;
    UPDATE public.carpool_trips SET status = 'cancelled', cancelled_at = now()
     WHERE id = t.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END; $$;

-- ── 4. RPC CHAUFFEUR ───────────────────────────────────────────────────────
-- Publier un départ (wilaya → wilaya ; coordonnées = centroïdes chefs-lieux).
CREATE OR REPLACE FUNCTION public.carpool_publish_trip(
  p_from_wilaya TEXT, p_to_wilaya TEXT,
  p_from_text TEXT, p_to_text TEXT,
  p_departure_at TIMESTAMPTZ, p_seats INTEGER, p_price_da INTEGER,
  p_female_only BOOLEAN DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ch public.chauffeurs%ROWTYPE;
  v_from public.wilaya_centroids%ROWTYPE;
  v_to   public.wilaya_centroids%ROWTYPE;
  v_km NUMERIC; v_trip UUID; v_active INTEGER;
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
  v_km := public.km_between(v_from.lat, v_from.lng, v_to.lat, v_to.lng)::NUMERIC;
  IF v_km < 35 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_interwilaya');
  END IF;
  IF p_departure_at IS NULL OR p_departure_at < now() + INTERVAL '30 minutes'
     OR p_departure_at > now() + INTERVAL '30 days' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_departure');
  END IF;
  IF p_seats IS NULL OR p_seats < 1 OR p_seats > 8
     OR p_price_da IS NULL OR p_price_da < 50 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_input');
  END IF;
  SELECT COUNT(*) INTO v_active FROM public.carpool_trips
   WHERE chauffeur_id = v_ch.id AND status IN ('published','started');
  IF v_active >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_many_trips');
  END IF;

  INSERT INTO public.carpool_trips
    (chauffeur_id, from_wilaya, to_wilaya, from_text, to_text,
     from_lat, from_lng, to_lat, to_lng, distance_km,
     departure_at, seats_total, price_per_seat_da, female_only)
  VALUES
    (v_ch.id, v_from.code, v_to.code,
     NULLIF(btrim(COALESCE(p_from_text,'')),''), NULLIF(btrim(COALESCE(p_to_text,'')),''),
     v_from.lat, v_from.lng, v_to.lat, v_to.lng, round(v_km),
     p_departure_at, p_seats, p_price_da, COALESCE(p_female_only, false))
  RETURNING id INTO v_trip;
  RETURN jsonb_build_object('ok', true, 'trip_id', v_trip);
END; $$;

-- Mes départs (+ agrégats de réservations vivantes).
CREATE OR REPLACE FUNCTION public.carpool_my_trips()
RETURNS TABLE(
  id UUID, status TEXT, from_wilaya TEXT, to_wilaya TEXT,
  from_text TEXT, to_text TEXT, distance_km NUMERIC,
  departure_at TIMESTAMPTZ, seats_total INTEGER, price_per_seat_da INTEGER,
  female_only BOOLEAN, seats_booked INTEGER, revenue_da INTEGER,
  created_at TIMESTAMPTZ
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ch UUID;
BEGIN
  SELECT c.id INTO v_ch FROM public.chauffeurs c WHERE c.user_id = auth.uid();
  IF v_ch IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT t.id, t.status, t.from_wilaya, t.to_wilaya, t.from_text, t.to_text,
         t.distance_km, t.departure_at, t.seats_total, t.price_per_seat_da,
         t.female_only,
         COALESCE((SELECT SUM(b.seats) FROM public.carpool_bookings b
                    WHERE b.trip_id = t.id AND b.status IN ('booked','boarded','completed')), 0)::INTEGER,
         COALESCE((SELECT SUM(b.amount_da) FROM public.carpool_bookings b
                    WHERE b.trip_id = t.id AND b.status IN ('booked','boarded','completed')), 0)::INTEGER,
         t.created_at
    FROM public.carpool_trips t
   WHERE t.chauffeur_id = v_ch
   ORDER BY (t.status IN ('published','started')) DESC, t.departure_at DESC
   LIMIT 30;
END; $$;

-- Réservations d'UN de mes départs (PIN JAMAIS renvoyé : le passager le donne).
CREATE OR REPLACE FUNCTION public.carpool_trip_bookings(p_trip_id UUID)
RETURNS TABLE(
  id UUID, status TEXT, seats INTEGER, amount_da INTEGER,
  payment_method TEXT, customer_name TEXT, created_at TIMESTAMPTZ
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ch UUID;
BEGIN
  SELECT c.id INTO v_ch FROM public.chauffeurs c WHERE c.user_id = auth.uid();
  IF v_ch IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT b.id, b.status, b.seats, b.amount_da, b.payment_method,
         COALESCE(NULLIF(split_part(cu.full_name, ' ', 1), ''), 'Client'),
         b.created_at
    FROM public.carpool_bookings b
    JOIN public.carpool_trips t ON t.id = b.trip_id
    JOIN public.customers cu ON cu.id = b.customer_id
   WHERE b.trip_id = p_trip_id AND t.chauffeur_id = v_ch
   ORDER BY b.created_at ASC;
END; $$;

-- Embarquement : le passager donne son PIN, le chauffeur le saisit.
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
  SELECT * INTO v_b FROM public.carpool_bookings
   WHERE trip_id = p_trip_id AND pin = btrim(COALESCE(p_pin,'')) AND status = 'booked'
   FOR UPDATE;
  IF v_b.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_pin');
  END IF;
  UPDATE public.carpool_bookings SET status = 'boarded' WHERE id = v_b.id;
  RETURN jsonb_build_object('ok', true, 'booking_id', v_b.id, 'seats', v_b.seats,
                            'payment_method', v_b.payment_method, 'amount_da', v_b.amount_da);
END; $$;

-- Démarrer : les réservations non embarquées deviennent no_show (remboursées).
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
            WHERE trip_id = p_trip_id AND status = 'booked' FOR UPDATE
  LOOP
    PERFORM public._carpool_refund_booking(b, 'passager absent au départ');
    UPDATE public.carpool_bookings SET status = 'no_show' WHERE id = b.id;
  END LOOP;
  UPDATE public.carpool_trips SET status = 'started', started_at = now()
   WHERE id = p_trip_id;
  RETURN jsonb_build_object('ok', true);
END; $$;

-- Clôture : ARGENT par réservation embarquée (miroir complete_ride 0304).
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
      -- Séquestre libéré : la commission reste à la plateforme.
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

  UPDATE public.carpool_trips SET status = 'completed', completed_at = now()
   WHERE id = p_trip_id;
  RETURN jsonb_build_object('ok', true, 'online_da', v_paid, 'cash_da', v_cash);
END; $$;

-- Annuler un départ (avant démarrage) : tout le monde est remboursé.
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
    UPDATE public.carpool_bookings SET status = 'cancelled' WHERE id = b.id;
    v_n := v_n + 1;
  END LOOP;
  UPDATE public.carpool_trips SET status = 'cancelled', cancelled_at = now()
   WHERE id = p_trip_id;
  RETURN jsonb_build_object('ok', true, 'refunded_bookings', v_n);
END; $$;

-- ── 5. RPC CLIENT ──────────────────────────────────────────────────────────
-- Départs publiés à venir (filtres wilaya/date), avec fiche chauffeur légère.
CREATE OR REPLACE FUNCTION public.carpool_search_trips(
  p_from_wilaya TEXT DEFAULT NULL, p_to_wilaya TEXT DEFAULT NULL,
  p_date DATE DEFAULT NULL
) RETURNS TABLE(
  id UUID, from_wilaya TEXT, to_wilaya TEXT, from_text TEXT, to_text TEXT,
  distance_km NUMERIC, departure_at TIMESTAMPTZ,
  seats_total INTEGER, seats_left INTEGER, price_per_seat_da INTEGER,
  female_only BOOLEAN, chauffeur_name TEXT, chauffeur_rating NUMERIC,
  gamme TEXT, my_booking_id UUID
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
         public.carpool_seats_left(t.id) AS seats_left,
         t.price_per_seat_da, t.female_only,
         COALESCE(NULLIF(split_part(ch.full_name, ' ', 1), ''), 'Chauffeur'),
         (SELECT round(avg(r.chauffeur_rating)::NUMERIC, 1) FROM public.rides r
           WHERE r.chauffeur_id = t.chauffeur_id AND r.chauffeur_rating IS NOT NULL),
         ch.gamme,
         (SELECT b.id FROM public.carpool_bookings b
           WHERE b.trip_id = t.id AND b.customer_id = v_customer
             AND b.status IN ('booked','boarded') LIMIT 1)
    FROM public.carpool_trips t
    JOIN public.chauffeurs ch ON ch.id = t.chauffeur_id
   WHERE t.status = 'published'
     AND t.departure_at > now()
     AND (p_from_wilaya IS NULL OR t.from_wilaya = p_from_wilaya)
     AND (p_to_wilaya IS NULL OR t.to_wilaya = p_to_wilaya)
     AND (p_date IS NULL OR (t.departure_at AT TIME ZONE 'Africa/Algiers')::date = p_date)
     AND public.carpool_seats_left(t.id) > 0
   ORDER BY t.departure_at ASC
   LIMIT 50;
END; $$;

-- Réserver ses places (Coligo Pay = séquestre intégral ; espèces = à bord).
CREATE OR REPLACE FUNCTION public.carpool_book_seats(
  p_trip_id UUID, p_seats INTEGER, p_payment TEXT, p_operation_id TEXT DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_customer UUID; v_trip public.carpool_trips%ROWTYPE;
  v_left INTEGER; v_amount INTEGER; v_bal NUMERIC; v_pin TEXT; v_id UUID;
  v_existing public.carpool_bookings%ROWTYPE;
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
  IF v_trip.id IS NULL OR v_trip.status <> 'published' OR v_trip.departure_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trip_unavailable');
  END IF;
  -- Un chauffeur ne réserve pas son propre départ.
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
  v_left := public.carpool_seats_left(p_trip_id);
  IF v_left < p_seats THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_enough_seats', 'left', v_left);
  END IF;
  v_amount := v_trip.price_per_seat_da * p_seats;
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
       client_operation_id)
    VALUES
      (p_trip_id, v_customer, p_seats, v_amount, p_payment,
       CASE WHEN p_payment = 'coligo_pay' THEN v_amount ELSE 0 END, v_pin,
       NULLIF(btrim(COALESCE(p_operation_id,'')),''))
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

-- Annuler MA réservation (tant que le départ n'a pas démarré) : remboursée.
CREATE OR REPLACE FUNCTION public.carpool_cancel_booking(p_booking_id UUID)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_customer UUID; v_b public.carpool_bookings%ROWTYPE; v_trip public.carpool_trips%ROWTYPE;
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
  PERFORM public._carpool_refund_booking(v_b, 'annulation par le passager');
  UPDATE public.carpool_bookings SET status = 'cancelled' WHERE id = p_booking_id;
  RETURN jsonb_build_object('ok', true, 'refunded_da', v_b.escrow_da);
END; $$;

-- Mes réservations (avec PIN — c'est MON billet).
CREATE OR REPLACE FUNCTION public.carpool_my_bookings()
RETURNS TABLE(
  id UUID, status TEXT, seats INTEGER, amount_da INTEGER,
  payment_method TEXT, pin TEXT, refunded_da INTEGER,
  trip_id UUID, trip_status TEXT, from_wilaya TEXT, to_wilaya TEXT,
  from_text TEXT, to_text TEXT, departure_at TIMESTAMPTZ,
  price_per_seat_da INTEGER, chauffeur_name TEXT, created_at TIMESTAMPTZ
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
         b.created_at
    FROM public.carpool_bookings b
    JOIN public.carpool_trips t ON t.id = b.trip_id
    JOIN public.chauffeurs ch ON ch.id = t.chauffeur_id
   WHERE b.customer_id = v_customer
   ORDER BY (b.status IN ('booked','boarded')) DESC, t.departure_at DESC
   LIMIT 30;
END; $$;

-- ── 6. GRANTs (tester chaque RPC EN ANON — règle du repo) ─────────────────
REVOKE ALL ON FUNCTION public.carpool_publish_trip(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,INTEGER,INTEGER,BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carpool_my_trips() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carpool_trip_bookings(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carpool_board_passenger(UUID,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carpool_start_trip(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carpool_complete_trip(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carpool_cancel_trip(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carpool_search_trips(TEXT,TEXT,DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carpool_book_seats(UUID,INTEGER,TEXT,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carpool_cancel_booking(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carpool_my_bookings() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carpool_expire_stale() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.carpool_publish_trip(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,INTEGER,INTEGER,BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carpool_my_trips() TO authenticated;
GRANT EXECUTE ON FUNCTION public.carpool_trip_bookings(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carpool_board_passenger(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carpool_start_trip(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carpool_complete_trip(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carpool_cancel_trip(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carpool_search_trips(TEXT,TEXT,DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carpool_book_seats(UUID,INTEGER,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carpool_cancel_booking(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carpool_my_bookings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.carpool_expire_stale() TO service_role;
