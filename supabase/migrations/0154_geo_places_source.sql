-- =============================================================================
-- 0154 — geo_places.source : tracer l'origine des lieux (geonames / osm / manual)
-- =============================================================================
-- GeoNames ne connaît pas tous les lieux-dits algériens (ex. « Souq el
-- Khémis » à Bouhamza, Béjaïa, présent uniquement dans OSM). On importe donc
-- AUSSI les nœuds place=* d'OSM (script import-osm-places-dz.mjs). La colonne
-- `source` permet à chaque import de supprimer/réinsérer SES lignes sans
-- toucher aux autres ni aux ajouts manuels.
-- =============================================================================

ALTER TABLE public.geo_places
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

-- Les lignes existantes avec geoname_id viennent de l'import GeoNames.
UPDATE public.geo_places SET source = 'geonames' WHERE geoname_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_geo_places_source ON public.geo_places (source);
