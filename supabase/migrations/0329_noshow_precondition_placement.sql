-- =============================================================================
-- 0329 — No-show online : placement correct des préconditions (raffinement 0328)
-- =============================================================================
-- Décision UX (façon UberEats) : on distingue deux gestes.
--   • « Je suis arrivé » = arrivée GÉO-CLÔTURÉE (à quelques mètres de l'adresse
--     exacte) qui DÉMARRE le minuteur no-show et prévient le client en temps
--     réel. Elle n'exige QUE la géo-clôture (pas d'appel/message) — un client
--     présent ne doit pas subir de friction inutile.
--   • « Déposer à l'adresse » (leave-at-door, ONLINE, après minuteur) = geste
--     sensible (la marchandise est laissée) → préconditions FORTES : le livreur
--     a tenté d'APPELER le client ET envoyé ≥1 MESSAGE d'arrivée, PUIS photo de
--     preuve. C'est ici que ces préconditions vivent (déplacées depuis 0328).
-- =============================================================================

-- 1) Arrivée = géo-clôture seule.
CREATE OR REPLACE FUNCTION public.driver_confirm_arrival(
  p_order_id UUID,
  p_lat      DOUBLE PRECISION,
  p_lng      DOUBLE PRECISION
) RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id UUID;
  v_order     public.orders%ROWTYPE;
  v_geo_m     INTEGER;
  v_dist_m    NUMERIC;
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver_id IS NULL THEN ok := false; reason := 'not_a_driver'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN ok := false; reason := 'order_not_found'; RETURN NEXT; RETURN; END IF;
  IF v_order.delivery_driver_id IS DISTINCT FROM v_driver_id THEN
    ok := false; reason := 'not_attributed_to_you'; RETURN NEXT; RETURN; END IF;
  IF v_order.delivery_picked_up_at IS NULL
     OR v_order.delivery_delivered_at IS NOT NULL
     OR v_order.status IN ('completed', 'cancelled') THEN
    ok := false; reason := 'not_in_transit'; RETURN NEXT; RETURN; END IF;

  -- Idempotent : déjà arrivé → succès (minuteur déjà lancé).
  IF v_order.delivery_arrived_at IS NOT NULL THEN
    ok := true; reason := NULL; RETURN NEXT; RETURN;
  END IF;

  SELECT COALESCE(noshow_geofence_m, 150) INTO v_geo_m
    FROM public.platform_settings WHERE id = true;

  IF v_order.delivery_lat IS NOT NULL AND v_order.delivery_lng IS NOT NULL
     AND p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    v_dist_m := public.km_between(p_lat, p_lng, v_order.delivery_lat, v_order.delivery_lng) * 1000.0;
    IF v_dist_m > v_geo_m THEN
      ok := false; reason := 'too_far'; RETURN NEXT; RETURN;
    END IF;
  ELSE
    ok := false; reason := 'no_location'; RETURN NEXT; RETURN;
  END IF;

  UPDATE public.orders
     SET delivery_arrived_at  = now(),
         delivery_geofence_ok = true,
         driver_live_lat = p_lat, driver_live_lng = p_lng, driver_live_at = now()
   WHERE id = p_order_id;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_confirm_arrival(UUID, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

-- 2) Dépôt à l'adresse = préconditions FORTES (appel + message) + minuteur + photo.
CREATE OR REPLACE FUNCTION public.driver_leave_at_door(
  p_order_id UUID,
  p_photo_url TEXT,
  p_note      TEXT DEFAULT NULL,
  p_client_operation_id TEXT DEFAULT NULL
) RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id UUID;
  v_order     public.orders%ROWTYPE;
  v_wait      INTEGER;
  v_has_msg   BOOLEAN;
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver_id IS NULL THEN ok := false; reason := 'not_a_driver'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN ok := false; reason := 'order_not_found'; RETURN NEXT; RETURN; END IF;
  IF v_order.delivery_driver_id IS DISTINCT FROM v_driver_id THEN
    ok := false; reason := 'not_attributed_to_you'; RETURN NEXT; RETURN; END IF;
  IF v_order.status = 'completed' THEN
    ok := true; reason := 'already_delivered'; RETURN NEXT; RETURN; END IF;
  IF v_order.status = 'cancelled' THEN
    ok := false; reason := 'already_closed'; RETURN NEXT; RETURN; END IF;

  IF v_order.payment_method <> 'online' OR v_order.payment_status <> 'paid' THEN
    ok := false; reason := 'cash_not_allowed'; RETURN NEXT; RETURN;
  END IF;

  IF v_order.delivery_picked_up_at IS NULL THEN
    ok := false; reason := 'not_picked_up'; RETURN NEXT; RETURN; END IF;
  IF v_order.delivery_arrived_at IS NULL THEN
    ok := false; reason := 'not_arrived'; RETURN NEXT; RETURN; END IF;

  -- Préconditions anti-fraude : appel tenté + message d'arrivée envoyé.
  IF v_order.delivery_call_attempted_at IS NULL THEN
    ok := false; reason := 'call_required'; RETURN NEXT; RETURN;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.order_messages m
     WHERE m.order_id = p_order_id AND m.sender_role = 'courier'
  ) INTO v_has_msg;
  IF NOT v_has_msg THEN
    ok := false; reason := 'message_required'; RETURN NEXT; RETURN;
  END IF;

  IF p_photo_url IS NULL OR btrim(p_photo_url) = '' THEN
    ok := false; reason := 'photo_required'; RETURN NEXT; RETURN; END IF;

  SELECT GREATEST(1, COALESCE(noshow_wait_min, 8)) INTO v_wait
    FROM public.platform_settings WHERE id = true;
  IF now() < v_order.delivery_arrived_at + make_interval(mins => v_wait) THEN
    ok := false; reason := 'too_early'; RETURN NEXT; RETURN;
  END IF;

  UPDATE public.orders
     SET status                = 'completed',
         delivery_delivered_at = now(),
         delivery_no_show_at   = now(),
         delivery_no_show_kind = 'left_at_door',
         delivery_proof_url    = p_photo_url,
         delivery_proof_note   = NULLIF(btrim(COALESCE(p_note, '')), '')
   WHERE id = p_order_id;

  UPDATE public.tour_stops
     SET status = 'delivered', delivered_at = now()
   WHERE order_id = p_order_id AND status = 'pending';

  INSERT INTO public.order_events (order_id, from_status, to_status, client_operation_id, note)
  VALUES (p_order_id, v_order.status, 'completed', NULL,
          'leave_at_door_no_show:' || COALESCE(p_client_operation_id, ''))
  ON CONFLICT DO NOTHING;

  IF v_order.delivery_mode = 'express' THEN
    UPDATE public.driver_availability
       SET status = 'available', current_order_id = NULL
     WHERE current_order_id = p_order_id;
  END IF;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_leave_at_door(UUID, TEXT, TEXT, TEXT) TO authenticated;
