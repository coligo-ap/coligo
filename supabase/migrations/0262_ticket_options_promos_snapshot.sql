-- =============================================================================
-- 0262 — Options/variantes produit + snapshots commande (ticket « chantier complet »)
-- =============================================================================
-- Objectif : doter le catalogue d'OPTIONS/VARIANTES (façon Deliveroo) et figer
-- sur CHAQUE commande, de façon immuable, ce qui sert à préparer + facturer :
--   • options choisies par ligne (libellés FR/AR + delta prix), snapshot ;
--   • unité de vente par ligne (kg/l/pièce), snapshot ;
--   • articles OFFERTS (is_free) issus d'une promo buy-x-get-y ;
--   • promotions appliquées (type + titre FR/AR + montant + nb offerts), snapshot.
-- Tout est SNAPSHOT : modifier le catalogue/les promos plus tard n'altère pas un
-- ticket déjà émis. Aucune logique d'argent ici (le discount agrégé reste géré
-- par orders.discount_da / net_total_da, cf. 0077) : on AJOUTE de la traçabilité.
-- =============================================================================

-- ───────────────────────────────────────────────────────────────────────────
-- 1) CATALOGUE : groupes d'options + options
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_option_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name_fr     TEXT NOT NULL,
  name_ar     TEXT,
  min_select  INTEGER NOT NULL DEFAULT 0 CHECK (min_select >= 0),  -- 0=facultatif, 1=requis
  max_select  INTEGER NOT NULL DEFAULT 1 CHECK (max_select >= 1),  -- 1=variante exclusive, >1=multi
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (max_select >= min_select)
);
CREATE INDEX IF NOT EXISTS idx_option_groups_product ON public.product_option_groups(product_id, position);

CREATE TABLE IF NOT EXISTS public.product_options (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID NOT NULL REFERENCES public.product_option_groups(id) ON DELETE CASCADE,
  name_fr        TEXT NOT NULL,
  name_ar        TEXT,
  price_delta_da INTEGER NOT NULL DEFAULT 0,   -- peut être négatif (remise option)
  is_available   BOOLEAN NOT NULL DEFAULT true,
  position       INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_options_group ON public.product_options(group_id, position);

CREATE TRIGGER trigger_option_groups_updated_at BEFORE UPDATE ON public.product_option_groups
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trigger_options_updated_at BEFORE UPDATE ON public.product_options
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS : le commerçant gère les options de SES produits ; lecture publique si le
-- produit est dispo et le commerce actif (mirroir de products_select_public_active).
ALTER TABLE public.product_option_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_options       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "opt_groups_all_own" ON public.product_option_groups
  FOR ALL USING (
    product_id IN (SELECT p.id FROM public.products p
                   JOIN public.merchants m ON m.id = p.merchant_id
                   WHERE m.user_id = auth.uid())
  ) WITH CHECK (
    product_id IN (SELECT p.id FROM public.products p
                   JOIN public.merchants m ON m.id = p.merchant_id
                   WHERE m.user_id = auth.uid())
  );
CREATE POLICY "opt_groups_select_public" ON public.product_option_groups
  FOR SELECT TO anon, authenticated USING (
    product_id IN (SELECT id FROM public.products WHERE is_available = true)
  );

CREATE POLICY "options_all_own" ON public.product_options
  FOR ALL USING (
    group_id IN (SELECT g.id FROM public.product_option_groups g
                 JOIN public.products p ON p.id = g.product_id
                 JOIN public.merchants m ON m.id = p.merchant_id
                 WHERE m.user_id = auth.uid())
  ) WITH CHECK (
    group_id IN (SELECT g.id FROM public.product_option_groups g
                 JOIN public.products p ON p.id = g.product_id
                 JOIN public.merchants m ON m.id = p.merchant_id
                 WHERE m.user_id = auth.uid())
  );
CREATE POLICY "options_select_public" ON public.product_options
  FOR SELECT TO anon, authenticated USING (
    group_id IN (SELECT g.id FROM public.product_option_groups g
                 JOIN public.products p ON p.id = g.product_id
                 WHERE p.is_available = true)
  );

-- ───────────────────────────────────────────────────────────────────────────
-- 2) SNAPSHOT sur les lignes de commande
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS unit                 public.product_unit NOT NULL DEFAULT 'piece',
  ADD COLUMN IF NOT EXISTS name_ar              TEXT,                              -- nom AR figé
  ADD COLUMN IF NOT EXISTS is_free              BOOLEAN NOT NULL DEFAULT false,    -- article offert
  ADD COLUMN IF NOT EXISTS source_promotion_id  UUID REFERENCES public.promotions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.order_item_options (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id  UUID NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  group_name_fr  TEXT NOT NULL,
  group_name_ar  TEXT,
  option_name_fr TEXT NOT NULL,
  option_name_ar TEXT,
  price_delta_da INTEGER NOT NULL DEFAULT 0,
  position       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_order_item_options_item ON public.order_item_options(order_item_id, position);

-- ───────────────────────────────────────────────────────────────────────────
-- 3) SNAPSHOT des promotions appliquées à la commande
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.order_promotions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  promotion_id  UUID REFERENCES public.promotions(id) ON DELETE SET NULL,
  type          TEXT NOT NULL,                    -- snapshot du promotion_type (immuable)
  title_fr      TEXT NOT NULL,
  title_ar      TEXT,
  code          TEXT,                             -- code promo si applicable
  discount_da   INTEGER NOT NULL DEFAULT 0,
  free_qty      INTEGER NOT NULL DEFAULT 0,       -- nb d'articles offerts par cette promo
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_promotions_order ON public.order_promotions(order_id, position);

-- RLS snapshots : lecture commerçant (sa commande) + client (sa commande) ;
-- insertion client (mirroir de order_items_insert_own_customer).
ALTER TABLE public.order_item_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_promotions   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "oio_select_merchant" ON public.order_item_options FOR SELECT USING (
  order_item_id IN (SELECT oi.id FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.merchants m ON m.id = o.merchant_id WHERE m.user_id = auth.uid()));
CREATE POLICY "oio_select_customer" ON public.order_item_options FOR SELECT USING (
  order_item_id IN (SELECT oi.id FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.customers c ON c.id = o.customer_id WHERE c.user_id = auth.uid()));
CREATE POLICY "oio_insert_customer" ON public.order_item_options FOR INSERT WITH CHECK (
  order_item_id IN (SELECT oi.id FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.customers c ON c.id = o.customer_id WHERE c.user_id = auth.uid()));

CREATE POLICY "oprom_select_merchant" ON public.order_promotions FOR SELECT USING (
  order_id IN (SELECT o.id FROM public.orders o
    JOIN public.merchants m ON m.id = o.merchant_id WHERE m.user_id = auth.uid()));
CREATE POLICY "oprom_select_customer" ON public.order_promotions FOR SELECT USING (
  order_id IN (SELECT o.id FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id WHERE c.user_id = auth.uid()));
CREATE POLICY "oprom_insert_customer" ON public.order_promotions FOR INSERT WITH CHECK (
  order_id IN (SELECT o.id FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id WHERE c.user_id = auth.uid()));
