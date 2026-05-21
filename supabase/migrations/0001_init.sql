-- =============================================================================
-- Coligo v3 - Migration initiale
-- =============================================================================

-- ============================================================================
-- 1. TABLE: merchants
-- ============================================================================
CREATE TABLE public.merchants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  category     TEXT,
  city         TEXT,
  wilaya_code  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_merchants_user_id     ON public.merchants(user_id);
CREATE INDEX idx_merchants_wilaya_code ON public.merchants(wilaya_code);

-- ============================================================================
-- 2. TABLE: orders
-- ============================================================================
CREATE TYPE public.order_status AS ENUM (
  'pending', 'accepted', 'preparing', 'ready', 'completed', 'cancelled'
);

CREATE TABLE public.orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_name   TEXT NOT NULL,
  customer_phone  TEXT NOT NULL,
  status          public.order_status NOT NULL DEFAULT 'pending',
  total_da        INTEGER NOT NULL CHECK (total_da >= 0),
  pickup_code     TEXT NOT NULL,
  pickup_slot_at  TIMESTAMPTZ NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_merchant_id ON public.orders(merchant_id);
CREATE INDEX idx_orders_status      ON public.orders(status);
CREATE INDEX idx_orders_created_at  ON public.orders(created_at DESC);

-- ============================================================================
-- 3. TABLE: order_items
-- ============================================================================
CREATE TABLE public.order_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_name   TEXT NOT NULL,
  unit_price_da  INTEGER NOT NULL CHECK (unit_price_da >= 0),
  quantity       NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
  line_total_da  INTEGER NOT NULL CHECK (line_total_da >= 0)
);

CREATE INDEX idx_order_items_order_id ON public.order_items(order_id);

-- ============================================================================
-- 4. TRIGGER: génération auto du pickup_code (6 chiffres)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.generate_pickup_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.pickup_code IS NULL OR NEW.pickup_code = '' THEN
    NEW.pickup_code := LPAD(FLOOR(RANDOM() * 900000 + 100000)::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_generate_pickup_code
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_pickup_code();

-- ============================================================================
-- 5. ROW LEVEL SECURITY (RLS)
-- ============================================================================
ALTER TABLE public.merchants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- merchants
CREATE POLICY "merchants_select_own" ON public.merchants
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "merchants_insert_own" ON public.merchants
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "merchants_update_own" ON public.merchants
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- orders
CREATE POLICY "orders_select_own_merchant" ON public.orders
  FOR SELECT USING (
    merchant_id IN (
      SELECT id FROM public.merchants WHERE user_id = auth.uid()
    )
  );

-- order_items
CREATE POLICY "order_items_select_own_merchant" ON public.order_items
  FOR SELECT USING (
    order_id IN (
      SELECT o.id FROM public.orders o
      JOIN public.merchants m ON m.id = o.merchant_id
      WHERE m.user_id = auth.uid()
    )
  );
