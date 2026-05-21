-- =============================================================================
-- Coligo v3 - Migration 0004 : Catégories (entité) + stock produit
-- =============================================================================
-- Appliquée automatiquement via `npm run db:push` (pooler Supabase).
--
-- Avant : products.category était un simple texte libre.
-- Après : table `categories` par commerçant (titre, description, photo, ordre),
--         products.category_id (lien optionnel) + products.stock_qty.
-- Les anciennes catégories texte sont migrées sans perte.
-- =============================================================================

-- ============================================================================
-- 1. TABLE: categories (par commerçant)
-- ============================================================================
CREATE TABLE public.categories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id  UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  image_url    TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_categories_merchant_id ON public.categories(merchant_id, position);

CREATE TRIGGER trigger_categories_updated_at
  BEFORE UPDATE ON public.categories
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================================
-- 2. PRODUCTS : lien catégorie + stock
-- ============================================================================
ALTER TABLE public.products
  ADD COLUMN category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN stock_qty   INTEGER CHECK (stock_qty IS NULL OR stock_qty >= 0);

CREATE INDEX idx_products_category_id ON public.products(category_id);

-- ============================================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- Lecture publique (les catégories seront affichées sur la marketplace client).
CREATE POLICY "categories_select_public" ON public.categories
  FOR SELECT USING (true);

CREATE POLICY "categories_insert_own" ON public.categories
  FOR INSERT WITH CHECK (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  );

CREATE POLICY "categories_update_own" ON public.categories
  FOR UPDATE USING (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  ) WITH CHECK (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  );

CREATE POLICY "categories_delete_own" ON public.categories
  FOR DELETE USING (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  );

-- ============================================================================
-- 4. MIGRATION DES DONNÉES : texte -> table categories
-- ============================================================================
-- Une catégorie par couple (merchant_id, category) distinct non vide.
INSERT INTO public.categories (merchant_id, title, position)
SELECT
  merchant_id,
  category,
  ROW_NUMBER() OVER (PARTITION BY merchant_id ORDER BY category) - 1
FROM (
  SELECT DISTINCT merchant_id, category
  FROM public.products
  WHERE category IS NOT NULL AND btrim(category) <> ''
) AS distinct_cats;

-- Rattache chaque produit à sa nouvelle catégorie.
UPDATE public.products p
SET category_id = c.id
FROM public.categories c
WHERE p.merchant_id = c.merchant_id
  AND p.category = c.title
  AND p.category_id IS NULL;

-- La colonne texte `products.category` devient obsolète (conservée pour
-- compat ; pourra être supprimée dans une future migration).
