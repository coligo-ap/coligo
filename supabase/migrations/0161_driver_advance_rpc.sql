-- =============================================================================
-- 0161 — driver_advance_da : montant que le livreur avance au commerçant au
-- pickup d'une commande COD express (P − commission, modèle Yassir 0103/0160).
-- Affiché sur l'écran course pour que le livreur sache combien remettre.
-- Réservé au livreur ATTRIBUÉ à la commande. 0 si online / tournée / autre.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.driver_advance_da(p_order_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id UUID;
  v_order     public.orders%ROWTYPE;
  v_products  INTEGER;
  v_comm_rate NUMERIC(5, 4);
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver_id IS NULL THEN RETURN 0; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL
     OR v_order.delivery_driver_id IS DISTINCT FROM v_driver_id
     OR v_order.payment_method <> 'cash'
     OR v_order.delivery_mode <> 'express' THEN
    RETURN 0;
  END IF;

  v_products  := GREATEST(0, COALESCE(v_order.net_total_da, v_order.subtotal_da - v_order.discount_da));
  v_comm_rate := public.resolve_rate(v_order.merchant_id, 'commission_cash');
  RETURN GREATEST(v_products - round(v_products * v_comm_rate)::INTEGER, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_advance_da(UUID) TO authenticated;
