-- =============================================================================
-- Coligo v3 - Migration 0005 : ordre manuel des produits
-- =============================================================================
-- Appliquée automatiquement via `npm run db:push` (pooler Supabase).
--
-- Ajoute products.position pour permettre le classement manuel (glisser-déposer)
-- des produits, notamment au sein d'une catégorie.
-- =============================================================================

ALTER TABLE public.products
  ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

-- Backfill : ordonne les produits existants par date de création, par
-- commerçant ET par catégorie (les positions sont relatives à une liste).
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY merchant_id, category_id
      ORDER BY created_at
    ) - 1 AS rn
  FROM public.products
)
UPDATE public.products p
SET position = ranked.rn
FROM ranked
WHERE ranked.id = p.id;

CREATE INDEX idx_products_position ON public.products(merchant_id, category_id, position);
