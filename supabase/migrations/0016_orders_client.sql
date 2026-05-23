-- =============================================================================
-- Coligo v3 - Migration 0016 : Création de commande CÔTÉ CLIENT (prompt 14)
-- =============================================================================
-- Appliquée via `npm run db:push` (ou copiable dans le SQL Editor Supabase).
--
-- Étend `orders` pour permettre la création de commandes par un CLIENT
-- (jusqu'ici, les commandes étaient seedées par scripts ; aucune création
-- par l'app n'existait).
--
-- Règles d'or :
--   - `client_operation_id` UNIQUE pour idempotency (double-clic / retry → 1 commande).
--   - Snapshot immuable au moment de la création : prix unitaire, totaux,
--     mode de paiement. Les taux wallet sont eux figés à la complétion
--     (cf. 0010 / 0013) — pas ici.
--   - Lecture publique des catalogues actifs (produits + catégories) : un
--     client anonyme doit pouvoir parcourir les produits d'un commerce actif
--     sans être connecté.
--   - RLS : un client lit/insère uniquement SES commandes ; le commerçant
--     voit celles qui lui sont adressées (déjà en place via 0001).
-- =============================================================================

-- ============================================================================
-- 1. ENUM pickup_type
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE public.pickup_type AS ENUM ('asap', 'slot');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 2. ORDERS — champs client + snapshots financiers manquants
-- ============================================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_id           UUID
    REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_operation_id   UUID,
  ADD COLUMN IF NOT EXISTS pickup_type           public.pickup_type
    NOT NULL DEFAULT 'asap',
  ADD COLUMN IF NOT EXISTS pickup_slot_start     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_slot_end       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_note         TEXT,
  -- Snapshots financiers (commission_da / cashback_da / service_fee_da
  -- existent déjà via 0007). On ajoute le sous-total / réduction et le
  -- cashback ESTIMÉ (l'effectif est dans cashback_grants à la complétion).
  ADD COLUMN IF NOT EXISTS subtotal_da           INTEGER NOT NULL DEFAULT 0
    CHECK (subtotal_da >= 0),
  ADD COLUMN IF NOT EXISTS discount_da           INTEGER NOT NULL DEFAULT 0
    CHECK (discount_da >= 0),
  ADD COLUMN IF NOT EXISTS cashback_estimate_da  INTEGER NOT NULL DEFAULT 0
    CHECK (cashback_estimate_da >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_client_operation_id
  ON public.orders(client_operation_id) WHERE client_operation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_customer_id
  ON public.orders(customer_id, created_at DESC);

-- ============================================================================
-- 3. RLS — création par un client + lecture par le client de SES commandes
-- ============================================================================
-- Les policies merchant existantes (orders_select_own_merchant) restent.
-- On ajoute les policies CLIENT.

DROP POLICY IF EXISTS "orders_select_own_customer" ON public.orders;
CREATE POLICY "orders_select_own_customer" ON public.orders
  FOR SELECT
  USING (
    customer_id IN (
      SELECT id FROM public.customers WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "orders_insert_own_customer" ON public.orders;
CREATE POLICY "orders_insert_own_customer" ON public.orders
  FOR INSERT
  WITH CHECK (
    customer_id IN (
      SELECT id FROM public.customers WHERE user_id = auth.uid()
    )
  );

-- order_items : INSERT côté client + SELECT côté client (en + de merchant).
DROP POLICY IF EXISTS "order_items_select_own_customer" ON public.order_items;
CREATE POLICY "order_items_select_own_customer" ON public.order_items
  FOR SELECT
  USING (
    order_id IN (
      SELECT o.id FROM public.orders o
      JOIN public.customers c ON c.id = o.customer_id
      WHERE c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "order_items_insert_own_customer" ON public.order_items;
CREATE POLICY "order_items_insert_own_customer" ON public.order_items
  FOR INSERT
  WITH CHECK (
    order_id IN (
      SELECT o.id FROM public.orders o
      JOIN public.customers c ON c.id = o.customer_id
      WHERE c.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 4. LECTURE PUBLIQUE des catalogues actifs
--    Les anons doivent pouvoir parcourir les produits/catégories d'un
--    commerce actif. On vérifie côté policy que le merchant est actif.
-- ============================================================================
DROP POLICY IF EXISTS "products_select_public_active" ON public.products;
CREATE POLICY "products_select_public_active" ON public.products
  FOR SELECT
  TO anon, authenticated
  USING (
    is_available = true
    AND merchant_id IN (SELECT id FROM public.merchants WHERE is_active = true)
  );

DROP POLICY IF EXISTS "categories_select_public_active" ON public.categories;
CREATE POLICY "categories_select_public_active" ON public.categories
  FOR SELECT
  TO anon, authenticated
  USING (
    merchant_id IN (SELECT id FROM public.merchants WHERE is_active = true)
  );

-- Promotions : lecture publique des promos actives (pour aperçu prix client).
DROP POLICY IF EXISTS "promotions_select_public_active" ON public.promotions;
CREATE POLICY "promotions_select_public_active" ON public.promotions
  FOR SELECT
  TO anon, authenticated
  USING (
    status = 'active'
    AND merchant_id IN (SELECT id FROM public.merchants WHERE is_active = true)
  );

DROP POLICY IF EXISTS "promotion_products_select_public" ON public.promotion_products;
CREATE POLICY "promotion_products_select_public" ON public.promotion_products
  FOR SELECT
  TO anon, authenticated
  USING (
    promotion_id IN (
      SELECT p.id FROM public.promotions p
      JOIN public.merchants m ON m.id = p.merchant_id
      WHERE p.status = 'active' AND m.is_active = true
    )
  );

-- =============================================================================
-- REQUÊTE DE VÉRIFICATION (à exécuter après, dans le SQL Editor) :
--
--   -- 1. Lister les produits visibles depuis l'app cliente
--   SELECT count(*) FROM public.products;
--
--   -- 2. Vérifier qu'une commande client se crée bien
--   --    (test via l'app : se connecter en client → /m/[slug] → ajouter au
--   --    panier → checkout → confirmer).
-- =============================================================================
