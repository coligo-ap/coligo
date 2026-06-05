-- =============================================================================
-- 0069 — Un seul avis par (client, commerçant) : garde-fou au niveau DB
-- =============================================================================
-- La règle « un seul avis par commerçant » était jusqu'ici purement applicative
-- (check-then-insert dans submitReview), donc sujette à une course : deux envois
-- concurrents du même client sur deux commandes du même commerce passaient tous
-- deux le SELECT avant l'INSERT et créaient deux avis. La contrainte UNIQUE
-- (order_id) de la mig 0027 ne couvrait pas ce cas.
--
-- On rend l'invariant réel : contrainte UNIQUE (customer_id, merchant_id).
-- Cohérent avec le calcul de la note (1 avis par client — mig 0065) et avec
-- l'affichage (getMerchantReviews dédoublonne déjà par client).
-- =============================================================================

-- 1) Dédoublonne l'existant : on NE GARDE QUE l'avis le plus récent de chaque
--    couple (client, commerçant). Le tri (created_at DESC, id DESC) est
--    déterministe même si deux avis ont le même timestamp.
DELETE FROM public.reviews r
USING (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY customer_id, merchant_id
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM public.reviews
) ranked
WHERE r.id = ranked.id
  AND ranked.rn > 1;

-- 2) Contrainte d'unicité (idempotente : rejouable sans erreur).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reviews_customer_merchant_unique'
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_customer_merchant_unique
      UNIQUE (customer_id, merchant_id);
  END IF;
END $$;

-- 3) Recalcule les notes des commerces touchés par le dédoublonnage.
--    (refresh_merchant_rating ne compte déjà qu'un avis par client — mig 0065 —
--    donc rating_avg/rating_count étaient déjà corrects ; ce passage garantit la
--    cohérence après suppression physique des lignes.)
DO $$
DECLARE
  m RECORD;
BEGIN
  FOR m IN SELECT DISTINCT merchant_id AS id FROM public.reviews LOOP
    PERFORM public.refresh_merchant_rating(m.id);
  END LOOP;
END $$;
