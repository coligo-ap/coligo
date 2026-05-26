-- =============================================================================
-- 0037 — Adresses client (prompt LIV-04 / position sur carte)
-- =============================================================================
-- Plusieurs adresses possibles par client. Une seule par défaut (contrainte
-- partielle). Téléphone alternatif facultatif par adresse.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.customer_addresses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  label            TEXT NOT NULL,
  lat              DOUBLE PRECISION NOT NULL,
  lng              DOUBLE PRECISION NOT NULL,
  address_text     TEXT,
  phone_override   TEXT,
  is_default       BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_addresses_lat_range  CHECK (lat  BETWEEN -90  AND 90),
  CONSTRAINT customer_addresses_lng_range  CHECK (lng  BETWEEN -180 AND 180)
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_addresses_one_default
  ON public.customer_addresses (customer_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer
  ON public.customer_addresses (customer_id);

ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_addresses_owner_all" ON public.customer_addresses;
CREATE POLICY "customer_addresses_owner_all"
  ON public.customer_addresses FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_addresses.customer_id
        AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_addresses.customer_id
        AND c.user_id = auth.uid()
    )
  );

-- Le commerçant CONCERNÉ par une commande livraison lit l'adresse de cette
-- commande (cf. orders.delivery_address_id en migration 0038).
-- (lecture indirecte via orders + JOIN — pas de policy directe : le commerçant
-- voit l'adresse en passant par les colonnes snapshot de orders, pas
-- en lisant cette table.)
