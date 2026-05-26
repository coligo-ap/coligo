-- =============================================================================
-- 0038 — Snapshot livraison dans orders (prompt LIV-05 / checkout livraison)
-- =============================================================================
-- Tout le contexte livraison d'une commande est SNAPSHOTÉ ici. Le client
-- pourrait changer son adresse plus tard, ça ne doit pas perturber l'audit.
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_fee_da              INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_address_id          UUID REFERENCES public.customer_addresses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_address_text        TEXT,
  ADD COLUMN IF NOT EXISTS delivery_lat                 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS delivery_lng                 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS delivery_phone               TEXT,
  ADD COLUMN IF NOT EXISTS delivery_distance_km         NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS delivery_driver_id           UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_picked_up_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_delivered_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validated_without_code       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_slot_id             UUID; -- FK ajoutée en 0039

-- Cohérence : une commande livraison DOIT avoir lat/lng (snapshot).
ALTER TABLE public.orders
  ADD CONSTRAINT orders_delivery_geo_required
    CHECK (
      fulfillment_type = 'pickup'
      OR (delivery_lat IS NOT NULL AND delivery_lng IS NOT NULL)
    );

-- Index lookup commerçant côté dashboard
CREATE INDEX IF NOT EXISTS idx_orders_merchant_fulfillment_status
  ON public.orders (merchant_id, fulfillment_type, status);

-- Index file Express FIFO : commandes livraison pas encore attribuées.
CREATE INDEX IF NOT EXISTS idx_orders_express_queue
  ON public.orders (merchant_id, created_at)
  WHERE fulfillment_type = 'delivery'
    AND delivery_mode = 'express'
    AND delivery_driver_id IS NULL
    AND status IN ('pending', 'accepted', 'preparing', 'ready');
