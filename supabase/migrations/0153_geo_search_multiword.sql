-- =============================================================================
-- 0153 — search_geo_places : requêtes multi-mots (« lekhmisse bejaia »)
-- =============================================================================
-- La v1 (mig 0152) matchait la requête ENTIÈRE : « lekhmisse bejaia » ne
-- trouvait plus rien car le squelette global (lkhmsbj) ne correspond à aucun
-- lieu. Ici :
--   - matching par MOT en plus du global : chaque mot ≥ 4 lettres de squelette
--     est cherché séparément dans `skel` ;
--   - bonus wilaya (+0.25) : si un AUTRE mot de la requête ressemble au nom de
--     la wilaya du lieu → « lekhmisse bejaia » classe Béjaïa devant les
--     homonymes des autres wilayas (demande explicite : plusieurs endroits
--     portent le même nom en Algérie).
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
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_t TEXT := public.f_unaccent(lower(trim(p_q)));
  v_sk TEXT := public.geo_skeleton(p_q);
  v_words TEXT[];
  v_wskels TEXT[];
BEGIN
  v_words := regexp_split_to_array(v_t, '\s+');
  SELECT coalesce(array_agg(s), '{}') INTO v_wskels
    FROM (SELECT public.geo_skeleton(w) AS s FROM unnest(v_words) w) x
   WHERE length(x.s) >= 4;

  RETURN QUERY
  SELECT g.name, g.wilaya, g.lat, g.lng,
    (
      greatest(
        extensions.word_similarity(v_t, g.search_text),
        CASE WHEN length(v_sk) >= 3 AND g.skel LIKE '%' || v_sk || '%'
             THEN 0.62 ELSE 0 END,
        CASE WHEN EXISTS (SELECT 1 FROM unnest(v_wskels) ws
                          WHERE g.skel LIKE '%' || ws || '%')
             THEN 0.55 ELSE 0 END
      )
      -- bonus wilaya : un mot de la requête désigne la wilaya du lieu
      + CASE WHEN g.wilaya IS NOT NULL AND array_length(v_words, 1) >= 2
                  AND EXISTS (
                    SELECT 1 FROM unnest(v_words) w
                    WHERE length(w) >= 4
                      AND extensions.word_similarity(
                            w, public.f_unaccent(lower(g.wilaya))) >= 0.5)
             THEN 0.25 ELSE 0 END
      -- bonus proximité : 0.2 à 0 km, ~0.1 à 50 km, ~0.03 à 250 km
      + CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
          0.2 / (1.0 + sqrt(power((g.lat - p_lat) * 111.0, 2)
                          + power((g.lng - p_lng) * 93.0, 2)) / 50.0)
        ELSE 0 END
      -- bonus population : les villes connues avant les lieux-dits homonymes
      + least(0.06, ln(1 + g.population) / 200.0)
    )::real AS score
  FROM public.geo_places g
  WHERE extensions.word_similarity(v_t, g.search_text) >= 0.34
     OR (length(v_sk) >= 3 AND g.skel LIKE '%' || v_sk || '%')
     OR EXISTS (SELECT 1 FROM unnest(v_wskels) ws
                WHERE g.skel LIKE '%' || ws || '%')
  ORDER BY score DESC
  LIMIT greatest(1, least(coalesce(p_limit, 6), 12));
END
$$;

GRANT EXECUTE ON FUNCTION public.search_geo_places(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, INT)
  TO anon, authenticated;
