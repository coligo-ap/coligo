-- =============================================================================
-- 0065 — Note moyenne commerçant : UN seul avis par client (anti-fraude)
-- =============================================================================
-- Aligne le CALCUL de la note (rating_avg / rating_count) sur l'AFFICHAGE des
-- avis (cf. getMerchantReviews) : on ne compte qu'UN avis par client — le PLUS
-- RÉCENT. Un client multi-commandes ne peut donc plus gonfler, diluer ou
-- saboter la note d'un commerce avec plusieurs avis.
--
--   rating_count = nombre de CLIENTS distincts ayant un avis visible
--   rating_avg   = moyenne des notes (1 note retenue par client = la dernière)
--
-- On redéfinit seulement la fonction de recalcul ; le trigger existant
-- (INSERT/UPDATE/DELETE sur reviews) continue de l'appeler. Puis on recalcule
-- pour tous les commerces existants (backfill).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.refresh_merchant_rating(p_merchant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_avg NUMERIC(3, 2);
  v_cnt INTEGER;
BEGIN
  -- Un avis par client = le plus récent (DISTINCT ON customer_id).
  WITH latest AS (
    SELECT DISTINCT ON (customer_id) rating
    FROM public.reviews
    WHERE merchant_id = p_merchant_id
      AND is_hidden = false
    ORDER BY customer_id, created_at DESC
  )
  SELECT
    COALESCE(round(avg(rating)::numeric, 2), 0),
    count(*)
  INTO v_avg, v_cnt
  FROM latest;

  UPDATE public.merchants
  SET rating_avg = v_avg, rating_count = v_cnt
  WHERE id = p_merchant_id;
END;
$$;

-- Backfill : recalcule la note de tous les commerces avec la nouvelle règle.
DO $$
DECLARE
  m RECORD;
BEGIN
  FOR m IN SELECT id FROM public.merchants LOOP
    PERFORM public.refresh_merchant_rating(m.id);
  END LOOP;
END $$;
