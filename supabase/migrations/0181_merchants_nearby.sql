-- =============================================================================
-- 0181 — merchants_nearby : recherche des commerces par RAYON GPS réel
-- =============================================================================
-- Problème corrigé : la home affichait les commerces sans aucun filtre de
-- distance (filtre wilaya texte seulement → un client à Akbou voyait toute la
-- wilaya Béjaïa, un client à Alger pouvait voir Béjaïa). On introduit un filtre
-- par rayon RÉEL (haversine) autour de la position courante du client, trié par
-- distance croissante (plus proches d'abord), comme les grandes plateformes.
--
-- Rayon CONFIGURABLE :
--   • platform_settings.browse_radius_km          → rayon global (défaut 15 km)
--   • platform_settings.browse_radius_by_category → override PAR catégorie
--     (JSONB { "pharmacie": 5, "restaurant": 12, ... }, clés en minuscules)
-- L'appelant peut forcer un rayon (p_radius_override) pour l'« expansion » quand
-- rien n'existe à proximité (ne jamais afficher une page vide).
-- =============================================================================

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS browse_radius_km NUMERIC(5, 1) NOT NULL DEFAULT 15.0,
  ADD COLUMN IF NOT EXISTS browse_radius_by_category JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_browse_radius_pos;
ALTER TABLE public.platform_settings
  ADD CONSTRAINT platform_settings_browse_radius_pos
    CHECK (browse_radius_km > 0);

-- -----------------------------------------------------------------------------
-- RPC : ids + distance des commerces actifs dans le rayon, du plus proche au
-- plus loin. On renvoie juste (id, distance_km) et l'app hydrate la vitrine via
-- merchants_public (source unique de la forme), comme search_merchants.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merchants_nearby(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_limit INT DEFAULT 60,
  p_radius_override NUMERIC DEFAULT NULL
)
RETURNS TABLE (id UUID, distance_km DOUBLE PRECISION)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
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
  )
  SELECT id, distance_km
  FROM base
  WHERE p_lat IS NOT NULL
    AND p_lng IS NOT NULL
    AND distance_km <= eff_radius
  ORDER BY distance_km ASC
  LIMIT greatest(1, least(coalesce(p_limit, 60), 200));
$$;

GRANT EXECUTE ON FUNCTION
  public.merchants_nearby(DOUBLE PRECISION, DOUBLE PRECISION, INT, NUMERIC)
  TO anon, authenticated;
