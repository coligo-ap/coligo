-- =============================================================================
-- 0431 — Recherche TEXTE dans le gazetteer Coligo (~60 k lieux algériens).
--
-- Le gazetteer ne savait faire que « le lieu le plus proche d'un point »
-- (geo_nearest_place). Il lui manquait l'essentiel pour servir de REPLI à
-- Google : chercher par le nom. C'est pourtant lui qui connaît les cités,
-- lotissements et quartiers que Google ignore souvent en Algérie.
--
-- Classement voulu :
--   1. ce qui COMMENCE par la saisie (« tob » → « Cité Tobbal ») ;
--   2. ce qui la contient ailleurs ;
--   3. à pertinence égale, le plus PROCHE du client si sa position est connue.
--
-- `unaccent` : « bejaia » doit trouver « Béjaïa ». Sans ça, la moitié des
-- recherches tapées au clavier latin ne renverraient rien.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.geo_search_places(
  p_q text,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_limit integer DEFAULT 8
)
RETURNS TABLE(name text, wilaya text, lat double precision, lng double precision)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  WITH q AS (
    SELECT lower(unaccent(btrim(coalesce(p_q, '')))) AS t
  )
  SELECT p.name, p.wilaya, p.lat, p.lng
  FROM public.geo_places p, q
  WHERE length(q.t) >= 2
    AND coalesce(p.search_text, lower(unaccent(p.name))) LIKE '%' || q.t || '%'
  ORDER BY
    -- Ce qui commence par la saisie d'abord : c'est presque toujours ce que
    -- la personne cherche.
    (coalesce(p.search_text, lower(unaccent(p.name))) LIKE q.t || '%') DESC,
    -- Puis le plus proche, quand on sait où est le client.
    CASE
      WHEN p_lat IS NULL OR p_lng IS NULL OR p.lat IS NULL THEN 0
      ELSE 2 * 6371 * asin(sqrt(
        power(sin(radians(p.lat - p_lat) / 2), 2) +
        cos(radians(p_lat)) * cos(radians(p.lat)) *
        power(sin(radians(p.lng - p_lng) / 2), 2)
      ))
    END ASC,
    length(p.name) ASC
  LIMIT greatest(1, least(coalesce(p_limit, 8), 20));
$function$;

-- Appelée depuis le serveur (service_role) ET potentiellement en anon pour une
-- page publique : une RPC sans GRANT anon est invisible côté navigateur.
REVOKE ALL ON FUNCTION public.geo_search_places(text, double precision, double precision, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.geo_search_places(text, double precision, double precision, integer)
  TO anon, authenticated, service_role;
