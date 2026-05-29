-- =============================================================================
-- 0057 — RLS order_items : permettre au livreur de lire les articles de SES
--        commandes assignées
-- =============================================================================
-- Le livreur a besoin de connaître le contenu de la commande qu'il livre
-- (nb d'articles affiché sur l'offre, détail à la validation). On reflète la
-- policy orders 0044 : lecture autorisée si la commande parente lui est
-- attribuée (delivery_driver_id = son driver).
-- =============================================================================

DROP POLICY IF EXISTS "order_items_select_assigned_driver" ON public.order_items;
CREATE POLICY "order_items_select_assigned_driver"
  ON public.order_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND o.delivery_driver_id IS NOT NULL
        AND o.delivery_driver_id = public.driver_id_for_user(auth.uid())
    )
  );
