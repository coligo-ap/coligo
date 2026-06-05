-- =============================================================================
-- 0071 — Lecture super-admin de TOUTES les commandes (page Alertes)
-- =============================================================================
-- L'espace super-admin a besoin de lister les commandes EN RETARD (toutes
-- enseignes confondues) sur la page « Alertes → Commandes en retard ».
-- Jusqu'ici, orders n'avait que des policies SELECT « own merchant » / « own
-- customer » : un super-admin ne voyait donc aucune commande.
--
-- On ajoute une policy SELECT réservée au super-admin (même schéma que
-- merchants_select_admin / wallet_entries_select_admin, mig 0010). Les policies
-- RLS étant combinées en OR, ça n'élargit l'accès qu'au super-admin.
-- Lecture seule : aucune policy INSERT/UPDATE/DELETE n'est ajoutée.
-- =============================================================================

DROP POLICY IF EXISTS "orders_select_admin" ON public.orders;
CREATE POLICY "orders_select_admin" ON public.orders
  FOR SELECT USING (public.is_super_admin());

-- Index partiel pour la requête « commandes actives » de la page Alertes :
-- on filtre sur les statuts non terminaux, triés par heure prévue.
CREATE INDEX IF NOT EXISTS idx_orders_active_pickup_slot
  ON public.orders(pickup_slot_at)
  WHERE status IN ('pending', 'accepted', 'preparing', 'ready');
