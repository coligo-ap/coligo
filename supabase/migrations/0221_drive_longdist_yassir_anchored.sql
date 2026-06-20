-- ============================================================================
-- 0221 — Long trajet ANCRÉ SUR YASSIR (pas inDrive), juste un peu moins cher
-- ----------------------------------------------------------------------------
-- Correction de cap (0220 tirait le long vers inDrive = trop bas, mauvais pour
-- les chauffeurs). Décision : sur le LONG (interville), s'ancrer sur YASSIR et
-- rester juste sous lui. Mesuré : Yassir interville ≈ 28-31 DA/km
-- (Tizi 122km=3777, Bouira 140km=3864, Akbou→Alger 171km=5240,
--  Sidi Aïch→Alger 202km=6022, Béjaïa→Alger 242km=6854).
--
-- On remplace la dégression (qui RÉDUISAIT le km au-delà du seuil) par un tarif
-- interville ABSOLU drive_longdist_per_km (29) appliqué au-delà de drive_degress_km
-- (60 km). Le tarif autoroute est ~indépendant de la ville d'origine. Résultat :
--   Béjaïa→Alger 242km : 162 + 23×60 + 29×182 = 6820 ; ×0,88 ≈ 6000 → −12% vs Yassir.
--   (inDrive 3970 reste loin en dessous, mais on ne le suit pas : chauffeur protégé.)
-- Court/moyen (≤60 km) INCHANGÉS.
-- ============================================================================

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS drive_longdist_per_km NUMERIC NOT NULL DEFAULT 29; -- tarif/km interville (Yassir), au-delà du seuil
UPDATE public.platform_settings
  SET drive_degress_km = 60   -- seuil interville
  WHERE id = true;

-- Coût km : tarif zone jusqu'au seuil, puis tarif interville Yassir au-delà.
CREATE OR REPLACE FUNCTION public.drive_degressive_km_cost(
  p_distance_km NUMERIC, p_per_km NUMERIC
) RETURNS NUMERIC LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$
  SELECT p_per_km * LEAST(GREATEST(0, COALESCE(p_distance_km,0)), s.drive_degress_km)
       + s.drive_longdist_per_km * GREATEST(0, COALESCE(p_distance_km,0) - s.drive_degress_km)
  FROM public.platform_settings s WHERE s.id = true;
$$;
GRANT EXECUTE ON FUNCTION public.drive_degressive_km_cost(NUMERIC, NUMERIC) TO authenticated, anon;
