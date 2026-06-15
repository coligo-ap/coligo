-- =============================================================================
-- 0177 — search_merchants : matching bidirectionnel (nom ↔ requête)
-- =============================================================================
-- La v1 (0176) ne gérait bien que « requête ⊂ nom » (« il capo » → « Il Capo »).
-- Quand le client ajoute la ville (« il capo bejaia »), le nom devient un MOT de
-- la requête : on ajoute donc le sens inverse « nom ⊂ requête » (index-supporté,
-- nom à gauche). Ainsi « il capo bejaia », « pharmacie kouba », « resto bejaia »
-- retrouvent l'enseigne. Le reste (proximité + popularité) est inchangé.
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
LANGUAGE plpgsql VOLATILE
SET search_path = public, extensions
AS $$
DECLARE
  v_t TEXT := public.f_unaccent(lower(trim(coalesce(p_q, ''))));
BEGIN
  IF length(v_t) < 2 THEN RETURN; END IF;
  PERFORM set_config('pg_trgm.word_similarity_threshold', '0.3', true);

  RETURN QUERY
  WITH cand AS (
    -- 1) requête = mot du nom (« il capo » → « Il Capo »)
    SELECT m.id FROM public.merchants m
     WHERE m.is_active AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
       AND v_t <% public.f_unaccent(lower(m.name))
    UNION
    -- 2) nom = mot de la requête (« il capo bejaia » → « Il Capo »)
    SELECT m.id FROM public.merchants m
     WHERE m.is_active AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
       AND public.f_unaccent(lower(m.name)) <% v_t
    UNION
    -- 3) sous-chaîne exacte
    SELECT m.id FROM public.merchants m
     WHERE m.is_active AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
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
      extensions.word_similarity(public.f_unaccent(lower(m.name)), v_t),
      CASE WHEN public.f_unaccent(lower(m.name)) LIKE '%' || v_t || '%'
           THEN 0.85 ELSE 0 END
    ) AS base
  ) b
  CROSS JOIN LATERAL (
    SELECT
      CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
        0.2 / (1.0 + sqrt(power((m.latitude - p_lat) * 111.0, 2)
                        + power((m.longitude - p_lng) * 93.0, 2)) / 50.0)
      ELSE 0 END
      + least(0.12, ln(1 + coalesce(m.orders_count, 0)) / 60.0)
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
