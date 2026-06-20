-- ============================================================================
-- 0216 — Undercut « driver-safe » : on reste sous Yassir SANS sous-payer
-- ----------------------------------------------------------------------------
-- Retour terrain : Brise de Mer → Capritour (Tichy) = Yassir 723 (promo 623),
-- Coligo 475 → −34%. Trop bas : le chauffeur Coligo (475) gagnait MOINS que le
-- chauffeur Yassir (723×0,80=578). L'undercut à 20% (commission 0%) était trop
-- agressif. À −12%, chauffeur Coligo = 0,88×marché > 0,80×marché Yassir → il
-- gagne PLUS. On plafonne donc l'undercut à 12% (à toute commission) et on
-- ancre le plancher chauffeur sur le MARCHÉ DE LA ZONE (pas le national), pour
-- garantir un revenu juste même si l'estimation de marché sous-évalue un trajet.
-- ============================================================================

UPDATE public.platform_settings
  SET drive_undercut_max = 0.12,   -- plafond de remise (était 0.20)
      drive_undercut_min = 0.08
  WHERE id = true;

-- drive_smart_quote v6 : plancher = max(plancher national, marché_zone × floor_rate).
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

  v_base  := COALESCE(
               public.drive_zone_recommended(p_distance_km, p_gamme, p_pickup_lat, p_pickup_lng, p_at),
               public.drive_recommended_price(p_distance_km, p_gamme, p_at));
  -- Plancher chauffeur = max(plancher national, marché_zone × floor_rate).
  v_floor := GREATEST(
               public.drive_price_floor(p_distance_km, p_gamme),
               (round(v_base * s.drive_floor_rate / 5) * 5)::INTEGER);

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
