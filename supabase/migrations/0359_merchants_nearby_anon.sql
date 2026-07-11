-- 0359 — merchants_nearby lisible par les VISITEURS (anon).
--
-- Bug vécu (11/07/2026) : un visiteur NON connecté qui choisit une ville
-- (ex. Akbou) voyait « Aucun commerce actif disponible » — la home et la
-- recherche par proximité étaient vides, alors que le même appel connecté
-- renvoyait bien les commerces. Cause : la fonction était SECURITY INVOKER et
-- lisait la TABLE merchants (+ platform_settings) sous RLS → 0 ligne pour
-- anon (et le CROSS JOIN cfg vide annule tout). Un marketplace doit être
-- VISIBLE des visiteurs : c'est ce qui pousse à créer un compte.
--
-- Correctif : SECURITY DEFINER + le MÊME périmètre public que la vue
-- merchants_public (actif + catégorie non masquée). La fonction ne renvoie
-- que (id, distance_km) ; les fiches sont ensuite hydratées via
-- merchants_public (déjà lisible anon) → aucune donnée sensible exposée.

CREATE OR REPLACE FUNCTION public.merchants_nearby(
  p_lat double precision,
  p_lng double precision,
  p_limit integer DEFAULT 60,
  p_radius_override numeric DEFAULT NULL::numeric
)
 RETURNS TABLE(id uuid, distance_km double precision)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE(browse_radius_km, 15)::numeric          AS r_global,
      COALESCE(browse_radius_by_category, '{}'::jsonb)  AS r_by_cat
    FROM public.platform_settings
    WHERE id = true
  ),
  base AS (
    SELECT
      m.id,
      -- Haversine exact (km) — précision suffisante pour la livraison locale.
      2 * 6371 * asin(sqrt(
        power(sin(radians(m.latitude - p_lat) / 2), 2) +
        cos(radians(p_lat)) * cos(radians(m.latitude)) *
        power(sin(radians(m.longitude - p_lng) / 2), 2)
      )) AS distance_km,
      -- Rayon effectif : override (expansion) > override catégorie > global.
      CASE
        WHEN p_radius_override IS NOT NULL THEN p_radius_override
        ELSE COALESCE(
          NULLIF(cfg.r_by_cat ->> lower(coalesce(m.category, '')), '')::numeric,
          cfg.r_global
        )
      END AS eff_radius
    FROM public.merchants m
    CROSS JOIN cfg
    WHERE m.is_active
      AND m.latitude IS NOT NULL
      AND m.longitude IS NOT NULL
      -- Même périmètre PUBLIC que merchants_public : les catégories masquées
      -- par le super-admin n'apparaissent pas non plus par proximité.
      AND NOT EXISTS (
        SELECT 1 FROM public.merchant_categories mc
        WHERE mc.code = m.category AND mc.status = 'hidden'
      )
  )
  SELECT id, distance_km
  FROM base
  WHERE p_lat IS NOT NULL
    AND p_lng IS NOT NULL
    AND distance_km <= eff_radius
  ORDER BY distance_km ASC
  LIMIT greatest(1, least(coalesce(p_limit, 60), 200));
$function$;

-- PIÈGE grants (cf. 0303) : EXECUTE par rôle APPELANT, anon compris — le
-- marketplace est public.
REVOKE ALL ON FUNCTION public.merchants_nearby(double precision, double precision, integer, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merchants_nearby(double precision, double precision, integer, numeric) TO anon, authenticated;
