-- =============================================================================
-- 0176 — search_merchants : recherche floue des commerces enregistrés
-- =============================================================================
-- Alimente la recherche de destination (Drive) et l'assistant : trouver un
-- commerce/restaurant/pharmacie par son NOM (« Il Capo Béjaïa »), même sans
-- adresse, avec tolérance fautes/accents (trigram f_unaccent) et classement
-- intelligent (proximité + popularité = commandes + note). Index réutilisé :
-- idx_merchants_name_trgm (gin sur f_unaccent(lower(name))), mig 0081.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.search_merchants(
  p_q TEXT,
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL,
  p_limit INT DEFAULT 6
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  category TEXT,
  commune TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  score REAL
)
-- VOLATILE : set_config interdit dans une fonction STABLE.
LANGUAGE plpgsql VOLATILE
SET search_path = public, extensions
AS $$
DECLARE
  v_t TEXT := public.f_unaccent(lower(trim(coalesce(p_q, ''))));
BEGIN
  IF length(v_t) < 2 THEN RETURN; END IF;
  -- Seuil de l'opérateur <% (word_similarity), tolérant aux fautes.
  PERFORM set_config('pg_trgm.word_similarity_threshold', '0.3', true);

  RETURN QUERY
  WITH cand AS (
    -- 1) requête = mot du nom (index trigram word_similarity) → tolère les fautes
    SELECT m.id FROM public.merchants m
     WHERE m.is_active
       AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
       AND v_t <% public.f_unaccent(lower(m.name))
    UNION
    -- 2) sous-chaîne exacte (ex. « il capo » dans « Restaurant Il Capo »)
    SELECT m.id FROM public.merchants m
     WHERE m.is_active
       AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
       AND public.f_unaccent(lower(m.name)) LIKE '%' || v_t || '%'
  )
  SELECT m.id, m.name, m.category, m.commune,
         m.latitude::double precision, m.longitude::double precision,
         (b.base + bo.bonus)::real AS score
  FROM public.merchants m
  JOIN cand ON cand.id = m.id
  CROSS JOIN LATERAL (
    SELECT greatest(
      extensions.word_similarity(v_t, public.f_unaccent(lower(m.name))),
      -- sous-chaîne = très forte confiance (le client a tapé le nom exact)
      CASE WHEN public.f_unaccent(lower(m.name)) LIKE '%' || v_t || '%'
           THEN 0.85 ELSE 0 END
    ) AS base
  ) b
  CROSS JOIN LATERAL (
    SELECT
      -- proximité : même barème que les lieux (0.2 à 0 km, ~0.1 à 50 km)
      CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
        0.2 / (1.0 + sqrt(power((m.latitude - p_lat) * 111.0, 2)
                        + power((m.longitude - p_lng) * 93.0, 2)) / 50.0)
      ELSE 0 END
      -- popularité : commandes complétées (log) → les commerces fréquentés d'abord
      + least(0.12, ln(1 + coalesce(m.orders_count, 0)) / 60.0)
      -- qualité : note moyenne si ≥ 3 avis
      + CASE WHEN coalesce(m.rating_count, 0) >= 3
             THEN least(0.06, (coalesce(m.rating_avg, 0) / 5.0) * 0.06)
             ELSE 0 END
      AS bonus
  ) bo
  ORDER BY score DESC
  LIMIT greatest(1, least(coalesce(p_limit, 6), 12));
END
$$;

GRANT EXECUTE ON FUNCTION
  public.search_merchants(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, INT)
  TO anon, authenticated;
