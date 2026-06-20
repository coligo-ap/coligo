-- ============================================================================
-- 0214 — Tarification PAR ZONE (ville/wilaya) — Coligo Drive
-- ----------------------------------------------------------------------------
-- Yassir tarife différemment selon la ville (mesuré : Alger 222+22,6/km vs
-- Constantine 88+27/km → +50% pour le même trajet). Un barème national unique
-- ne peut donc pas être « toujours sous Yassir » partout. On ancre le prix
-- MARCHÉ sur Yassir VILLE PAR VILLE, puis l'undercut adaptatif (0213) garantit
-- de passer dessous dans chaque ville.
--
-- Résolution 100% serveur : ancre de ville la plus proche du point de départ
-- (dans son rayon). Hors rayon (wilaya non mesurée) → barème national.
-- Confort = 1,44× Classique (mesuré) ; Moto = 0,70× (tier éco Coligo).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.drive_zone_anchor (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  lat        DOUBLE PRECISION NOT NULL,
  lng        DOUBLE PRECISION NOT NULL,
  radius_km  NUMERIC NOT NULL DEFAULT 25,
  base_da    NUMERIC NOT NULL,   -- barème Classique Yassir mesuré (marché)
  per_km_da  NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.drive_zone_anchor ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS drive_zone_anchor_read ON public.drive_zone_anchor;
CREATE POLICY drive_zone_anchor_read ON public.drive_zone_anchor FOR SELECT USING (true);

-- Ancres = ajustements marché Yassir mesurés (juin 2026, 112 trajets réels).
INSERT INTO public.drive_zone_anchor (id, label, lat, lng, radius_km, base_da, per_km_da) VALUES
  ('alger',       'Alger',       36.77,  3.06, 35, 222, 22.6),
  ('oran',        'Oran',        35.70, -0.63, 28, 180, 28.5),
  ('constantine', 'Constantine', 36.35,  6.61, 28,  90, 27.0),
  ('setif',       'Sétif',       36.19,  5.41, 30, 156, 18.0),
  ('bejaia',      'Béjaïa',      36.75,  5.06, 45, 162, 23.0),
  ('annaba',      'Annaba',      36.90,  7.76, 22, 135, 16.5),
  ('blida',       'Blida',       36.47,  2.83, 22, 200, 16.0),
  ('tlemcen',     'Tlemcen',     34.88, -1.31, 22,  95, 28.0)
ON CONFLICT (id) DO UPDATE
  SET base_da = EXCLUDED.base_da, per_km_da = EXCLUDED.per_km_da,
      radius_km = EXCLUDED.radius_km, updated_at = now();

-- Prix « marché » zone (Classique day-price, gamme appliquée) — NULL si hors zone.
CREATE OR REPLACE FUNCTION public.drive_zone_recommended(
  p_distance_km NUMERIC, p_gamme TEXT, p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION,
  p_at TIMESTAMPTZ DEFAULT now()
) RETURNS INTEGER LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE; a public.drive_zone_anchor%ROWTYPE;
  g JSONB; v_mult NUMERIC; v_px NUMERIC; v_min NUMERIC; v_h INTEGER;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO a FROM public.drive_zone_anchor z
   WHERE (6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(p_lat)) * cos(radians(z.lat)) * cos(radians(z.lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(z.lat)))))) <= z.radius_km
   ORDER BY (6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(p_lat)) * cos(radians(z.lat)) * cos(radians(z.lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(z.lat)))))) ASC
   LIMIT 1;
  IF a.id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  g := s.drive_pricing -> COALESCE(NULLIF(p_gamme,''), 'classic');
  IF g IS NULL THEN g := s.drive_pricing -> 'classic'; END IF;
  v_mult := CASE COALESCE(NULLIF(p_gamme,''),'classic')
              WHEN 'confort' THEN 1.44 WHEN 'moto' THEN 0.70 ELSE 1.0 END;
  v_min := COALESCE((g->>'min')::NUMERIC, s.vtc_min_da);

  v_px := (a.base_da + a.per_km_da * GREATEST(0, COALESCE(p_distance_km,0))) * v_mult;
  -- Majoration nuit silencieuse (cohérente avec drive_recommended_price).
  v_h := EXTRACT(HOUR FROM (p_at AT TIME ZONE 'Africa/Algiers'))::INTEGER;
  IF (s.drive_night_start_h > s.drive_night_end_h AND (v_h >= s.drive_night_start_h OR v_h < s.drive_night_end_h))
     OR (s.drive_night_start_h <= s.drive_night_end_h AND v_h >= s.drive_night_start_h AND v_h < s.drive_night_end_h) THEN
    v_px := v_px * (1 + LEAST(s.drive_night_coef, 0.20));
  END IF;
  RETURN GREATEST(v_min, round(v_px / 5) * 5)::INTEGER;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_zone_recommended(NUMERIC, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ) TO authenticated, anon;

-- drive_smart_quote v5 : base = zone (si point connu) sinon national.
CREATE OR REPLACE FUNCTION public.drive_smart_quote(
  p_distance_km NUMERIC,
  p_gamme       TEXT DEFAULT 'classic',
  p_pickup_lat  DOUBLE PRECISION DEFAULT NULL,
  p_pickup_lng  DOUBLE PRECISION DEFAULT NULL,
  p_at          TIMESTAMPTZ DEFAULT now()
) RETURNS TABLE(
  floor_da INTEGER, mini_da INTEGER, reco_da INTEGER, fast_da INTEGER,
  demand_n INTEGER, supply_n INTEGER, surge NUMERIC, learn NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE;
  g JSONB; v_base INTEGER; v_floor INTEGER;
  v_per_min NUMERIC; v_minutes NUMERIC; v_time_cost NUMERIC;
  v_h INTEGER; v_dow INTEGER; v_rush NUMERIC := 0; v_wk NUMERIC := 0;
  v_demand INTEGER := 0; v_supply INTEGER := 0; v_surge NUMERIC := 0;
  v_learn NUMERIC; v_discount NUMERIC; v_market NUMERIC; v_raw NUMERIC;
  v_cap INTEGER; v_reco INTEGER;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  g := s.drive_pricing -> COALESCE(NULLIF(p_gamme, ''), 'classic');
  IF g IS NULL THEN g := s.drive_pricing -> 'classic'; END IF;

  -- Base MARCHÉ : ancre de ville si point de départ connu, sinon national.
  v_base  := COALESCE(
               public.drive_zone_recommended(p_distance_km, p_gamme, p_pickup_lat, p_pickup_lng, p_at),
               public.drive_recommended_price(p_distance_km, p_gamme, p_at));
  v_floor := public.drive_price_floor(p_distance_km, p_gamme);

  v_per_min := COALESCE((g->>'per_min')::NUMERIC, 0);
  v_minutes := GREATEST(0, COALESCE(p_distance_km, 0)) / GREATEST(10, s.drive_avg_speed_kmh) * 60;
  v_time_cost := v_per_min * v_minutes;

  v_h   := EXTRACT(HOUR   FROM (p_at AT TIME ZONE 'Africa/Algiers'))::INTEGER;
  v_dow := EXTRACT(ISODOW FROM (p_at AT TIME ZONE 'Africa/Algiers'))::INTEGER;
  IF v_dow IN (5, 6) THEN
    v_wk := s.drive_weekend_coef;
  ELSIF (v_h BETWEEN 7 AND 9) OR (v_h BETWEEN 16 AND 19) THEN
    v_rush := s.drive_rush_coef;
  END IF;

  IF p_pickup_lat IS NOT NULL AND p_pickup_lng IS NOT NULL THEN
    SELECT count(*)::INTEGER INTO v_demand
    FROM public.rides r
    WHERE r.status = 'searching'
      AND r.created_at > now() - INTERVAL '15 minutes'
      AND r.pickup_lat IS NOT NULL
      AND (6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(p_pickup_lat)) * cos(radians(r.pickup_lat)) * cos(radians(r.pickup_lng) - radians(p_pickup_lng))
            + sin(radians(p_pickup_lat)) * sin(radians(r.pickup_lat)))))) <= 4;
    SELECT count(*)::INTEGER INTO v_supply
    FROM public.chauffeur_presence p
    JOIN public.chauffeurs c ON c.id = p.chauffeur_id
    WHERE p.is_online AND p.updated_at > now() - INTERVAL '3 minutes'
      AND c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked
      AND (CASE c.gamme
            WHEN 'confort' THEN COALESCE(NULLIF(p_gamme,''),'classic') IN ('classic','confort')
            WHEN 'classic' THEN COALESCE(NULLIF(p_gamme,''),'classic') = 'classic'
            ELSE COALESCE(NULLIF(p_gamme,''),'classic') = 'moto' END)
      AND (6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(p_pickup_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(p_pickup_lng))
            + sin(radians(p_pickup_lat)) * sin(radians(p.lat)))))) <= 4;
    v_surge := LEAST(s.drive_surge_max, GREATEST(-0.05,
      (v_demand - v_supply)::NUMERIC / GREATEST(1, v_supply) * 0.10));
  END IF;

  v_learn := public.drive_learning_coef(p_gamme, p_at);
  v_discount := public.drive_competitive_discount();

  v_market := (v_base + v_time_cost)
              * (1 + v_rush) * (1 + v_wk) * (1 + v_surge)
              * (1 + LEAST(0.20, GREATEST(0, s.drive_weather_coef) + GREATEST(0, s.drive_event_coef)));
  v_raw := v_market * v_learn * (1 - v_discount);
  v_reco := (round(v_raw / 5) * 5)::INTEGER;
  v_cap := (round(v_market * (1 - s.drive_undercut_min) / 5) * 5)::INTEGER;
  v_reco := LEAST(v_reco, v_cap);
  v_reco := GREATEST(v_floor, v_reco);

  floor_da := v_floor;
  reco_da  := v_reco;
  mini_da  := GREATEST(v_floor, (round(v_reco * (1 - s.drive_mini_rate) / 5) * 5))::INTEGER;
  fast_da  := LEAST(v_cap, (round(v_reco * (1 + s.drive_fast_rate) / 5) * 5))::INTEGER;
  demand_n := v_demand; supply_n := v_supply; surge := v_surge; learn := v_learn;
  RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_smart_quote(NUMERIC, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ) TO authenticated, anon;
