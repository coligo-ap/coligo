-- =============================================================================
-- 0045 — Fix validate_delivery RPC : client_operation_id n'est PAS un UUID
-- =============================================================================
-- Bug détecté par test bout-en-bout : la RPC `validate_delivery` (cf. 0041)
-- insère dans `order_events.client_operation_id` (type UUID) une valeur
-- fournie par le client sous forme de chaîne `validate-<order_id>-<ts>`
-- → ERREUR : `column "client_operation_id" is of type uuid but expression is
--   of type text`. La RPC échoue intégralement, donc AUCUNE livraison ne
-- peut être marquée comme livrée en prod.
--
-- Fix : la RPC `validate_delivery` n'écrit plus client_operation_id dans
-- order_events (NULL). L'idempotency est déjà assurée par le check sur
-- orders.status='completed' en amont (cf. RPC source en 0041 — étape 3).
-- Le client_operation_id reste utilisé par updateOrderStatus pour les
-- transitions retrait sur place — flux distinct, où c'est bien un UUID.
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
BEGIN
  -- 1) Le caller doit être un livreur (auth user lié à une ligne drivers).
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = v_user;
  IF v_driver_id IS NULL THEN
    ok := false; reason := 'not_a_driver'; RETURN NEXT; RETURN;
  END IF;

  -- 2) Charge la commande (verrou).
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

  -- 3) Idempotency : si déjà 'completed', on renvoie ok sans rejouer.
  IF v_order.status = 'completed' THEN
    ok := true; reason := 'already_delivered'; RETURN NEXT; RETURN;
  END IF;

  -- 4) Online → code OBLIGATOIRE.
  IF v_order.payment_method = 'online' THEN
    IF p_skip_code OR p_provided_code IS NULL OR btrim(p_provided_code) = '' THEN
      ok := false; reason := 'online_requires_code'; RETURN NEXT; RETURN;
    END IF;
    IF p_provided_code <> v_order.pickup_code THEN
      ok := false; reason := 'bad_code'; RETURN NEXT; RETURN;
    END IF;
  ELSE
    -- Cash : non bloquant. Si code fourni, on le vérifie.
    IF NOT p_skip_code AND p_provided_code IS NOT NULL AND btrim(p_provided_code) <> '' THEN
      IF p_provided_code <> v_order.pickup_code THEN
        ok := false; reason := 'bad_code'; RETURN NEXT; RETURN;
      END IF;
    END IF;
  END IF;

  -- 5) Valide.
  UPDATE public.orders
    SET status = 'completed',
        delivery_delivered_at = now(),
        validated_without_code = (p_provided_code IS NULL OR p_provided_code = '' OR p_skip_code)
                                  AND v_order.payment_method <> 'online'
    WHERE id = p_order_id;

  -- 6) Tour stop (si tournée) → marqué delivered.
  UPDATE public.tour_stops
    SET status = 'delivered', delivered_at = now()
    WHERE order_id = p_order_id AND status = 'pending';

  -- 7) Audit order_events — client_operation_id mis à NULL (le paramètre TEXT
  --    de la signature n'est conservé que pour rétro-compat de l'appelant ;
  --    on ne tente pas de le caster en UUID — cf. raison du fix).
  INSERT INTO public.order_events (order_id, from_status, to_status, client_operation_id, note)
    VALUES (p_order_id, v_order.status, 'completed', NULL,
            CASE WHEN p_client_operation_id IS NOT NULL
                 THEN 'driver_validation:' || p_client_operation_id
                 ELSE 'driver_validation' END)
    ON CONFLICT DO NOTHING;

  -- 8) Libère le livreur en express.
  IF v_order.delivery_mode = 'express' THEN
    UPDATE public.driver_availability
      SET status = 'available', current_order_id = NULL
      WHERE current_order_id = p_order_id;
  END IF;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.validate_delivery(UUID, TEXT, BOOLEAN, TEXT) TO authenticated;
