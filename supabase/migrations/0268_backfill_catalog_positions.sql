-- =============================================================================
-- 0268 — Backfill des positions de classement (catégories + produits)
-- =============================================================================
-- Beaucoup de catégories et la plupart des produits avaient position = 0 (défaut
-- des seeds / imports / créations sans position). Résultat : à égalité, l'ordre
-- d'affichage côté client était INDÉTERMINÉ, et le commerçant ne pouvait pas
-- vraiment classer. On donne des positions DISTINCTES :
--   • catégories : 0..N par commerce (ordre actuel préservé, ties = créa/titre) ;
--   • produits   : 0..N par (commerce, catégorie) → ordre stable DANS chaque
--     catégorie (convention de reorderProducts), respecté par le client (qui
--     groupe par catégorie puis trie par position).
-- Idempotent : ne met à jour que les lignes dont la position change.
-- =============================================================================

-- 1) Catégories : 0..N par commerce.
WITH ranked AS (
  SELECT id,
         (row_number() OVER (
            PARTITION BY merchant_id
            ORDER BY position, created_at, title
          ) - 1) AS rn
  FROM public.categories
)
UPDATE public.categories c
SET position = r.rn
FROM ranked r
WHERE r.id = c.id AND c.position IS DISTINCT FROM r.rn;

-- 2) Produits : 0..N par (commerce, catégorie). NULL category_id = un groupe.
WITH ranked AS (
  SELECT id,
         (row_number() OVER (
            PARTITION BY merchant_id, category_id
            ORDER BY position, created_at
          ) - 1) AS rn
  FROM public.products
  WHERE archived_at IS NULL
)
UPDATE public.products p
SET position = r.rn
FROM ranked r
WHERE r.id = p.id AND p.position IS DISTINCT FROM r.rn;
