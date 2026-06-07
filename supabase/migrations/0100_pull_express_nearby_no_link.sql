-- =============================================================================
-- 0100 — Dispatch EXPRESS sans inscription commerçant (course autonome)
-- =============================================================================
-- Évolution du modèle livreur : l'Express n'inscrit plus le livreur chez le
-- commerçant. `pull_next_express_nearby` n'écrit PLUS de ligne `merchant_drivers`
-- ni `driver_availability` — l'attribution se résume à poser `delivery_driver_id`
-- sur la commande. La « course en cours » du livreur se déduit donc uniquement
-- de `orders.delivery_driver_id` (page /driver/course/[orderId]).
--
-- Les RPC en aval n'exigent pas le lien (vérifié) :
--   • mark_delivery_picked_up / mark_delivery_arrived : check delivery_driver_id
--   • validate_delivery / release_express_order : libèrent driver_availability
--     de façon conditionnelle (no-op si aucune ligne) → compatibles.
--
-- On conserve le respect des BLOCAGES : si un commerçant a explicitement bloqué
-- ce livreur (merchant_drivers.status='blocked'), ses commandes restent exclues.
-- Sortie réduite à `res_order_id` (le livreur est routé par orderId).
-- =============================================================================

DROP FUNCTION IF EXISTS public.pull_next_express_nearby(NUMERIC, NUMERIC, NUMERIC);

CREATE FUNCTION public.pull_next_express_nearby(
  p_lat       NUMERIC,
  p_lng       NUMERIC,
  p_radius_km NUMERIC DEFAULT 6
) RETURNS TABLE(res_order_id UUID) AS $$
DECLARE
  v_driver_id UUID;
  v_radius    NUMERIC := GREATEST(0.5, LEAST(COALESCE(p_radius_km, 6), 20));
  v_order     RECORD;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN; END IF;

  -- Appelant = un livreur non gelé.
  SELECT id INTO v_driver_id
  FROM public.drivers
  WHERE user_id = auth.uid() AND COALESCE(is_frozen, false) = false;
  IF v_driver_id IS NULL THEN RETURN; END IF;

  -- Déjà une course active → pas d'autre attribution (anti-double-course).
  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.delivery_driver_id = v_driver_id
      AND o.status NOT IN ('completed', 'cancelled')
      AND o.delivery_delivered_at IS NULL
  ) THEN
    RETURN;
  END IF;

  -- Commande express éligible la PLUS PROCHE dans le rayon.
  SELECT o.id AS id,
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
    -- Cooldown refus : ne pas re-proposer une commande qu'il vient de refuser.
    AND NOT EXISTS (
      SELECT 1 FROM public.express_declines ed
      WHERE ed.order_id = o.id
        AND ed.driver_id = v_driver_id
        AND ed.declined_at > now() - interval '10 minutes'
    )
    -- Respect d'un blocage explicite du commerçant (sans créer de lien).
    AND NOT EXISTS (
      SELECT 1 FROM public.merchant_drivers md
      WHERE md.merchant_id = o.merchant_id
        AND md.driver_id = v_driver_id
        AND md.status = 'blocked'
    )
    AND (6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(p_lat)) * cos(radians(m.latitude)) *
            cos(radians(m.longitude) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(m.latitude)))))) <= v_radius
  ORDER BY dist_km ASC, o.created_at ASC
  FOR UPDATE OF o SKIP LOCKED
  LIMIT 1;

  IF v_order.id IS NULL THEN RETURN; END IF;

  -- Attribution PURE : on pose juste le livreur sur la commande. Aucun lien
  -- commerçant, aucune ligne de disponibilité (course suivie via la commande).
  UPDATE public.orders
    SET delivery_driver_id = v_driver_id,
        driver_notified_at = COALESCE(driver_notified_at, now())
    WHERE id = v_order.id;

  res_order_id := v_order.id;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.pull_next_express_nearby(NUMERIC, NUMERIC, NUMERIC) TO authenticated;
