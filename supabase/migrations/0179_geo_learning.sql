-- =============================================================================
-- 0179 — Apprentissage des adresses : les lieux souvent CHOISIS remontent
-- =============================================================================
-- L'app (pas Google) apprend des sélections réelles des clients. Chaque fois
-- qu'un client choisit une adresse dans les suggestions, on incrémente un
-- compteur par "cellule" (~11 m). search_geo_places ajoute alors un bonus
-- proportionnel → « Stade de Béjaïa », à force d'être choisi, remonte en tête.
-- Le bonus est mis à l'échelle du match de nom (b.base) : un lieu populaire
-- ne pollue PAS les requêtes sans rapport.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.geo_picks (
  cell       TEXT PRIMARY KEY,         -- round(lat,4)','round(lng,4) — ~11 m
  label      TEXT,
  picks      INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.geo_picks ENABLE ROW LEVEL SECURITY;

-- Enregistre un choix (best-effort, +1 sur la cellule).
CREATE OR REPLACE FUNCTION public.geo_pick_record(
  p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION, p_label TEXT
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.geo_picks(cell, label, picks)
  VALUES (
    round(p_lat::numeric, 4)::text || ',' || round(p_lng::numeric, 4)::text,
    p_label, 1
  )
  ON CONFLICT (cell) DO UPDATE
    SET picks = public.geo_picks.picks + 1,
        label = coalesce(excluded.label, public.geo_picks.label),
        updated_at = now();
$$;
GRANT EXECUTE ON FUNCTION public.geo_pick_record(DOUBLE PRECISION, DOUBLE PRECISION, TEXT)
  TO anon, authenticated;

-- search_geo_places v5 : v4 (0156) + bonus "popularité apprise" (geo_picks).
DROP FUNCTION IF EXISTS public.search_geo_places(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, INT);
CREATE OR REPLACE FUNCTION public.search_geo_places(
  p_q TEXT,
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL,
  p_limit INT DEFAULT 6
)
RETURNS TABLE (name TEXT, wilaya TEXT, lat DOUBLE PRECISION, lng DOUBLE PRECISION, score REAL)
LANGUAGE plpgsql VOLATILE
SET search_path = public, extensions
AS $$
DECLARE
  v_t TEXT := public.f_unaccent(lower(trim(p_q)));
  v_sk TEXT := public.geo_skeleton(p_q);
  v_words TEXT[];
  v_wskels TEXT[];
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
  LEFT JOIN public.geo_picks gp
    ON gp.cell = round(g.lat::numeric, 4)::text || ',' || round(g.lng::numeric, 4)::text
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
      CASE WHEN g.wilaya IS NOT NULL AND array_length(v_words, 1) >= 2
                AND EXISTS (
                  SELECT 1 FROM unnest(v_words) w
                  WHERE length(w) >= 4
                    AND extensions.word_similarity(
                          w, public.f_unaccent(lower(g.wilaya))) >= 0.5)
           THEN 0.25 ELSE 0 END
      + CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
          0.2 / (1.0 + sqrt(power((g.lat - p_lat) * 111.0, 2)
                          + power((g.lng - p_lng) * 93.0, 2)) / 50.0)
        ELSE 0 END
      + least(0.06, ln(1 + g.population) / 200.0)
      + CASE WHEN g.feature_code IN (
              'square','station','bus_station','aerodrome','hospital',
              'university','stadium','mall','marketplace','townhall',
              'museum','attraction','park','beach')
             THEN 0.05 ELSE 0 END
      -- NOUVEAU : popularité APPRISE (lieux souvent choisis par les clients).
      + least(0.30, ln(1 + coalesce(gp.picks, 0)) / 12.0)
      AS bonus
  ) bo
  ORDER BY score DESC
  LIMIT greatest(1, least(coalesce(p_limit, 6), 12));
END
$$;
GRANT EXECUTE ON FUNCTION public.search_geo_places(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, INT)
  TO anon, authenticated;
