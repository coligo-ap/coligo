-- ============================================================================
-- 0230 — Boucle d'AUTO-CALIBRAGE du prix (intelligence qui s'adapte)
-- ----------------------------------------------------------------------------
-- Le barème initial dérive (marché qui bouge). Plutôt que recalibrer à la main,
-- le prix s'auto-corrige depuis le COMPORTEMENT RÉEL, par ZONE × CRÉNEAU HORAIRE.
--
-- 4 signaux (fenêtre glissante) :
--   • demandes expirées sans chauffeur  → trop bas pour les chauffeurs → MONTE
--   • clients qui boostent souvent       → trop bas pour attirer        → MONTE
--   • prix accepté > prix suggéré         → les chauffeurs valorisent +  → MONTE
--   • courses prises vite au prix mini    → marge pour le client         → BAISSE
--
-- Coef appris (EMA, convergence douce) borné [drive_learn_min, drive_learn_max].
-- À froid (pas de données) → coef 1,0 (barème initial). Recalculé par le cron
-- Drive quotidien. Le coef remplace l'ancien drive_learning_coef dans le devis,
-- avec une borne ÉLARGIE (±12 % → jusqu'à −15 %/+30 %).
-- ============================================================================

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS drive_learn_min  NUMERIC NOT NULL DEFAULT 0.85,  -- borne basse coef appris
  ADD COLUMN IF NOT EXISTS drive_learn_max  NUMERIC NOT NULL DEFAULT 1.30,  -- borne haute
  ADD COLUMN IF NOT EXISTS drive_learn_step NUMERIC NOT NULL DEFAULT 0.10,  -- vitesse de convergence (EMA)
  ADD COLUMN IF NOT EXISTS drive_learn_span NUMERIC NOT NULL DEFAULT 0.30,  -- amplitude max du signal
  ADD COLUMN IF NOT EXISTS drive_learn_days INTEGER NOT NULL DEFAULT 21,    -- fenêtre d'observation
  ADD COLUMN IF NOT EXISTS drive_learn_minobs INTEGER NOT NULL DEFAULT 8;   -- échantillon mini pour ajuster

-- Coef appris persistant, par zone × créneau.
CREATE TABLE IF NOT EXISTS public.drive_price_learning (
  zone        TEXT NOT NULL,
  band        INTEGER NOT NULL,
  coef        NUMERIC NOT NULL DEFAULT 1.0,
  signal      NUMERIC NOT NULL DEFAULT 0,
  n_obs       INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (zone, band)
);
ALTER TABLE public.drive_price_learning ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS drive_price_learning_read ON public.drive_price_learning;
CREATE POLICY drive_price_learning_read ON public.drive_price_learning FOR SELECT USING (true);

-- Créneau horaire (Africa/Algiers) → bande (cohérent avec l'ancien apprentissage).
CREATE OR REPLACE FUNCTION public.drive_band(p_hour INTEGER)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_hour BETWEEN 7 AND 9   THEN 1
    WHEN p_hour BETWEEN 10 AND 15 THEN 2
    WHEN p_hour BETWEEN 16 AND 19 THEN 3
    WHEN p_hour BETWEEN 20 AND 23 THEN 4
    ELSE 0 END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_band(INTEGER) TO authenticated, anon, service_role;

-- Zone (ancre de ville) la plus proche d'un point, sinon 'national'.
CREATE OR REPLACE FUNCTION public.drive_nearest_zone(p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((
    SELECT z.id FROM public.drive_zone_anchor z
     WHERE p_lat IS NOT NULL AND p_lng IS NOT NULL
       AND (6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(p_lat)) * cos(radians(z.lat)) * cos(radians(z.lng) - radians(p_lng))
            + sin(radians(p_lat)) * sin(radians(z.lat)))))) <= z.radius_km
     ORDER BY (6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(p_lat)) * cos(radians(z.lat)) * cos(radians(z.lng) - radians(p_lng))
            + sin(radians(p_lat)) * sin(radians(z.lat)))))) ASC
     LIMIT 1), 'national');
$$;
GRANT EXECUTE ON FUNCTION public.drive_nearest_zone(DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated, anon, service_role;

-- Coef appris pour un point + heure (lu par le devis). Défaut 1,0.
CREATE OR REPLACE FUNCTION public.drive_learned_coef(
  p_gamme TEXT, p_at TIMESTAMPTZ, p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION
) RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_zone TEXT; v_band INTEGER; v_coef NUMERIC; s public.platform_settings%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  v_zone := public.drive_nearest_zone(p_lat, p_lng);
  v_band := public.drive_band(EXTRACT(HOUR FROM (p_at AT TIME ZONE 'Africa/Algiers'))::INTEGER);
  SELECT coef INTO v_coef FROM public.drive_price_learning WHERE zone = v_zone AND band = v_band;
  RETURN LEAST(s.drive_learn_max, GREATEST(s.drive_learn_min, COALESCE(v_coef, 1.0)));
END; $$;
GRANT EXECUTE ON FUNCTION public.drive_learned_coef(TEXT, TIMESTAMPTZ, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated, anon;

-- Recalcul de l'apprentissage (cron quotidien) : signaux → EMA du coef.
CREATE OR REPLACE FUNCTION public.drive_recompute_learning()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s public.platform_settings%ROWTYPE; rec RECORD; v_signal NUMERIC; v_target NUMERIC;
  v_up NUMERIC; v_down NUMERIC; v_count INTEGER := 0; v_old NUMERIC; v_new NUMERIC;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  FOR rec IN
    WITH rz AS (
      SELECT
        public.drive_nearest_zone(r.pickup_lat, r.pickup_lng) AS zone,
        public.drive_band(EXTRACT(HOUR FROM (r.created_at AT TIME ZONE 'Africa/Algiers'))::INTEGER) AS band,
        r.status, r.chauffeur_id, r.agreed_price_da, r.suggested_price_da, r.boost_amount_da
      FROM public.rides r
      WHERE r.created_at > now() - make_interval(days => s.drive_learn_days)
        AND r.pickup_lat IS NOT NULL
    )
    SELECT zone, band, count(*)::INTEGER AS n,
      avg(((boost_amount_da > 0))::INT::NUMERIC) AS boost_rate,
      avg(((status = 'cancelled' AND chauffeur_id IS NULL AND agreed_price_da IS NULL))::INT::NUMERIC) AS expiry_rate,
      avg(agreed_price_da::NUMERIC / NULLIF(suggested_price_da, 0))
        FILTER (WHERE status = 'completed' AND agreed_price_da IS NOT NULL AND suggested_price_da IS NOT NULL) AS ratio
    FROM rz GROUP BY zone, band
  LOOP
    IF rec.n < s.drive_learn_minobs THEN CONTINUE; END IF;   -- pas assez de données → on n'ajuste pas
    -- Pressions à la hausse (trop bas) et à la baisse (marge client).
    v_up := 0.6 * COALESCE(rec.expiry_rate, 0)
          + 0.5 * COALESCE(rec.boost_rate, 0)
          + 1.0 * GREATEST(0, COALESCE(rec.ratio, 1) - 1);
    v_down := 0.3 * GREATEST(0, 1 - COALESCE(rec.ratio, 1))
              * (1 - COALESCE(rec.expiry_rate, 0)) * (1 - COALESCE(rec.boost_rate, 0));
    v_signal := LEAST(1.0, v_up) - LEAST(0.5, v_down);                 -- ∈ [−0.5, 1]
    v_target := 1 + v_signal * s.drive_learn_span;                     -- cible du coef
    SELECT coef INTO v_old FROM public.drive_price_learning WHERE zone = rec.zone AND band = rec.band;
    v_old := COALESCE(v_old, 1.0);
    v_new := LEAST(s.drive_learn_max, GREATEST(s.drive_learn_min,
                   v_old + s.drive_learn_step * (v_target - v_old)));  -- EMA vers la cible
    INSERT INTO public.drive_price_learning (zone, band, coef, signal, n_obs, updated_at)
    VALUES (rec.zone, rec.band, round(v_new, 4), round(v_signal, 4), rec.n, now())
    ON CONFLICT (zone, band) DO UPDATE
      SET coef = EXCLUDED.coef, signal = EXCLUDED.signal, n_obs = EXCLUDED.n_obs, updated_at = now();
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END; $$;
GRANT EXECUTE ON FUNCTION public.drive_recompute_learning() TO service_role;

-- Le devis utilise le coef APPRIS (zone × heure) au lieu de l'ancien (borné serré).
CREATE OR REPLACE FUNCTION public.drive_smart_quote(
  p_distance_km NUMERIC,
  p_gamme       TEXT DEFAULT 'classic',
  p_pickup_lat  DOUBLE PRECISION DEFAULT NULL,
  p_pickup_lng  DOUBLE PRECISION DEFAULT NULL,
  p_at          TIMESTAMPTZ DEFAULT now(),
  p_scheduled   BOOLEAN DEFAULT false
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
  v_h INTEGER; v_dow INTEGER; v_tcoef NUMERIC := 0;
  v_demand INTEGER := 0; v_supply INTEGER := 0; v_tension NUMERIC := 0;
  v_learn NUMERIC; v_discount NUMERIC; v_market NUMERIC; v_raw NUMERIC;
  v_cap INTEGER; v_reco INTEGER;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  g := s.drive_pricing -> COALESCE(NULLIF(p_gamme, ''), 'classic');
  IF g IS NULL THEN g := s.drive_pricing -> 'classic'; END IF;

  v_base  := COALESCE(
               public.drive_zone_recommended(p_distance_km, p_gamme, p_pickup_lat, p_pickup_lng, p_at),
               public.drive_recommended_price(p_distance_km, p_gamme, p_at));
  v_floor := GREATEST(
               public.drive_price_floor(p_distance_km, p_gamme),
               (round(v_base * s.drive_floor_rate / 5) * 5)::INTEGER);

  v_per_min := COALESCE((g->>'per_min')::NUMERIC, 0);
  v_minutes := GREATEST(0, COALESCE(p_distance_km, 0)) / GREATEST(10, s.drive_avg_speed_kmh) * 60;
  v_time_cost := v_per_min * v_minutes;

  v_h   := EXTRACT(HOUR   FROM (p_at AT TIME ZONE 'Africa/Algiers'))::INTEGER;
  v_dow := EXTRACT(ISODOW FROM (p_at AT TIME ZONE 'Africa/Algiers'))::INTEGER;

  IF NOT p_scheduled THEN
    v_tcoef := public.drive_time_coef(v_dow, v_h);
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
      v_tension := LEAST(1.0, GREATEST(-1.0,
        (v_demand - v_supply)::NUMERIC / GREATEST(1, v_supply)));
    END IF;
  END IF;

  -- Coef APPRIS (auto-calibrage par zone × heure), borne élargie.
  v_learn := public.drive_learned_coef(p_gamme, p_at, p_pickup_lat, p_pickup_lng);
  v_discount := public.drive_competitive_discount(v_tension);

  v_market := (v_base + v_time_cost) * (1 + v_tcoef)
              * (1 + LEAST(0.20, GREATEST(0, s.drive_weather_coef) + GREATEST(0, s.drive_event_coef)));
  v_raw := v_market * v_learn * (1 - v_discount);
  v_reco := (round(v_raw / 5) * 5)::INTEGER;
  v_cap := (round(v_market * v_learn * (1 - s.drive_undercut_min) / 5) * 5)::INTEGER;
  v_reco := LEAST(v_reco, v_cap);
  v_reco := GREATEST(v_floor, v_reco);

  floor_da := v_floor;
  reco_da  := v_reco;
  mini_da  := GREATEST(v_floor, (round(v_reco * (1 - s.drive_mini_rate) / 5) * 5))::INTEGER;
  fast_da  := LEAST(v_cap, (round(v_reco * (1 + s.drive_fast_rate) / 5) * 5))::INTEGER;
  demand_n := v_demand; supply_n := v_supply; surge := v_tension; learn := v_learn;
  RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_smart_quote(NUMERIC, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ, BOOLEAN) TO authenticated, anon;
