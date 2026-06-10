-- =============================================================================
-- 0131 — VTC : fondations (chauffeurs, courses, offres) — Phase 1 socle
-- =============================================================================
-- Le VTC (transport de personnes) est une VERTICALE SÉPARÉE de la livraison :
-- les CHAUFFEURS sont une population TOTALEMENT DISTINCTE des LIVREURS (table,
-- présence, vérification propres). On réutilise les PATTERNS éprouvés (présence
-- géolocalisée, ledger SUM=0, FCM) mais avec leurs propres tables.
--
-- Modèle : négociation du prix (le client propose, les chauffeurs acceptent ou
-- contre-proposent, le client choisit). Commission plateforme 8 % (abonnements
-- chauffeur en Phase 2). Paiement espèces (custodian chauffeur) ou Coligo Pay.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. CHAUFFEURS (≠ livreurs `drivers`)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chauffeurs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID UNIQUE,                       -- auth.users (null avant signup)
  full_name      TEXT NOT NULL,
  phone          TEXT UNIQUE NOT NULL,
  email          TEXT,
  wilaya         TEXT,
  vehicle_make   TEXT,
  vehicle_model  TEXT,
  vehicle_plate  TEXT,
  vehicle_color  TEXT,
  is_verified    BOOLEAN NOT NULL DEFAULT false,    -- vérif docs (admin) avant de rouler
  is_frozen      BOOLEAN NOT NULL DEFAULT false,
  is_blocked     BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. PRÉSENCE chauffeur (miroir de driver_presence, population distincte)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chauffeur_presence (
  chauffeur_id UUID PRIMARY KEY REFERENCES public.chauffeurs(id) ON DELETE CASCADE,
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  is_online    BOOLEAN NOT NULL DEFAULT true,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chauffeur_presence_updated ON public.chauffeur_presence (updated_at);

-- ---------------------------------------------------------------------------
-- 3. ENUMS courses
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.ride_status AS ENUM
    ('searching','accepted','arriving','arrived','in_progress','completed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ride_offer_status AS ENUM ('offered','accepted','declined','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ride_ledger_type AS ENUM
    ('chauffeur_payout','chauffeur_owes_platform','chauffeur_cash_collected','adjustment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 4. COURSES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rides (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id             UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  chauffeur_id            UUID REFERENCES public.chauffeurs(id) ON DELETE SET NULL,
  status                  public.ride_status NOT NULL DEFAULT 'searching',
  pickup_lat              DOUBLE PRECISION NOT NULL,
  pickup_lng              DOUBLE PRECISION NOT NULL,
  pickup_text             TEXT,
  dest_lat                DOUBLE PRECISION NOT NULL,
  dest_lng                DOUBLE PRECISION NOT NULL,
  dest_text               TEXT,
  distance_km             NUMERIC(6, 2) NOT NULL DEFAULT 0,
  suggested_price_da      INTEGER NOT NULL DEFAULT 0,
  proposed_price_da       INTEGER NOT NULL DEFAULT 0,   -- prix proposé par le client
  agreed_price_da         INTEGER,                      -- prix retenu (offre acceptée)
  payment_method          TEXT NOT NULL DEFAULT 'cash'
                          CHECK (payment_method IN ('cash','coligo_pay')),
  commission_rate_applied NUMERIC(5, 4),
  commission_da           INTEGER,
  chauffeur_net_da        INTEGER,
  cancelled_by            TEXT,
  client_rating           INTEGER CHECK (client_rating BETWEEN 1 AND 5),
  chauffeur_rating        INTEGER CHECK (chauffeur_rating BETWEEN 1 AND 5),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at             TIMESTAMPTZ,
  arrived_at              TIMESTAMPTZ,
  started_at              TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  cancelled_at            TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_rides_customer ON public.rides (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rides_chauffeur ON public.rides (chauffeur_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rides_searching ON public.rides (status) WHERE status = 'searching';

-- ---------------------------------------------------------------------------
-- 5. OFFRES (négociation) — une offre par chauffeur et par course.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ride_offers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id      UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  chauffeur_id UUID NOT NULL REFERENCES public.chauffeurs(id) ON DELETE CASCADE,
  price_da     INTEGER NOT NULL CHECK (price_da > 0),
  status       public.ride_offer_status NOT NULL DEFAULT 'offered',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ride_offers_unique UNIQUE (ride_id, chauffeur_id)
);
CREATE INDEX IF NOT EXISTS idx_ride_offers_ride ON public.ride_offers (ride_id);

-- ---------------------------------------------------------------------------
-- 6. AUDIT + LEDGER course
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ride_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ride_ledger (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chauffeur_id UUID REFERENCES public.chauffeurs(id) ON DELETE SET NULL,
  ride_id      UUID REFERENCES public.rides(id) ON DELETE SET NULL,
  type         public.ride_ledger_type NOT NULL,
  amount_da    INTEGER NOT NULL,
  note         TEXT,
  settled_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ride_ledger_unique UNIQUE (ride_id, type)
);
CREATE INDEX IF NOT EXISTS idx_ride_ledger_chauffeur ON public.ride_ledger (chauffeur_id) WHERE settled_at IS NULL;

-- ---------------------------------------------------------------------------
-- 7. Paramètres plateforme VTC (barème suggéré + commission).
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS vtc_base_da            INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS vtc_per_km_da          INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS vtc_min_da             INTEGER NOT NULL DEFAULT 150,
  ADD COLUMN IF NOT EXISTS vtc_commission_rate    NUMERIC(5, 4) NOT NULL DEFAULT 0.08;

-- ---------------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.chauffeurs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chauffeur_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_offers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_ledger       ENABLE ROW LEVEL SECURITY;

-- Chauffeur : lit/maj sa propre fiche.
DROP POLICY IF EXISTS chauffeurs_self ON public.chauffeurs;
CREATE POLICY chauffeurs_self ON public.chauffeurs
  FOR SELECT USING (user_id = auth.uid());

-- Courses : le client voit les siennes ; le chauffeur voit celles qui lui sont
-- attribuées + les courses EN RECHERCHE (pour le dispatch). Écritures via RPC.
DROP POLICY IF EXISTS rides_customer_select ON public.rides;
CREATE POLICY rides_customer_select ON public.rides
  FOR SELECT USING (
    customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS rides_chauffeur_select ON public.rides;
CREATE POLICY rides_chauffeur_select ON public.rides
  FOR SELECT USING (
    status = 'searching'
    OR chauffeur_id IN (SELECT id FROM public.chauffeurs WHERE user_id = auth.uid())
  );

-- Offres : le client voit les offres sur SES courses ; le chauffeur voit les siennes.
DROP POLICY IF EXISTS ride_offers_select ON public.ride_offers;
CREATE POLICY ride_offers_select ON public.ride_offers
  FOR SELECT USING (
    ride_id IN (
      SELECT id FROM public.rides
      WHERE customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
    )
    OR chauffeur_id IN (SELECT id FROM public.chauffeurs WHERE user_id = auth.uid())
  );

-- ride_ledger : le chauffeur lit ses lignes (lecture seule).
DROP POLICY IF EXISTS ride_ledger_self ON public.ride_ledger;
CREATE POLICY ride_ledger_self ON public.ride_ledger
  FOR SELECT USING (
    chauffeur_id IN (SELECT id FROM public.chauffeurs WHERE user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 9. Présence chauffeur : heartbeat + cibles géolocalisées (miroir mig 0130).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chauffeur_heartbeat(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_online BOOLEAN DEFAULT true
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ch UUID;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN; END IF;
  IF p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN RETURN; END IF;
  SELECT id INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_ch IS NULL THEN RETURN; END IF;
  INSERT INTO public.chauffeur_presence (chauffeur_id, lat, lng, is_online, updated_at)
  VALUES (v_ch, p_lat, p_lng, COALESCE(p_online, true), now())
  ON CONFLICT (chauffeur_id) DO UPDATE
    SET lat = EXCLUDED.lat, lng = EXCLUDED.lng,
        is_online = EXCLUDED.is_online, updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.chauffeur_heartbeat(DOUBLE PRECISION, DOUBLE PRECISION, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.chauffeurs_present_near(
  p_lat        DOUBLE PRECISION,
  p_lng        DOUBLE PRECISION,
  p_radius_km  NUMERIC DEFAULT 6,
  p_within_min INTEGER DEFAULT 3
)
RETURNS TABLE(user_id UUID, chauffeur_id UUID, dist_km NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ch.user_id, ch.id,
    (6371 * acos(LEAST(1, GREATEST(-1,
      cos(radians(p_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(p_lng))
      + sin(radians(p_lat)) * sin(radians(p.lat))))))::NUMERIC AS dist_km
  FROM public.chauffeur_presence p
  JOIN public.chauffeurs ch ON ch.id = p.chauffeur_id
  WHERE p.is_online = true
    AND p.updated_at > now() - make_interval(mins => GREATEST(1, p_within_min))
    AND ch.user_id IS NOT NULL
    AND COALESCE(ch.is_frozen, false) = false
    AND COALESCE(ch.is_blocked, false) = false
    AND p_lat IS NOT NULL AND p_lng IS NOT NULL
    AND (6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(p_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(p.lat))
        )))) <= GREATEST(0.5, LEAST(COALESCE(p_radius_km, 6), 30))
  ORDER BY dist_km ASC;
$$;
GRANT EXECUTE ON FUNCTION public.chauffeurs_present_near(DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, INTEGER)
  TO authenticated, service_role;
