-- =============================================================================
-- 0050 — Suivi LIVE de la position du livreur (façon UberEats/Yassir)
-- =============================================================================
-- Le livreur diffuse sa position GPS pendant qu'il livre. Le client la voit
-- en temps réel sur la carte de sa commande + un ETA estimé.
--
-- Choix d'archi : on stocke la position courante DIRECTEMENT sur la ligne
-- `orders` (3 colonnes). La table `orders` est déjà dans la publication
-- `supabase_realtime` et le client est déjà abonné à sa propre commande
-- (cf. CustomerOrderLive) → la position arrive au client SANS nouvelle
-- souscription ni nouvelle policy RLS. Une seule commande "en cours" par
-- livreur à la fois (Express) ou par stop (Tournée), donc le volume d'écriture
-- reste faible (1 update / ~12s pendant le trajet).
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS driver_live_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS driver_live_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS driver_live_at  TIMESTAMPTZ;

-- RPC : le livreur pousse sa position pour UNE commande qui lui est attribuée
-- et qui est EN COURS de livraison (récupérée, pas encore livrée). Sécurisé
-- (SECURITY DEFINER) : on vérifie que l'appelant est bien le livreur attribué.
CREATE OR REPLACE FUNCTION public.update_driver_live_location(
  p_order_id UUID,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION
) RETURNS TABLE(ok BOOLEAN, reason TEXT) AS $$
DECLARE
  v_driver_id UUID;
  v_order     public.orders%ROWTYPE;
BEGIN
  -- Coordonnées plausibles uniquement.
  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN
    ok := false; reason := 'bad_coords'; RETURN NEXT; RETURN;
  END IF;

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

  UPDATE public.orders
    SET driver_live_lat = p_lat,
        driver_live_lng = p_lng,
        driver_live_at  = now()
    WHERE id = p_order_id;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.update_driver_live_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;
