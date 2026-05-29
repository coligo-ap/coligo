-- =============================================================================
-- 0055 — Étape « Le livreur est arrivé » (façon UberEats/Yassir)
-- =============================================================================
-- Entre « récupérée » et « livrée », le livreur signale son arrivée chez le
-- client. Le client le voit en temps réel (la colonne est sur `orders`, déjà
-- dans la publication realtime → aucune nouvelle policy/souscription requise).
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_arrived_at TIMESTAMPTZ;

-- RPC : le livreur attribué marque son arrivée pour UNE commande en cours de
-- livraison (récupérée, pas encore livrée). Idempotent. SECURITY DEFINER :
-- on vérifie que l'appelant est bien le livreur attribué (cf. 0050).
CREATE OR REPLACE FUNCTION public.mark_delivery_arrived(
  p_order_id UUID
) RETURNS TABLE(ok BOOLEAN, reason TEXT) AS $$
DECLARE
  v_driver_id UUID;
  v_order     public.orders%ROWTYPE;
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver_id IS NULL THEN
    ok := false; reason := 'not_a_driver'; RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    ok := false; reason := 'order_not_found'; RETURN NEXT; RETURN;
  END IF;
  IF v_order.delivery_driver_id IS NULL OR v_order.delivery_driver_id <> v_driver_id THEN
    ok := false; reason := 'not_attributed_to_you'; RETURN NEXT; RETURN;
  END IF;
  -- En cours de livraison uniquement : récupérée et pas encore livrée.
  IF v_order.delivery_picked_up_at IS NULL
     OR v_order.delivery_delivered_at IS NOT NULL
     OR v_order.status IN ('completed', 'cancelled') THEN
    ok := false; reason := 'not_in_transit'; RETURN NEXT; RETURN;
  END IF;

  -- Idempotent : ne réécrit pas l'horodatage si déjà arrivé.
  IF v_order.delivery_arrived_at IS NULL THEN
    UPDATE public.orders SET delivery_arrived_at = now() WHERE id = p_order_id;
  END IF;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.mark_delivery_arrived(UUID) TO authenticated;
