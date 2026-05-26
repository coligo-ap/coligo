-- =============================================================================
-- 0046 — orders.delivery_note (commentaire client → livreur/commerçant)
-- =============================================================================
-- Le client peut laisser une note spécifique à la livraison (« sonner deux
-- fois », « code porte 1234 », « bâtiment B 3e étage »...). Distincte de
-- `customer_note` (qui sert au commerçant pour la préparation).
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_note TEXT;
