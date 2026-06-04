-- =============================================================================
-- 0066 — Contact livreur côté CLIENT (mini-carte de suivi temps réel)
-- =============================================================================
-- La refonte de l'écran de suivi client ajoute une mini-carte « façon Uber »
-- avec, sous la carte, le prénom du livreur et un bouton d'appel. Le client a
-- donc besoin de lire le PRÉNOM + le TÉLÉPHONE du livreur assigné à SA
-- commande — mais uniquement la sienne, et uniquement pendant la livraison.
--
-- On ne crée PAS de policy SELECT large sur `drivers` (ça exposerait les
-- coordonnées de tous les livreurs à tout client). À la place, une fonction
-- SECURITY DEFINER ciblée : elle ne renvoie le contact que si l'appelant est
-- bien le client propriétaire de la commande et qu'un livreur y est assigné.
-- Les RLS existantes restent intactes.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.order_driver_contact(p_order_id UUID)
RETURNS TABLE (first_name TEXT, phone TEXT)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    -- juste le prénom (le client n'a pas besoin du nom complet)
    split_part(d.full_name, ' ', 1) AS first_name,
    d.phone
  FROM public.orders o
  JOIN public.drivers d ON d.id = o.delivery_driver_id
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.id = p_order_id
    AND c.user_id = auth.uid()          -- l'appelant possède bien la commande
    AND o.delivery_driver_id IS NOT NULL
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.order_driver_contact(UUID) TO authenticated;
