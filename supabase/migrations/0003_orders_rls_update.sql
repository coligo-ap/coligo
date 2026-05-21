-- =============================================================================
-- Coligo v3 - Migration 0003 : RLS update sur orders
-- =============================================================================
-- Appliquée automatiquement via `npm run db:push` (pooler Supabase).
--
-- La 0001 n'avait qu'une policy SELECT sur `orders`. Le commerçant doit pouvoir
-- faire évoluer le statut de SES commandes (accepter, préparer, prête) et
-- valider un retrait (-> completed). On ajoute donc la policy UPDATE.
-- =============================================================================

CREATE POLICY "orders_update_own_merchant" ON public.orders
  FOR UPDATE
  USING (
    merchant_id IN (
      SELECT id FROM public.merchants WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    merchant_id IN (
      SELECT id FROM public.merchants WHERE user_id = auth.uid()
    )
  );

-- Recherche par code de retrait (validation) : index utile.
CREATE INDEX IF NOT EXISTS idx_orders_pickup_code
  ON public.orders(merchant_id, pickup_code);
