-- ============================================================================
-- 0222 — Couche ACQUISITION : course programmée (no-surge) + nouveau client
-- ----------------------------------------------------------------------------
-- (1) COURSE PROGRAMMÉE (p_scheduled=true) : prix STABLE — on saute le coef
--     horaire (jour×heure) ET le surge offre/demande. « Réserve à l'avance,
--     prix garanti sans majoration » (comme Yassir, qui ne surge pas le prévu).
--
-- (2) NOUVEAU CLIENT : remise 1ʳᵉ course FINANCÉE PAR LA PLATEFORME. Le prix
--     `smart_quote` (côté chauffeur) reste INCHANGÉ → le chauffeur touche le
--     plein tarif ; le client paie moins ; Coligo absorbe l'écart (marketing,
--     comme un code promo plateforme). drive_first_ride_offer() renvoie le
--     montant à afficher/appliquer au checkout (à brancher sur le financement
--     promo plateforme existant — financeur = plateforme).
-- ============================================================================

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS drive_newcustomer_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS drive_newcustomer_rate    NUMERIC NOT NULL DEFAULT 0.25,  -- −25% 1ʳᵉ course
  ADD COLUMN IF NOT EXISTS drive_newcustomer_cap_da  INTEGER NOT NULL DEFAULT 200;   -- plafond de la remise (DA)

-- Offre nouveau client (financée plateforme). Renvoie is_new + montant remise.
CREATE OR REPLACE FUNCTION public.drive_first_ride_offer(p_base_da INTEGER)
RETURNS TABLE(is_new BOOLEAN, promo_da INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE s public.platform_settings%ROWTYPE; v_cust UUID; v_done INTEGER;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  is_new := false; promo_da := 0;
  IF NOT s.drive_newcustomer_enabled THEN RETURN NEXT; RETURN; END IF;
  SELECT cu.id INTO v_cust FROM public.customers cu WHERE cu.user_id = auth.uid();
  IF v_cust IS NULL THEN RETURN NEXT; RETURN; END IF;
  SELECT count(*)::INTEGER INTO v_done
    FROM public.rides r WHERE r.customer_id = v_cust AND r.status = 'completed';
  IF v_done = 0 THEN
    is_new := true;
    promo_da := LEAST(s.drive_newcustomer_cap_da,
                      (round(GREATEST(0, COALESCE(p_base_da,0)) * s.drive_newcustomer_rate / 5) * 5))::INTEGER;
  END IF;
  RETURN NEXT;
END; $$;
GRANT EXECUTE ON FUNCTION public.drive_first_ride_offer(INTEGER) TO authenticated;

-- drive_smart_quote v8 : ajoute p_scheduled (prix stable, sans surge horaire).
DROP FUNCTION IF EXISTS public.drive_smart_quote(NUMERIC, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ);
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
  v_floor := GREATEST(
               public.drive_price_floor(p_distance_km, p_gamme),
               (round(v_base * s.drive_floor_rate / 5) * 5)::INTEGER);

  v_per_min := COALESCE((g->>'per_min')::NUMERIC, 0);
  v_minutes := GREATEST(0, COALESCE(p_distance_km, 0)) / GREATEST(10, s.drive_avg_speed_kmh) * 60;
  v_time_cost := v_per_min * v_minutes;

  v_h   := EXTRACT(HOUR   FROM (p_at AT TIME ZONE 'Africa/Algiers'))::INTEGER;
  v_dow := EXTRACT(ISODOW FROM (p_at AT TIME ZONE 'Africa/Algiers'))::INTEGER;

  -- Course PROGRAMMÉE = prix stable : pas de coef horaire, pas de surge.
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
      v_surge := LEAST(s.drive_surge_max, GREATEST(-0.05,
        (v_demand - v_supply)::NUMERIC / GREATEST(1, v_supply) * 0.10));
    END IF;
  END IF;

  v_learn := public.drive_learning_coef(p_gamme, p_at);
  v_discount := public.drive_competitive_discount();

  v_market := (v_base + v_time_cost)
              * (1 + v_tcoef) * (1 + v_surge)
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
GRANT EXECUTE ON FUNCTION public.drive_smart_quote(NUMERIC, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ, BOOLEAN) TO authenticated, anon;
