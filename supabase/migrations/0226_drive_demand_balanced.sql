-- ============================================================================
-- 0226 — Équilibre client ↔ chauffeur : partage du headroom DEMANDE-ADAPTATIF
-- ----------------------------------------------------------------------------
-- Plutôt qu'un surge punitif (que Yassir applique et qu'inDrive exploite contre
-- lui), la TENSION offre/demande déplace la PART du headroom entre client et
-- chauffeur, dans des bornes sûres (toujours sous le concurrent) :
--
--   tension = (demande − offre) / max(1, offre)     (autour du départ, 4 km)
--   part_client = clamp(client_share − 0,30·tension, 0,30, 0,90)
--   remise      = clamp(part_client · (market_take − commission), min, max)
--
--   • chauffeurs RARES (tension > 0) → part_client ↓ → remise ↓ → prix un peu
--     plus haut → le chauffeur sort, le client est pris plus vite (gagnant-gagnant).
--   • chauffeurs NOMBREUX (tension < 0) → part_client ↑ → remise ↑ → prix plus
--     bas → avantage client.
-- Pas de majoration affichée « ×1,5 » : c'est un déplacement DOUX et borné.
-- Remplace le surge additif (anti-surge, positionnement inDrive).
-- ============================================================================

-- L'ancienne version 0-arg doit être supprimée (sinon appel 0-arg ambigu).
DROP FUNCTION IF EXISTS public.drive_competitive_discount();
CREATE OR REPLACE FUNCTION public.drive_competitive_discount(p_tension NUMERIC DEFAULT 0)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT LEAST(s.drive_undercut_max, GREATEST(s.drive_undercut_min,
           LEAST(0.90, GREATEST(0.30, s.drive_client_share - 0.30 * p_tension))
           * (s.drive_market_take - COALESCE(s.driver_fee_rate, 0))))
  FROM public.platform_settings s WHERE s.id = true;
$$;
GRANT EXECUTE ON FUNCTION public.drive_competitive_discount(NUMERIC) TO authenticated, anon;

-- drive_smart_quote v9 : tension demande/offre → part du headroom (pas de surge
-- additif). Conserve p_scheduled (course programmée = pas de tension ni horaire).
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

  -- Course immédiate : coef horaire algérien + tension offre/demande.
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
      -- Tension bornée [−1, +1] : + = chauffeurs rares, − = nombreux.
      v_tension := LEAST(1.0, GREATEST(-1.0,
        (v_demand - v_supply)::NUMERIC / GREATEST(1, v_supply)));
    END IF;
  END IF;

  v_learn := public.drive_learning_coef(p_gamme, p_at);
  -- Remise demande-adaptative : la tension déplace la part client/chauffeur.
  v_discount := public.drive_competitive_discount(v_tension);

  -- Marché (≈ concurrent) : barème zone + temps + coef horaire (PAS de surge).
  v_market := (v_base + v_time_cost) * (1 + v_tcoef)
              * (1 + LEAST(0.20, GREATEST(0, s.drive_weather_coef) + GREATEST(0, s.drive_event_coef)));
  v_raw := v_market * v_learn * (1 - v_discount);
  v_reco := (round(v_raw / 5) * 5)::INTEGER;
  -- Garde-fou : jamais au-dessus de marché × (1 − undercut_min) → imbattable.
  v_cap := (round(v_market * (1 - s.drive_undercut_min) / 5) * 5)::INTEGER;
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
