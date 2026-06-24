-- =============================================================================
-- 0258 — Reverse geocode INSTANTANÉ : plus proche lieu du gazetteer (PostGIS)
-- =============================================================================
-- Le reverse geocode (déplacer le repère sur la carte → adresse) reposait sur
-- Nominatim SEUL, SANS timeout → lent et parfois figé (« la position met du temps
-- à être trouvée »). On ajoute une résolution LOCALE instantanée : le lieu le
-- plus proche dans `geo_places` (~60k lieux DZ) via PostGIS KNN (index GiST).
-- Réponse en ~5 ms, sans dépendre du réseau → la position s'affiche tout de
-- suite, Nominatim ne sert plus qu'à AFFINER (rue) quand il répond vite.
-- =============================================================================

ALTER TABLE public.geo_places
  ADD COLUMN IF NOT EXISTS geog extensions.geography(Point, 4326);

CREATE OR REPLACE FUNCTION public.geo_places_sync_geog()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  NEW.geog := extensions.ST_SetSRID(
                extensions.ST_MakePoint(NEW.lng, NEW.lat), 4326
              )::extensions.geography;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_geo_places_geog ON public.geo_places;
CREATE TRIGGER trg_geo_places_geog
  BEFORE INSERT OR UPDATE OF lat, lng ON public.geo_places
  FOR EACH ROW EXECUTE FUNCTION public.geo_places_sync_geog();

-- Backfill des lignes existantes.
UPDATE public.geo_places
  SET geog = extensions.ST_SetSRID(extensions.ST_MakePoint(lng, lat), 4326)::extensions.geography
  WHERE geog IS NULL AND lat IS NOT NULL AND lng IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_geo_places_geog
  ON public.geo_places USING GIST (geog);

-- Plus proche lieu d'un point : nom + wilaya + distance (km). KNN <-> via GiST.
CREATE OR REPLACE FUNCTION public.geo_nearest_place(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION
)
RETURNS TABLE(name TEXT, wilaya TEXT, dist_km NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  WITH o AS (
    SELECT extensions.ST_SetSRID(
             extensions.ST_MakePoint(p_lng, p_lat), 4326
           )::extensions.geography AS g
  )
  SELECT gp.name, gp.wilaya,
         (extensions.ST_Distance(gp.geog, o.g) / 1000.0)::NUMERIC(8, 3)
  FROM public.geo_places gp
  CROSS JOIN o
  WHERE p_lat IS NOT NULL AND p_lng IS NOT NULL AND gp.geog IS NOT NULL
  ORDER BY gp.geog OPERATOR(extensions.<->) o.g
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.geo_nearest_place(DOUBLE PRECISION, DOUBLE PRECISION)
  TO authenticated, anon, service_role;
