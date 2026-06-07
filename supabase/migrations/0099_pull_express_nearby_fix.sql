-- =============================================================================
-- 0099 — Fix pull_next_express_nearby : colonnes de sortie ambiguës
-- =============================================================================
-- Les paramètres OUT `order_id` / `merchant_driver_id` entraient en collision
-- avec la colonne `driver_availability.merchant_driver_id` dans l'INSERT/ON
-- CONFLICT (« column reference "merchant_driver_id" is ambiguous »). On renomme
-- les colonnes de sortie en `res_order_id` / `res_md_id`. Logique inchangée.
-- =============================================================================

DROP FUNCTION IF EXISTS public.pull_next_express_nearby(NUMERIC, NUMERIC, NUMERIC);

CREATE FUNCTION public.pull_next_express_nearby(
  p_lat       NUMERIC,
  p_lng       NUMERIC,
  p_radius_km NUMERIC DEFAULT 6
) RETURNS TABLE(res_order_id UUID, res_md_id UUID) AS $$
DECLARE
  v_driver_id UUID;
  v_radius    NUMERIC := GREATEST(0.5, LEAST(COALESCE(p_radius_km, 6), 20));
  v_order     RECORD;
  v_md_id     UUID;
  v_md_status public.merchant_driver_status;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN; END IF;

  SELECT id INTO v_driver_id
  FROM public.drivers
  WHERE user_id = auth.uid() AND COALESCE(is_frozen, false) = false;
  IF v_driver_id IS NULL THEN RETURN; END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.delivery_driver_id = v_driver_id
      AND o.status NOT IN ('completed', 'cancelled')
      AND o.delivery_delivered_at IS NULL
  ) THEN
    RETURN;
  END IF;

  SELECT o.id AS id, o.merchant_id AS merchant_id,
         (6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(p_lat)) * cos(radians(m.latitude)) *
              cos(radians(m.longitude) - radians(p_lng))
            + sin(radians(p_lat)) * sin(radians(m.latitude)))))) AS dist_km
    INTO v_order
  FROM public.orders o
  JOIN public.merchants m ON m.id = o.merchant_id
  WHERE o.fulfillment_type = 'delivery'
    AND o.delivery_mode = 'express'
    AND o.delivery_driver_id IS NULL
    AND o.status IN ('preparing', 'ready')
    AND m.express_enabled = true
    AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
    AND (
      o.prep_notif_at IS NULL
      OR o.marked_ready_at IS NOT NULL
      OR o.status = 'ready'
      OR o.prep_notif_at <= now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.express_declines ed
      WHERE ed.order_id = o.id
        AND ed.driver_id = v_driver_id
        AND ed.declined_at > now() - interval '10 minutes'
    )
    AND (6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(p_lat)) * cos(radians(m.latitude)) *
            cos(radians(m.longitude) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(m.latitude)))))) <= v_radius
  ORDER BY dist_km ASC, o.created_at ASC
  FOR UPDATE OF o SKIP LOCKED
  LIMIT 1;

  IF v_order.id IS NULL THEN RETURN; END IF;

  SELECT id, status INTO v_md_id, v_md_status
  FROM public.merchant_drivers
  WHERE merchant_id = v_order.merchant_id AND driver_id = v_driver_id;

  IF v_md_id IS NULL THEN
    INSERT INTO public.merchant_drivers (merchant_id, driver_id, status)
    VALUES (v_order.merchant_id, v_driver_id, 'active')
    RETURNING id INTO v_md_id;
  ELSIF v_md_status = 'blocked' THEN
    RETURN;
  ELSIF v_md_status <> 'active' THEN
    UPDATE public.merchant_drivers
      SET status = 'active', status_changed_at = now()
      WHERE id = v_md_id;
  END IF;

  UPDATE public.orders
    SET delivery_driver_id = v_driver_id,
        driver_notified_at = COALESCE(driver_notified_at, now())
    WHERE id = v_order.id;

  INSERT INTO public.driver_availability (merchant_driver_id, status, current_order_id)
    VALUES (v_md_id, 'busy', v_order.id)
    ON CONFLICT (merchant_driver_id)
    DO UPDATE SET status = 'busy', current_order_id = v_order.id;

  res_order_id := v_order.id;
  res_md_id := v_md_id;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.pull_next_express_nearby(NUMERIC, NUMERIC, NUMERIC) TO authenticated;
