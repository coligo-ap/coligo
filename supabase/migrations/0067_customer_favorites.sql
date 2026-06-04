-- =============================================================================
-- 0067 — Favoris client (commerces mis en favori)
-- =============================================================================
-- Le client peut mettre un commerce en favori (cœur sur la carte / la page
-- commerce) pour y revenir vite depuis sa page « Mes favoris ». Persisté en DB
-- (remplace l'ancien MVP localStorage). Un favori par couple (client, commerce).
-- RLS : chaque client ne gère QUE ses propres favoris.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.customer_favorites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, merchant_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_favorites_customer
  ON public.customer_favorites(customer_id, created_at DESC);

ALTER TABLE public.customer_favorites ENABLE ROW LEVEL SECURITY;

-- Le client lit / ajoute / retire uniquement SES favoris (customer lié au user).
DROP POLICY IF EXISTS "customer_favorites_select_own" ON public.customer_favorites;
CREATE POLICY "customer_favorites_select_own"
  ON public.customer_favorites FOR SELECT
  USING (
    customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "customer_favorites_insert_own" ON public.customer_favorites;
CREATE POLICY "customer_favorites_insert_own"
  ON public.customer_favorites FOR INSERT
  WITH CHECK (
    customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "customer_favorites_delete_own" ON public.customer_favorites;
CREATE POLICY "customer_favorites_delete_own"
  ON public.customer_favorites FOR DELETE
  USING (
    customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );
