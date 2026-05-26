-- =============================================================================
-- 0040 — Attribution Express FIFO (prompt LIV-06)
-- =============================================================================
-- RPC SECURITY DEFINER : un livreur "available" appelle pull_next_express()
-- pour récupérer la 1ère commande en file de SON commerçant actif.
-- Verrou FOR UPDATE SKIP LOCKED → anti double-attribution sans race.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.pull_next_express(p_merchant_driver_id UUID)
RETURNS TABLE(order_id UUID) AS $$
DECLARE
  v_driver_user_id UUID;
  v_merchant_id    UUID;
  v_driver_id      UUID;
  v_order_id       UUID;
BEGIN
  -- 1) Sécurité : la paire merchant_driver appartient au caller (livreur actif).
  SELECT d.user_id, md.merchant_id, md.driver_id
    INTO v_driver_user_id, v_merchant_id, v_driver_id
  FROM public.merchant_drivers md
  JOIN public.drivers d ON d.id = md.driver_id
  WHERE md.id = p_merchant_driver_id
    AND md.status = 'active';

  IF v_driver_user_id IS NULL OR v_driver_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- 2) Un livreur ne pull pas s'il est déjà busy.
  IF EXISTS (
    SELECT 1 FROM public.driver_availability
    WHERE merchant_driver_id = p_merchant_driver_id AND status = 'busy'
  ) THEN
    RETURN;
  END IF;

  -- 3) Verrouille la 1ère commande en attente (FIFO).
  SELECT o.id INTO v_order_id
  FROM public.orders o
  WHERE o.merchant_id = v_merchant_id
    AND o.fulfillment_type = 'delivery'
    AND o.delivery_mode = 'express'
    AND o.delivery_driver_id IS NULL
    AND o.status IN ('preparing', 'ready')
  ORDER BY o.created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_order_id IS NULL THEN
    RETURN;
  END IF;

  -- 4) Attribue et marque le livreur busy (atomic).
  UPDATE public.orders
    SET delivery_driver_id = v_driver_id,
        delivery_picked_up_at = COALESCE(delivery_picked_up_at, now())
    WHERE id = v_order_id;

  INSERT INTO public.driver_availability (merchant_driver_id, status, current_order_id)
    VALUES (p_merchant_driver_id, 'busy', v_order_id)
    ON CONFLICT (merchant_driver_id)
    DO UPDATE SET status = 'busy', current_order_id = v_order_id;

  RETURN QUERY SELECT v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Bouton "Disponible" côté livreur : si on a une commande en cours, on ne
-- redevient pas dispo.
CREATE OR REPLACE FUNCTION public.set_driver_availability(
  p_merchant_driver_id UUID,
  p_status public.driver_avail_status
) RETURNS VOID AS $$
DECLARE
  v_user UUID;
  v_current_order UUID;
BEGIN
  SELECT d.user_id INTO v_user
  FROM public.merchant_drivers md
  JOIN public.drivers d ON d.id = md.driver_id
  WHERE md.id = p_merchant_driver_id AND md.status = 'active';

  IF v_user IS NULL OR v_user <> auth.uid() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT current_order_id INTO v_current_order
  FROM public.driver_availability WHERE merchant_driver_id = p_merchant_driver_id;

  IF v_current_order IS NOT NULL AND p_status <> 'busy' THEN
    RAISE EXCEPTION 'has_pending_order';
  END IF;

  INSERT INTO public.driver_availability (merchant_driver_id, status)
    VALUES (p_merchant_driver_id, p_status)
    ON CONFLICT (merchant_driver_id)
    DO UPDATE SET status = p_status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.pull_next_express(UUID)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_driver_availability(UUID, public.driver_avail_status) TO authenticated;
