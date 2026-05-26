-- =============================================================================
-- 0041 — Validation livraison par code + masquage commerçant (prompt LIV-08)
-- =============================================================================
-- Pour les commandes LIVRAISON, le commerçant NE DOIT PAS voir le pickup_code.
-- Le client le communique au livreur à la remise. Le livreur valide :
--   - online → code OBLIGATOIRE (vérification serveur).
--   - cash   → code encouragé mais non bloquant (validated_without_code tracé).
-- =============================================================================

-- RPC SECURITY DEFINER : la seule façon de marquer une livraison livrée.
-- Vérifie le code, idempotent (la 2e validation est un no-op).
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
  v_already_delivered BOOLEAN := false;
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

  -- 7) Audit order_events (réutilise l'existant).
  INSERT INTO public.order_events (order_id, from_status, to_status, client_operation_id)
    VALUES (p_order_id, v_order.status, 'completed', p_client_operation_id)
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

-- Vue serveur "merchant-safe" : commande SANS le pickup_code pour les
-- livraisons. Le code côté commerçant pour le retrait reste accessible via
-- la table `orders` (qui passe par RLS). Les nouveaux écrans utilisent
-- explicitement cette vue pour le contexte livraison.
CREATE OR REPLACE VIEW public.orders_for_merchant AS
SELECT
  o.id, o.merchant_id, o.customer_id, o.customer_name, o.customer_phone,
  o.status, o.total_da, o.subtotal_da, o.discount_da, o.service_fee_da,
  o.cashback_da, o.cashback_estimate_da, o.cashback_used_da, o.topup_used_da,
  o.commission_da,
  -- pickup_code MASQUÉ pour les livraisons (NULL renvoyé), conservé pour pickup.
  CASE WHEN o.fulfillment_type = 'delivery' THEN NULL ELSE o.pickup_code END AS pickup_code,
  o.pickup_type, o.pickup_slot_at, o.pickup_slot_start, o.pickup_slot_end,
  o.customer_note, o.notes,
  o.payment_method, o.payment_status,
  o.fulfillment_type, o.delivery_mode,
  o.delivery_fee_da, o.delivery_address_text, o.delivery_lat, o.delivery_lng,
  o.delivery_phone, o.delivery_distance_km, o.delivery_driver_id,
  o.delivery_picked_up_at, o.delivery_delivered_at,
  o.delivery_slot_id, o.validated_without_code,
  o.created_at
FROM public.orders o;

-- La vue hérite des RLS de orders (security_invoker par défaut sur Postgres
-- 15+). Sinon, le commerçant verrait toutes les commandes via la vue.
ALTER VIEW public.orders_for_merchant SET (security_invoker = true);
