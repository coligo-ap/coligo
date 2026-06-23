-- =============================================================================
-- 0249 — Bannières promo CIBLÉES PAR ZONE (affichage géolocalisé)
-- =============================================================================
-- Le super-admin peut restreindre une bannière à une ou PLUSIEURS zones : elle
-- ne s'affiche alors QU'AUX utilisateurs situés dans l'une de ces zones. Une
-- bannière SANS zone reste visible par tout le monde (comportement actuel).
--
-- Une zone est géométrique (rayon : centre + km) — fiable à partir des seules
-- coordonnées de l'utilisateur, donc infalsifiable. Le schéma supporte aussi
-- wilaya/commune/polygone pour le futur ; seul le rayon est exposé côté UI v1.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.promo_banner_zones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banner_id   UUID NOT NULL REFERENCES public.promo_banners(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL CHECK (scope IN ('wilaya', 'commune', 'radius', 'polygon')),
  label       TEXT,
  wilaya_code TEXT,
  commune     TEXT,
  center_lat  DOUBLE PRECISION,
  center_lng  DOUBLE PRECISION,
  radius_km   NUMERIC,
  polygon     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promo_banner_zones_banner
  ON public.promo_banner_zones (banner_id);

-- RLS : table pilotée par le super-admin (service_role bypass) + lue par la RPC
-- SECURITY DEFINER ci-dessous. Aucune lecture/écriture directe anon/authenticated.
ALTER TABLE public.promo_banner_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS promo_banner_zones_admin_all ON public.promo_banner_zones;
CREATE POLICY promo_banner_zones_admin_all ON public.promo_banner_zones
  FOR ALL USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ----------------------------------------------------------------------------
-- RPC publique : bannières actives VISIBLES pour un point/zone donné.
-- Une bannière passe si elle n'a AUCUNE zone (globale) OU si l'utilisateur
-- matche au moins une de ses zones. Coordonnées absentes (visiteur anon sans
-- position) → seules les bannières globales s'affichent.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.active_banners_for(
  p_lat     DOUBLE PRECISION DEFAULT NULL,
  p_lng     DOUBLE PRECISION DEFAULT NULL,
  p_wilaya  TEXT DEFAULT NULL,
  p_commune TEXT DEFAULT NULL
)
RETURNS TABLE(
  id         UUID,
  title      TEXT,
  subtitle   TEXT,
  cta_label  TEXT,
  image_url  TEXT,
  image_fit  TEXT,
  link       TEXT,
  accent     TEXT,
  "position" INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT b.id, b.title, b.subtitle, b.cta_label, b.image_url, b.image_fit,
         b.link, b.accent, b.position
  FROM public.promo_banners b
  WHERE b.active = true
    AND (b.starts_at IS NULL OR b.starts_at <= now())
    AND (b.ends_at IS NULL OR b.ends_at > now())
    AND (
      NOT EXISTS (SELECT 1 FROM public.promo_banner_zones z WHERE z.banner_id = b.id)
      OR EXISTS (
        SELECT 1 FROM public.promo_banner_zones z
        WHERE z.banner_id = b.id
          AND (
               (z.scope = 'wilaya'  AND p_wilaya IS NOT NULL AND z.wilaya_code = p_wilaya)
            OR (z.scope = 'commune' AND p_commune IS NOT NULL AND lower(z.commune) = lower(p_commune))
            OR (z.scope = 'radius'  AND p_lat IS NOT NULL AND z.center_lat IS NOT NULL
                AND z.radius_km IS NOT NULL
                AND public.km_between(p_lat, p_lng, z.center_lat, z.center_lng) <= z.radius_km)
            OR (z.scope = 'polygon' AND p_lat IS NOT NULL AND z.polygon IS NOT NULL
                AND public._coligo_point_in_polygon(p_lat, p_lng, z.polygon))
          )
      )
    )
  ORDER BY b.position ASC
  LIMIT 20;
$$;
GRANT EXECUTE ON FUNCTION public.active_banners_for(DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT)
  TO anon, authenticated, service_role;
