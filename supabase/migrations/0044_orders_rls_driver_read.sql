-- =============================================================================
-- 0044 — RLS orders : permettre au livreur de lire SES commandes assignées
-- =============================================================================
-- Bug détecté par test bout-en-bout : les routes livreur
-- (/driver/m/[id], /driver/m/[id]/tours/[id]) lisent `orders` directement
-- en tant qu'utilisateur connecté ; sans policy SELECT pour les drivers, ils
-- voyaient `null` et l'UI affichait "commande introuvable" même quand la
-- commande leur était bel et bien attribuée (delivery_driver_id correct).
--
-- Fix : policy SELECT qui matche delivery_driver_id contre le driver lié au
-- user courant via le helper introduit en 0043.
-- =============================================================================

DROP POLICY IF EXISTS "orders_driver_select_assigned" ON public.orders;
CREATE POLICY "orders_driver_select_assigned"
  ON public.orders FOR SELECT
  USING (
    delivery_driver_id IS NOT NULL
    AND delivery_driver_id = public.driver_id_for_user(auth.uid())
  );
