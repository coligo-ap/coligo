-- ============================================================================
-- 0213 — Tarification COMPÉTITIVE « imbattable » Coligo Drive
-- ----------------------------------------------------------------------------
-- Objectif (stratégie d'acquisition) : être TOUJOURS sous le prix Yassir, de
-- façon SOUTENABLE, en exploitant la commission basse de Coligo.
--
-- Données : 112 trajets Yassir réels (0,4→242 km, 9 villes) → modèle marché
-- déduit  ≈ base + 27 DA/km (Classique), Confort = 1,44× Classique. Barème
-- Coligo recalé sur CE marché (avant remise) ; le moteur applique ensuite une
-- REMISE COMPÉTITIVE ADAPTATIVE pilotée par la commission chauffeur :
--
--   remise = clamp( market_take − commission_chauffeur, undercut_min, undercut_max )
--     commission 0%  → remise 20%  (lancement : acquisition, chauffeur > Yassir)
--     commission 8%  → remise 12%
--     commission 15% → remise 8%   (plancher : TOUJOURS sous Yassir)
--
-- + GARDE-FOU structurel : le prix recommandé ne peut JAMAIS dépasser
--   market × (1 − undercut_min) → imbattable par construction (surge et
--   apprentissage ne peuvent que tirer le prix VERS LE BAS).
-- + Plancher chauffeur (drive_price_floor) conservé → on ne tue pas le revenu.
-- ============================================================================

-- 1) Paramètres pilotables (super-admin).
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS drive_market_take  NUMERIC NOT NULL DEFAULT 0.20, -- commission marché supposée (Yassir) = marge d'undercut
  ADD COLUMN IF NOT EXISTS drive_undercut_min NUMERIC NOT NULL DEFAULT 0.08, -- on est TOUJOURS au moins X% sous Yassir
  ADD COLUMN IF NOT EXISTS drive_undercut_max NUMERIC NOT NULL DEFAULT 0.20; -- plafond de remise (soutenabilité)

-- 2) Barème recalé sur le marché Yassir (AVANT remise compétitive).
--    Classique ≈ Yassir national (base + 27/km) ; Confort = ×1,44 ; Moto = tier éco.
UPDATE public.platform_settings SET drive_pricing = jsonb_build_object(
  'classic', jsonb_build_object('base', 120, 'per_km', 27, 'min', 200),
  'confort', jsonb_build_object('base', 175, 'per_km', 39, 'min', 290),
  'moto',    jsonb_build_object('base',  80, 'per_km', 19, 'min', 130)
) WHERE id = true;

-- 3) Remise compétitive adaptative (fonction d'apprentissage de la commission).
CREATE OR REPLACE FUNCTION public.drive_competitive_discount()
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT LEAST(s.drive_undercut_max, GREATEST(s.drive_undercut_min,
           s.drive_market_take - COALESCE(s.driver_fee_rate, 0)))
  FROM public.platform_settings s WHERE s.id = true;
$$;
GRANT EXECUTE ON FUNCTION public.drive_competitive_discount() TO authenticated, anon;

-- 4) Devis intelligent v4 : market (surgé) → remise adaptative → garde-fou → plancher.
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

  v_base  := public.drive_recommended_price(p_distance_km, p_gamme, p_at);
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

  -- Prix MARCHÉ (≈ Yassir), surgé — sans apprentissage ni remise.
  v_market := (v_base + v_time_cost)
              * (1 + v_rush) * (1 + v_wk) * (1 + v_surge)
              * (1 + LEAST(0.20, GREATEST(0, s.drive_weather_coef) + GREATEST(0, s.drive_event_coef)));
  -- Prix Coligo = marché × apprentissage × (1 − remise adaptative).
  v_raw := v_market * v_learn * (1 - v_discount);
  v_reco := (round(v_raw / 5) * 5)::INTEGER;
  -- GARDE-FOU : jamais au-dessus de marché × (1 − undercut_min) → imbattable.
  v_cap := (round(v_market * (1 - s.drive_undercut_min) / 5) * 5)::INTEGER;
  v_reco := LEAST(v_reco, v_cap);
  -- Plancher chauffeur (on protège le revenu).
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
