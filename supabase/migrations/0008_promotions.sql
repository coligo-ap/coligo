-- =============================================================================
-- Coligo v3 - Migration 0008 : Promotions (gestion commerçant)
-- =============================================================================
-- Appliquée automatiquement via `npm run db:push` (pooler Supabase).
--
-- Le commerçant crée et gère ses promotions (réduction produit, code promo,
-- offre quantité). L'APPLICATION au checkout viendra plus tard côté client ;
-- ici on stocke la définition + un moteur de calcul pur (lib/promotions/engine).
--
-- Règles figées (cf. doc PARTIE A) :
--   - le commerçant absorbe la réduction (MVP) ;
--   - la commission Coligo se calcule sur le montant PAYÉ (après réduction) ;
--   - prix après réduction jamais <= 0 (plancher applicatif configurable) ;
--   - une seule promo « prix » par produit (la plus avantageuse) ;
--   - un seul code promo par commande.
-- Aucune table n'est modifiée de façon destructive.
-- =============================================================================

-- ============================================================================
-- 1. ENUMS
-- ============================================================================
CREATE TYPE public.promotion_type AS ENUM (
  'product_discount', 'promo_code', 'quantity_offer'
);

CREATE TYPE public.promotion_status AS ENUM (
  'scheduled', 'active', 'expired', 'disabled'
);

CREATE TYPE public.discount_kind AS ENUM ('percent', 'amount');

-- ============================================================================
-- 2. TABLE: promotions (par commerçant)
-- ============================================================================
CREATE TABLE public.promotions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id            UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  type                   public.promotion_type   NOT NULL,
  title_fr               TEXT NOT NULL,
  title_ar               TEXT,
  status                 public.promotion_status NOT NULL DEFAULT 'active',

  -- product_discount / promo_code
  discount_kind          public.discount_kind,
  discount_value         NUMERIC(10, 2) CHECK (discount_value IS NULL OR discount_value >= 0),

  -- promo_code
  code                   TEXT,

  -- quantity_offer : « buy_qty achetés = get_qty offert(s) »
  buy_qty                INTEGER CHECK (buy_qty IS NULL OR buy_qty > 0),
  get_qty                INTEGER CHECK (get_qty IS NULL OR get_qty > 0),

  -- planification / quotas
  starts_at              TIMESTAMPTZ,
  ends_at                TIMESTAMPTZ,
  max_uses               INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  max_uses_per_customer  INTEGER CHECK (max_uses_per_customer IS NULL OR max_uses_per_customer > 0),
  uses_count             INTEGER NOT NULL DEFAULT 0 CHECK (uses_count >= 0),

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Cohérence des dates : début strictement avant fin si les deux sont fixées.
  CONSTRAINT promotions_dates_chk
    CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);

CREATE INDEX idx_promotions_merchant_id ON public.promotions(merchant_id, status);

-- Un code promo est unique CHEZ un commerçant (les codes NULL sont ignorés).
CREATE UNIQUE INDEX idx_promotions_merchant_code
  ON public.promotions(merchant_id, code)
  WHERE code IS NOT NULL;

-- ============================================================================
-- 3. TABLE: promotion_products (lien promo <-> produits concernés)
--    Pour product_discount et quantity_offer. PK composite.
-- ============================================================================
CREATE TABLE public.promotion_products (
  promotion_id UUID NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES public.products(id)   ON DELETE CASCADE,
  PRIMARY KEY (promotion_id, product_id)
);

CREATE INDEX idx_promotion_products_product ON public.promotion_products(product_id);

-- ============================================================================
-- 4. ROW LEVEL SECURITY — le commerçant ne gère QUE ses promotions
-- ============================================================================
ALTER TABLE public.promotions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_products ENABLE ROW LEVEL SECURITY;

-- promotions : accès limité au commerçant propriétaire.
CREATE POLICY "promotions_select_own" ON public.promotions
  FOR SELECT USING (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  );

CREATE POLICY "promotions_insert_own" ON public.promotions
  FOR INSERT WITH CHECK (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  );

CREATE POLICY "promotions_update_own" ON public.promotions
  FOR UPDATE USING (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  ) WITH CHECK (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  );

CREATE POLICY "promotions_delete_own" ON public.promotions
  FOR DELETE USING (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  );

-- promotion_products : accès via la promotion propriétaire.
CREATE POLICY "promotion_products_select_own" ON public.promotion_products
  FOR SELECT USING (
    promotion_id IN (
      SELECT p.id FROM public.promotions p
      JOIN public.merchants m ON m.id = p.merchant_id
      WHERE m.user_id = auth.uid()
    )
  );

CREATE POLICY "promotion_products_insert_own" ON public.promotion_products
  FOR INSERT WITH CHECK (
    promotion_id IN (
      SELECT p.id FROM public.promotions p
      JOIN public.merchants m ON m.id = p.merchant_id
      WHERE m.user_id = auth.uid()
    )
  );

CREATE POLICY "promotion_products_delete_own" ON public.promotion_products
  FOR DELETE USING (
    promotion_id IN (
      SELECT p.id FROM public.promotions p
      JOIN public.merchants m ON m.id = p.merchant_id
      WHERE m.user_id = auth.uid()
    )
  );
