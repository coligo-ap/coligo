-- =============================================================================
-- 0039 — Créneaux de tournée + tournées exécutées (prompt LIV-07)
-- =============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_slot_status') THEN
    CREATE TYPE public.delivery_slot_status AS ENUM ('open', 'closed', 'cancelled');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_tour_status') THEN
    CREATE TYPE public.delivery_tour_status AS ENUM ('planned', 'in_progress', 'completed', 'cancelled');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tour_stop_status') THEN
    CREATE TYPE public.tour_stop_status AS ENUM ('pending', 'delivered', 'failed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.delivery_slots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id  UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  slot_date    DATE NOT NULL,
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  max_orders   INTEGER NOT NULL CHECK (max_orders > 0),
  status       public.delivery_slot_status NOT NULL DEFAULT 'open',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT delivery_slots_time_order CHECK (start_time < end_time)
);

CREATE INDEX IF NOT EXISTS idx_delivery_slots_merchant_date
  ON public.delivery_slots (merchant_id, slot_date, start_time);

-- FK différée pour orders.delivery_slot_id (table créée en 0038, FK ici).
ALTER TABLE public.orders
  ADD CONSTRAINT orders_delivery_slot_fk
    FOREIGN KEY (delivery_slot_id) REFERENCES public.delivery_slots(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.delivery_tours (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id  UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  driver_id    UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  slot_id      UUID NOT NULL REFERENCES public.delivery_slots(id) ON DELETE CASCADE,
  status       public.delivery_tour_status NOT NULL DEFAULT 'planned',
  started_at   TIMESTAMPTZ,
  ended_at     TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slot_id, driver_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_tours_driver_status
  ON public.delivery_tours (driver_id, status);

CREATE TABLE IF NOT EXISTS public.tour_stops (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id      UUID NOT NULL REFERENCES public.delivery_tours(id) ON DELETE CASCADE,
  order_id     UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  stop_order   INTEGER NOT NULL,
  status       public.tour_stop_status NOT NULL DEFAULT 'pending',
  delivered_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tour_id, order_id),
  UNIQUE (tour_id, stop_order)
);

CREATE INDEX IF NOT EXISTS idx_tour_stops_tour_order ON public.tour_stops (tour_id, stop_order);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.delivery_slots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_tours  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tour_stops      ENABLE ROW LEVEL SECURITY;

-- delivery_slots : commerçant gère ses créneaux ; livreur ACTIF chez ce
-- commerçant les lit pour pouvoir s'inscrire à une tournée.
DROP POLICY IF EXISTS "delivery_slots_merchant_all" ON public.delivery_slots;
CREATE POLICY "delivery_slots_merchant_all"
  ON public.delivery_slots FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = delivery_slots.merchant_id AND m.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = delivery_slots.merchant_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delivery_slots_driver_select" ON public.delivery_slots;
CREATE POLICY "delivery_slots_driver_select"
  ON public.delivery_slots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.merchant_drivers md
      JOIN public.drivers d ON d.id = md.driver_id
      WHERE md.merchant_id = delivery_slots.merchant_id
        AND md.status = 'active'
        AND d.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "delivery_slots_customer_select" ON public.delivery_slots;
CREATE POLICY "delivery_slots_customer_select"
  ON public.delivery_slots FOR SELECT
  USING (
    -- Tout client authentifié peut voir les créneaux ouverts pour pouvoir
    -- choisir au checkout. Pas de fuite : seules les infos métier (date /
    -- horaire / capacité) — pas de PII.
    auth.uid() IS NOT NULL AND status = 'open'
  );

-- delivery_tours : commerçant + livreur concernés.
DROP POLICY IF EXISTS "delivery_tours_merchant" ON public.delivery_tours;
CREATE POLICY "delivery_tours_merchant"
  ON public.delivery_tours FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = delivery_tours.merchant_id AND m.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = delivery_tours.merchant_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delivery_tours_driver" ON public.delivery_tours;
CREATE POLICY "delivery_tours_driver"
  ON public.delivery_tours FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = delivery_tours.driver_id AND d.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = delivery_tours.driver_id AND d.user_id = auth.uid()
    )
  );

-- tour_stops : commerçant + livreur concernés via JOIN tour.
DROP POLICY IF EXISTS "tour_stops_merchant" ON public.tour_stops;
CREATE POLICY "tour_stops_merchant"
  ON public.tour_stops FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.delivery_tours t
      JOIN public.merchants m ON m.id = t.merchant_id
      WHERE t.id = tour_stops.tour_id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tour_stops_driver" ON public.tour_stops;
CREATE POLICY "tour_stops_driver"
  ON public.tour_stops FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.delivery_tours t
      JOIN public.drivers d ON d.id = t.driver_id
      WHERE t.id = tour_stops.tour_id AND d.user_id = auth.uid()
    )
  );
