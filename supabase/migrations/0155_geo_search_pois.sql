-- =============================================================================
-- 0155 — Recherche de lieux v3 : POI, anti-bruit, recherches manquées
-- =============================================================================
-- Constats (test « place gueydon bejaia ») :
--   1. les mots GÉNÉRIQUES (place, rue, cité, souk…) gonflaient des scores
--      faibles : « place gueydon » remontait n'importe quelle « Place X » de
--      la wilaya. → stoplist sur le matching par mot + les bonus
--      (wilaya/proximité/population) sont désormais PROPORTIONNELS à la
--      qualité du match de base (plein bonus à base ≥ 0.5, réduit en dessous) ;
--   2. seuil squelette par mot abaissé à 3 (gueydon → gdn) — sans danger car
--      les génériques sont exclus par la stoplist ;
--   3. petit bonus aux POI structurants (place, gare, hôpital…) : à score
--      égal, un repère connu passe devant un lieu-dit homonyme ;
--   4. table geo_search_misses : chaque recherche SANS résultat est notée
--      (texte + position) → le super-admin voit ce que les clients cherchent
--      en vain et ajoute le lieu à la main (source='manual').
-- =============================================================================

-- Index trigram sur le squelette (accélère les LIKE '%…%' quand la table
-- grossit avec les POI).
CREATE INDEX IF NOT EXISTS idx_geo_places_skel_trgm
  ON public.geo_places
  USING gin (skel extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Recherches sans résultat (écrit par le serveur, lu par le super-admin).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.geo_search_misses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  q TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.geo_search_misses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS geo_search_misses_insert ON public.geo_search_misses;
CREATE POLICY geo_search_misses_insert ON public.geo_search_misses
  FOR INSERT TO anon, authenticated WITH CHECK (true);
-- (pas de SELECT public : lecture via service role / SQL direct)

-- ---------------------------------------------------------------------------
-- search_geo_places v3
-- ---------------------------------------------------------------------------
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
  v_words := regexp_split_to_array(v_t, '\s+');
  SELECT coalesce(array_agg(x.s), '{}') INTO v_wskels
    FROM (
      SELECT public.geo_skeleton(w) AS s
      FROM unnest(v_words) w
      WHERE NOT (w = ANY (v_stop))
    ) x
   WHERE length(x.s) >= 3;

  RETURN QUERY
  SELECT g.name, g.wilaya, g.lat, g.lng,
         (b.base + bo.bonus * least(1.0, b.base / 0.5))::real AS score
  FROM public.geo_places g
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
