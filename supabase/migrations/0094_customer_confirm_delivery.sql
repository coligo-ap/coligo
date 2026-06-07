-- =============================================================================
-- 0094 — Confirmation de réception PAR LE CLIENT (glisser pour confirmer)
-- =============================================================================
-- Voie de validation alternative : le CLIENT confirme lui-même, sur SON compte,
-- avoir bien reçu sa commande. Très utile quand le téléphone du livreur est
-- éteint/déchargé : le livreur demande au client de glisser pour confirmer.
--
-- Vaut aussi (et surtout) pour les commandes PRÉPAYÉES (cashback / Coligo Pay /
-- Chargily, en partie ou en totalité) : la confirmation du client est une
-- preuve de remise au moins aussi forte que le code → on n'exige pas le code.
--
-- Conditions strictes (anti-fraude) :
--   • l'appelant est le CLIENT propriétaire de la commande ;
--   • c'est une livraison avec un livreur attribué ;
--   • le livreur est ARRIVÉ chez le client (delivery_arrived_at non nul) ;
--   • la commande n'est ni déjà livrée ni annulée.
--
-- Effets IDENTIQUES à validate_delivery (mêmes UPDATE/INSERT → mêmes
-- déclencheurs en aval : ledger, etc.). Tracé via order_events note
-- 'customer_confirmation' ; validated_without_code = false (validation forte).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.customer_confirm_delivery(
  p_order_id UUID
) RETURNS TABLE(ok BOOLEAN, reason TEXT) AS $$
DECLARE
  v_user  UUID := auth.uid();
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT o.* INTO v_order
  FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.id = p_order_id AND c.user_id = v_user
  FOR UPDATE OF o;

  IF v_order.id IS NULL THEN
    ok := false; reason := 'not_your_order'; RETURN NEXT; RETURN;
  END IF;
  IF v_order.fulfillment_type <> 'delivery' THEN
    ok := false; reason := 'not_a_delivery'; RETURN NEXT; RETURN;
  END IF;
  IF v_order.delivery_driver_id IS NULL THEN
    ok := false; reason := 'no_driver'; RETURN NEXT; RETURN;
  END IF;
  IF v_order.status = 'completed' OR v_order.delivery_delivered_at IS NOT NULL THEN
    ok := true; reason := 'already_delivered'; RETURN NEXT; RETURN;
  END IF;
  IF v_order.status = 'cancelled' THEN
    ok := false; reason := 'cancelled'; RETURN NEXT; RETURN;
  END IF;
  IF v_order.delivery_arrived_at IS NULL THEN
    ok := false; reason := 'driver_not_arrived'; RETURN NEXT; RETURN;
  END IF;

  UPDATE public.orders
    SET status = 'completed',
        delivery_delivered_at = now(),
        validated_without_code = false
    WHERE id = p_order_id;

  UPDATE public.tour_stops
    SET status = 'delivered', delivered_at = now()
    WHERE order_id = p_order_id AND status = 'pending';

  INSERT INTO public.order_events (order_id, from_status, to_status, client_operation_id, note)
    VALUES (p_order_id, v_order.status, 'completed', NULL, 'customer_confirmation')
    ON CONFLICT DO NOTHING;

  IF v_order.delivery_mode = 'express' THEN
    UPDATE public.driver_availability
      SET status = 'available', current_order_id = NULL
      WHERE current_order_id = p_order_id;
  END IF;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.customer_confirm_delivery(UUID) TO authenticated;
