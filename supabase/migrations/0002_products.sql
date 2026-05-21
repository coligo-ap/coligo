-- =============================================================================
-- Coligo v3 - Migration 0002 : Catalogue produits
-- =============================================================================
-- Appliquée automatiquement via `npm run db:push` (pooler Supabase).
-- Crée la table `products`, ses policies RLS, le bucket Storage `products`
-- et ses policies (chaque commerçant n'écrit que dans son dossier {merchant_id}/).
-- =============================================================================

-- ============================================================================
-- 1. ENUM: unité de vente
-- ============================================================================
CREATE TYPE public.product_unit AS ENUM ('piece', 'kg', 'l', 'm', 'custom');

-- ============================================================================
-- 2. TABLE: products
-- ============================================================================
CREATE TABLE public.products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  name_fr         TEXT NOT NULL,
  name_ar         TEXT,
  description_fr  TEXT,
  description_ar  TEXT,
  price_da        INTEGER NOT NULL CHECK (price_da >= 0),
  unit            public.product_unit NOT NULL DEFAULT 'piece',
  category        TEXT,
  image_url       TEXT,
  is_available    BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_products_merchant_id ON public.products(merchant_id);
CREATE INDEX idx_products_category    ON public.products(merchant_id, category);

-- ============================================================================
-- 3. TRIGGER: maj automatique de updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================================
-- 4. ROW LEVEL SECURITY — le commerçant ne gère QUE ses produits
-- ============================================================================
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "products_select_own" ON public.products
  FOR SELECT USING (
    merchant_id IN (
      SELECT id FROM public.merchants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "products_insert_own" ON public.products
  FOR INSERT WITH CHECK (
    merchant_id IN (
      SELECT id FROM public.merchants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "products_update_own" ON public.products
  FOR UPDATE USING (
    merchant_id IN (
      SELECT id FROM public.merchants WHERE user_id = auth.uid()
    )
  ) WITH CHECK (
    merchant_id IN (
      SELECT id FROM public.merchants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "products_delete_own" ON public.products
  FOR DELETE USING (
    merchant_id IN (
      SELECT id FROM public.merchants WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- 5. STORAGE — bucket public `products`, dossier par commerçant {merchant_id}/
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('products', 'products', true)
ON CONFLICT (id) DO NOTHING;

-- Lecture publique (les images sont affichées sur la marketplace client).
CREATE POLICY "products_storage_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'products');

-- Écriture : uniquement dans son propre dossier {merchant_id}/...
CREATE POLICY "products_storage_insert_own" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'products'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.merchants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "products_storage_update_own" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'products'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.merchants WHERE user_id = auth.uid()
    )
  ) WITH CHECK (
    bucket_id = 'products'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.merchants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "products_storage_delete_own" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'products'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.merchants WHERE user_id = auth.uid()
    )
  );
