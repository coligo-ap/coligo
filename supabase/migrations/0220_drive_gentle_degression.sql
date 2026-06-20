-- ============================================================================
-- 0220 — Dégression DOUCE longue distance (équilibre client / chauffeur)
-- ----------------------------------------------------------------------------
-- Constat : inDrive est très bas sur le long (Béjaïa→Alger 242km = 3970 ≈ 16/km
-- vs Yassir 6854 ≈ 28/km). MAIS à ce prix les chauffeurs ne veulent PAS des
-- longs trajets (temps + retour à vide + rares). On NE colle donc PAS le
-- plancher inDrive. On applique une dégression DOUCE : plein tarif jusqu'à
-- drive_degress_km (40), puis le km au-delà n'est facturé qu'à drive_degress_rate
-- (0,80) du tarif → Coligo se place SOUS Yassir (client content) mais AU-DESSUS
-- d'inDrive (chauffeur content). Avec la commission 0%, le chauffeur Coligo
-- gagne nettement plus qu'un chauffeur inDrive. Les cas rares se règlent par la
-- NÉGOCIATION (contre-offre chauffeur).
--
-- Ex. Béjaïa→Alger 242km (ancre Béjaïa 162+23/km) :
--   plein : 5728 ; dégressif : 162+23×40+23×0,8×202 = 4799 ; ×0,88 ≈ 4225.
--   → inDrive 3970 < Coligo 4225 < Yassir 6854. Chauffeur 0% : 4225 vs inDrive 3494 (+21%).
-- ============================================================================

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS drive_degress_km   NUMERIC NOT NULL DEFAULT 40,   -- seuil de dégression
  ADD COLUMN IF NOT EXISTS drive_degress_rate NUMERIC NOT NULL DEFAULT 0.80; -- part du tarif/km au-delà du seuil

-- Tarif linéaire dégressif partagé (km au-delà du seuil moins cher).
CREATE OR REPLACE FUNCTION public.drive_degressive_km_cost(
  p_distance_km NUMERIC, p_per_km NUMERIC
) RETURNS NUMERIC LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$
  SELECT p_per_km * LEAST(GREATEST(0, COALESCE(p_distance_km,0)), s.drive_degress_km)
       + p_per_km * s.drive_degress_rate * GREATEST(0, COALESCE(p_distance_km,0) - s.drive_degress_km)
  FROM public.platform_settings s WHERE s.id = true;
$$;
GRANT EXECUTE ON FUNCTION public.drive_degressive_km_cost(NUMERIC, NUMERIC) TO authenticated, anon;

-- drive_recommended_price (national) avec dégression.
CREATE OR REPLACE FUNCTION public.drive_recommended_price(
  p_distance_km NUMERIC, p_gamme TEXT DEFAULT 'classic', p_at TIMESTAMPTZ DEFAULT now()
) RETURNS INTEGER LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE;
  g JSONB; v_base NUMERIC; v_pkm NUMERIC; v_min NUMERIC; v_px NUMERIC; v_h INTEGER;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  g := s.drive_pricing -> COALESCE(NULLIF(p_gamme,''), 'classic');
  IF g IS NULL THEN g := s.drive_pricing -> 'classic'; END IF;
  v_base := COALESCE((g->>'base')::NUMERIC, s.vtc_base_da);
  v_pkm  := COALESCE((g->>'per_km')::NUMERIC, s.vtc_per_km_da);
  v_min  := COALESCE((g->>'min')::NUMERIC, s.vtc_min_da);
  v_px := v_base + public.drive_degressive_km_cost(p_distance_km, v_pkm);
  v_h := EXTRACT(HOUR FROM (p_at AT TIME ZONE 'Africa/Algiers'))::INTEGER;
  IF (s.drive_night_start_h > s.drive_night_end_h AND (v_h >= s.drive_night_start_h OR v_h < s.drive_night_end_h))
     OR (s.drive_night_start_h <= s.drive_night_end_h AND v_h >= s.drive_night_start_h AND v_h < s.drive_night_end_h) THEN
    v_px := v_px * (1 + LEAST(s.drive_night_coef, 0.20));
  END IF;
  RETURN GREATEST(v_min, round(v_px / 5) * 5)::INTEGER;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_recommended_price(NUMERIC, TEXT, TIMESTAMPTZ) TO authenticated, anon;

-- drive_zone_recommended (par ville) avec dégression.
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

  v_px := (a.base_da + public.drive_degressive_km_cost(p_distance_km, a.per_km_da)) * v_mult;
  v_h := EXTRACT(HOUR FROM (p_at AT TIME ZONE 'Africa/Algiers'))::INTEGER;
  IF (s.drive_night_start_h > s.drive_night_end_h AND (v_h >= s.drive_night_start_h OR v_h < s.drive_night_end_h))
     OR (s.drive_night_start_h <= s.drive_night_end_h AND v_h >= s.drive_night_start_h AND v_h < s.drive_night_end_h) THEN
    v_px := v_px * (1 + LEAST(s.drive_night_coef, 0.20));
  END IF;
  RETURN GREATEST(v_min, round(v_px / 5) * 5)::INTEGER;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_zone_recommended(NUMERIC, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ) TO authenticated, anon;
