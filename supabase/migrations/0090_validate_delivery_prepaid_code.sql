-- =============================================================================
-- 0090 — validate_delivery : code OBLIGATOIRE dès qu'il y a du PRÉPAYÉ
-- =============================================================================
-- ⚠️ ANTI-FRAUDE. Avant : le code n'était exigé que pour payment_method='online'.
-- Or une commande CASH peut avoir été partiellement prépayée (cashback et/ou
-- Coligo Pay). Dans ce cas il y a déjà de l'argent engagé → le code DOIT être
-- exigé, sinon un livreur pourrait valider une livraison non remise.
--
-- Règle : le code est obligatoire si la commande contient la MOINDRE part
-- prépayée :
--    payment_method = 'online'   (payé via Chargily)
--    OU cashback_used_da > 0      (réduction cashback consommée)
--    OU topup_used_da   > 0       (Coligo Pay consommé)
-- Seule une commande 100 % ESPÈCES (aucun prépaiement) peut être validée SANS
-- code (validated_without_code = true, tracé).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.validate_delivery(
  p_order_id        UUID,
  p_provided_code   TEXT,
  p_skip_code       BOOLEAN DEFAULT false,
  p_client_operation_id TEXT DEFAULT NULL
) RETURNS TABLE(ok BOOLEAN, reason TEXT) AS $$
DECLARE
  v_user UUID := auth.uid();
  v_driver_id UUID;
  v_order      public.orders%ROWTYPE;
  v_prepaid    BOOLEAN;
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = v_user;
  IF v_driver_id IS NULL THEN
    ok := false; reason := 'not_a_driver'; RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    ok := false; reason := 'order_not_found'; RETURN NEXT; RETURN;
  END IF;

  IF v_order.fulfillment_type <> 'delivery' THEN
    ok := false; reason := 'not_a_delivery'; RETURN NEXT; RETURN;
  END IF;
  IF v_order.delivery_driver_id IS NULL OR v_order.delivery_driver_id <> v_driver_id THEN
    ok := false; reason := 'not_attributed_to_you'; RETURN NEXT; RETURN;
  END IF;

  IF v_order.status = 'completed' THEN
    ok := true; reason := 'already_delivered'; RETURN NEXT; RETURN;
  END IF;

  -- La commande a-t-elle une part PRÉPAYÉE ?
  v_prepaid := (v_order.payment_method = 'online')
            OR (COALESCE(v_order.cashback_used_da, 0) > 0)
            OR (COALESCE(v_order.topup_used_da, 0) > 0);

  IF v_prepaid THEN
    -- Code obligatoire : le client DOIT le communiquer (anti-fraude).
    IF p_skip_code OR p_provided_code IS NULL OR btrim(p_provided_code) = '' THEN
      ok := false; reason := 'code_required'; RETURN NEXT; RETURN;
    END IF;
    IF p_provided_code <> v_order.pickup_code THEN
      ok := false; reason := 'bad_code'; RETURN NEXT; RETURN;
    END IF;
  ELSE
    -- 100 % espèces : code encouragé mais non bloquant. Si fourni, on vérifie.
    IF NOT p_skip_code AND p_provided_code IS NOT NULL AND btrim(p_provided_code) <> '' THEN
      IF p_provided_code <> v_order.pickup_code THEN
        ok := false; reason := 'bad_code'; RETURN NEXT; RETURN;
      END IF;
    END IF;
  END IF;

  UPDATE public.orders
    SET status = 'completed',
        delivery_delivered_at = now(),
        validated_without_code =
          (p_provided_code IS NULL OR btrim(p_provided_code) = '' OR p_skip_code)
          AND NOT v_prepaid
    WHERE id = p_order_id;

  UPDATE public.tour_stops
    SET status = 'delivered', delivered_at = now()
    WHERE order_id = p_order_id AND status = 'pending';

  INSERT INTO public.order_events (order_id, from_status, to_status, client_operation_id, note)
    VALUES (p_order_id, v_order.status, 'completed', NULL,
            CASE WHEN p_client_operation_id IS NOT NULL
                 THEN 'driver_validation:' || p_client_operation_id
                 ELSE 'driver_validation' END)
    ON CONFLICT DO NOTHING;

  IF v_order.delivery_mode = 'express' THEN
    UPDATE public.driver_availability
      SET status = 'available', current_order_id = NULL
      WHERE current_order_id = p_order_id;
  END IF;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.validate_delivery(UUID, TEXT, BOOLEAN, TEXT) TO authenticated;
