-- ============================================================================
-- 0236 — Facteur de détour : seuil d'activation n≥5 → n≥3
-- ----------------------------------------------------------------------------
-- Les détours par ville sont seedés depuis une MÉDIANE multi-trajets mesurée
-- (scripts/yassir/seed-detour.mjs) — déjà robuste à n=3. On abaisse le seuil
-- pour que ces villes (annaba, blida, tlemcen…) utilisent leur valeur réelle au
-- lieu du défaut 1,40. Le repli n'agit que si OSRM est indispo (rare).
-- ============================================================================
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
    SELECT ratio_ema INTO v_ratio FROM public.drive_detour_zone WHERE zone = v_zone AND n >= 3;
  END IF;
  RETURN LEAST(2.2, GREATEST(1.1, COALESCE(v_ratio, v_def)));
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_detour_factor(DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated, anon;
