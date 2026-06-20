-- ============================================================================
-- 0235 — Prix Drive = distance RÉELLE + TEMPS RÉEL + repli détour appris
-- ----------------------------------------------------------------------------
-- Constat (mesure live Béjaïa, brise-de-mer → tala markha) : route réelle OSRM
-- = 9,1 km mais l'app pricait parfois ~5,5 km (ligne droite) → Coligo reco 320
-- au lieu de 395 (≈ niveau inDrive 390). Trois correctifs :
--   A. Distance facturée = vraie route OSRM côté serveur (cf. action requestRide).
--   B. Repli quand OSRM est indispo = ligne droite × facteur de détour APPRIS
--      par zone (ratio route/ligne-droite réel, EMA) au lieu d'un 1,25 fixe.
--   C. Le prix intègre le TEMPS RÉEL de navigation : on facture le surplus de
--      temps dû au trafic (réel − temps fluide). Les trajets fluides ne changent
--      PAS de prix ; seuls les trajets ralentis reçoivent un supplément (Yassir).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- C. Composante TEMPS : per_min par gamme (DA / minute de RETARD trafic).
--    Free-flow inchangé → aucun saut de prix sur les trajets fluides.
-- ----------------------------------------------------------------------------
UPDATE public.platform_settings SET drive_pricing = jsonb_set(
  jsonb_set(
    jsonb_set(drive_pricing, '{classic,per_min}', '6'::jsonb, true),
    '{confort,per_min}', '9'::jsonb, true),
  '{moto,per_min}', '4'::jsonb, true)
WHERE id = true;

-- ----------------------------------------------------------------------------
-- B. Facteur de détour appris (route réelle / ligne droite) par zone.
-- ----------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS drive_detour_default NUMERIC NOT NULL DEFAULT 1.40;

CREATE TABLE IF NOT EXISTS public.drive_detour_zone (
  zone       TEXT PRIMARY KEY,          -- id d'ancre (bejaia…) ou 'national'
  ratio_ema  NUMERIC NOT NULL DEFAULT 1.40,
  n          INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.drive_detour_zone ENABLE ROW LEVEL SECURITY;

-- Zone d'ancre la plus proche (réutilise drive_zone_anchor).
CREATE OR REPLACE FUNCTION public.drive_nearest_zone(
  p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION
) RETURNS TEXT LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT z.id FROM public.drive_zone_anchor z
   WHERE p_lat IS NOT NULL AND p_lng IS NOT NULL
     AND (6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(p_lat)) * cos(radians(z.lat)) * cos(radians(z.lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(z.lat)))))) <= z.radius_km
   ORDER BY (6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(p_lat)) * cos(radians(z.lat)) * cos(radians(z.lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(z.lat)))))) ASC
   LIMIT 1;
$$;

-- Facteur de détour à appliquer pour un point (zone apprise, sinon défaut).
CREATE OR REPLACE FUNCTION public.drive_detour_factor(
  p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION
) RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_zone TEXT; v_ratio NUMERIC; v_def NUMERIC;
BEGIN
  SELECT drive_detour_default INTO v_def FROM public.platform_settings WHERE id = true;
  v_def := COALESCE(v_def, 1.40);
  v_zone := public.drive_nearest_zone(p_lat, p_lng);
  IF v_zone IS NOT NULL THEN
    SELECT ratio_ema INTO v_ratio FROM public.drive_detour_zone WHERE zone = v_zone AND n >= 5;
  END IF;
  RETURN LEAST(2.2, GREATEST(1.1, COALESCE(v_ratio, v_def)));
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_detour_factor(DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated, anon;

-- Enregistre un échantillon réel route/ligne-droite (EMA) — best-effort.
CREATE OR REPLACE FUNCTION public.drive_detour_record(
  p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION,
  p_road_km NUMERIC, p_crow_km NUMERIC
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_zone TEXT; v_ratio NUMERIC; v_step NUMERIC := 0.12;
BEGIN
  IF p_crow_km IS NULL OR p_crow_km < 0.3 OR p_road_km IS NULL THEN RETURN; END IF;
  v_ratio := p_road_km / p_crow_km;
  IF v_ratio < 1.0 OR v_ratio > 3.0 THEN RETURN; END IF;   -- aberrant → ignore
  v_zone := COALESCE(public.drive_nearest_zone(p_lat, p_lng), 'national');
  INSERT INTO public.drive_detour_zone(zone, ratio_ema, n)
  VALUES (v_zone, v_ratio, 1)
  ON CONFLICT (zone) DO UPDATE
    SET ratio_ema = public.drive_detour_zone.ratio_ema * (1 - v_step) + v_ratio * v_step,
        n = public.drive_detour_zone.n + 1,
        updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_detour_record(DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, NUMERIC) TO authenticated, anon;

-- ----------------------------------------------------------------------------
-- C (suite). drive_smart_quote : accepte la DURÉE RÉELLE (p_duration_min) et ne
-- facture que le surplus de temps (réel − fluide). Signature étendue (param
-- ajouté EN FIN → appels positionnels existants inchangés).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.drive_smart_quote(NUMERIC, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ, BOOLEAN);

CREATE OR REPLACE FUNCTION public.drive_smart_quote(
  p_distance_km NUMERIC,
  p_gamme       TEXT DEFAULT 'classic',
  p_pickup_lat  DOUBLE PRECISION DEFAULT NULL,
  p_pickup_lng  DOUBLE PRECISION DEFAULT NULL,
  p_at          TIMESTAMPTZ DEFAULT now(),
  p_scheduled   BOOLEAN DEFAULT false,
  p_duration_min NUMERIC DEFAULT NULL
) RETURNS TABLE(
  floor_da INTEGER, mini_da INTEGER, reco_da INTEGER, fast_da INTEGER,
  demand_n INTEGER, supply_n INTEGER, surge NUMERIC, learn NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE;
  g JSONB; v_base INTEGER; v_floor INTEGER;
  v_per_min NUMERIC; v_freeflow_min NUMERIC; v_minutes NUMERIC; v_time_cost NUMERIC;
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

  -- TEMPS : on ne facture QUE le retard trafic (réel − fluide). Free-flow
  -- inchangé → pas de saut de prix sur les trajets fluides ; embouteillage =
  -- supplément (façon Yassir/inDrive). p_duration_min = navigation OSRM réelle.
  v_per_min := COALESCE((g->>'per_min')::NUMERIC, 0);
  v_freeflow_min := GREATEST(0, COALESCE(p_distance_km, 0)) / GREATEST(10, s.drive_avg_speed_kmh) * 60;
  v_minutes := COALESCE(p_duration_min, v_freeflow_min);
  v_time_cost := v_per_min * GREATEST(0, v_minutes - v_freeflow_min);

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
GRANT EXECUTE ON FUNCTION public.drive_smart_quote(NUMERIC, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ, BOOLEAN, NUMERIC) TO authenticated, anon;
