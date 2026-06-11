-- =============================================================================
-- 0156 — search_geo_places v4 : candidats via index (latence 300-500 ms → <100)
-- =============================================================================
-- La v3 scannait toute la table (word_similarity() en WHERE n'est pas
-- indexable). Ici les candidats sont d'abord collectés par UNION de branches
-- chacune indexable (GIN trigram sur search_text et skel) :
--   - `v_t <% search_text` (opérateur word_similarity, seuil fixé à 0.34 via
--     SET sur la fonction) ;
--   - `skel LIKE '%squelette%'` (global puis par mot) ;
-- puis le scoring (inchangé, v3) ne tourne que sur ces candidats.
-- =============================================================================

DROP FUNCTION IF EXISTS public.search_geo_places(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, INT);

CREATE OR REPLACE FUNCTION public.search_geo_places(
  p_q TEXT,
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL,
  p_limit INT DEFAULT 6
)
RETURNS TABLE (
  name TEXT,
  wilaya TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  score REAL
)
-- VOLATILE (et non STABLE) : set_config est interdit dans une fonction
-- non-volatile ; aucun impact, la fonction est appelée seule.
LANGUAGE plpgsql VOLATILE
SET search_path = public, extensions
AS $$
DECLARE
  v_t TEXT := public.f_unaccent(lower(trim(p_q)));
  v_sk TEXT := public.geo_skeleton(p_q);
  v_words TEXT[];
  v_wskels TEXT[];
  -- Mots génériques des toponymes/adresses DZ : jamais discriminants seuls.
  v_stop TEXT[] := ARRAY[
    'place','placette','rue','route','avenue','boulevard','chemin','impasse',
    'cite','quartier','lotissement','residence','marche','souk','souq',
    'ecole','lycee','college','universite','mosquee','masjid','eglise',
    'hopital','clinique','pharmacie','gare','station','stade','parc','plage',
    'hotel','centre','ville','commune','wilaya','daira','nouvelle','nouveau',
    'ancienne','ancien','grand','grande','petit','petite','sidi','ait','oued',
    'douar','bordj','beni','bab','hai','hay','dar','ain','les','las','pres'
  ];
BEGIN
  -- Seuil de l'opérateur <% (un SET sur la fonction est refusé par Supabase).
  PERFORM set_config('pg_trgm.word_similarity_threshold', '0.34', true);
  v_words := regexp_split_to_array(v_t, '\s+');
  SELECT coalesce(array_agg(x.s), '{}') INTO v_wskels
    FROM (
      SELECT public.geo_skeleton(w) AS s
      FROM unnest(v_words) w
      WHERE NOT (w = ANY (v_stop))
    ) x
   WHERE length(x.s) >= 3;

  RETURN QUERY
  WITH cand AS (
    SELECT c.id FROM public.geo_places c WHERE v_t <% c.search_text
    UNION
    SELECT c.id FROM public.geo_places c
     WHERE length(v_sk) >= 3 AND c.skel LIKE '%' || v_sk || '%'
    UNION
    SELECT c.id FROM public.geo_places c
      JOIN unnest(v_wskels) ws ON c.skel LIKE '%' || ws || '%'
  )
  SELECT g.name, g.wilaya, g.lat, g.lng,
         (b.base + bo.bonus * least(1.0, b.base / 0.5))::real AS score
  FROM public.geo_places g
  JOIN cand ON cand.id = g.id
  CROSS JOIN LATERAL (
    SELECT greatest(
      extensions.word_similarity(v_t, g.search_text),
      CASE WHEN length(v_sk) >= 3 AND g.skel LIKE '%' || v_sk || '%'
           THEN 0.62 ELSE 0 END,
      CASE WHEN EXISTS (SELECT 1 FROM unnest(v_wskels) ws
                        WHERE g.skel LIKE '%' || ws || '%')
           THEN 0.55 ELSE 0 END
    ) AS base
  ) b
  CROSS JOIN LATERAL (
    SELECT
      -- wilaya nommée dans la requête
      CASE WHEN g.wilaya IS NOT NULL AND array_length(v_words, 1) >= 2
                AND EXISTS (
                  SELECT 1 FROM unnest(v_words) w
                  WHERE length(w) >= 4
                    AND extensions.word_similarity(
                          w, public.f_unaccent(lower(g.wilaya))) >= 0.5)
           THEN 0.25 ELSE 0 END
      -- proximité : 0.2 à 0 km, ~0.1 à 50 km, ~0.03 à 250 km
      + CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
          0.2 / (1.0 + sqrt(power((g.lat - p_lat) * 111.0, 2)
                          + power((g.lng - p_lng) * 93.0, 2)) / 50.0)
        ELSE 0 END
      -- population : les villes connues avant les lieux-dits homonymes
      + least(0.06, ln(1 + g.population) / 200.0)
      -- POI structurant : repère urbain connu de tous
      + CASE WHEN g.feature_code IN (
              'square','station','bus_station','aerodrome','hospital',
              'university','stadium','mall','marketplace','townhall',
              'museum','attraction','park','beach')
             THEN 0.05 ELSE 0 END
      AS bonus
  ) bo
  ORDER BY score DESC
  LIMIT greatest(1, least(coalesce(p_limit, 6), 12));
END
$$;

GRANT EXECUTE ON FUNCTION public.search_geo_places(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, INT)
  TO anon, authenticated;
