-- =============================================================================
-- 0098 — Dispatch EXPRESS par ZONE (tout livreur proche en ligne)
-- =============================================================================
-- Un livreur en ligne reçoit/peut prendre la commande express d'un commerçant
-- PROCHE, qu'il soit rattaché ou non. Mirroir géographique de pull_next_express
-- (0060), mais clé sur le LIVREUR (pas le lien commerçant) :
--
--   • Distance Haversine entre la position GPS du livreur et le commerçant,
--     bornée par un rayon (défaut 6 km, max 20).
--   • Mêmes filtres FIFO/timing que 0060 (express, non attribuée,
--     preparing/ready, gate prep_notif_at, cooldown refus 10 min).
--   • Garde anti-double-course : si le livreur a DÉJÀ une course active, on ne
--     lui en attribue pas d'autre.
--   • Sécurité : respecte les BLOCAGES — si le commerçant a bloqué ce livreur
--     (merchant_drivers.status='blocked'), aucune attribution.
--   • Prendre une course proche RATTACHE le livreur au commerçant (lien créé
--     'active' s'il n'existe pas) → tout le flux éprouvé (offre → course →
--     validation, driver_availability, page /driver/m/[id]) est réutilisé tel
--     quel. Verrou FOR UPDATE SKIP LOCKED → pas de double attribution.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.pull_next_express_nearby(
  p_lat       NUMERIC,
  p_lng       NUMERIC,
  p_radius_km NUMERIC DEFAULT 6
) RETURNS TABLE(order_id UUID, merchant_driver_id UUID) AS $$
DECLARE
  v_driver_id UUID;
  v_radius    NUMERIC := GREATEST(0.5, LEAST(COALESCE(p_radius_km, 6), 20));
  v_order     RECORD;
  v_md_id     UUID;
  v_md_status public.merchant_driver_status;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN; END IF;

  -- Appelant = un livreur non gelé.
  SELECT id INTO v_driver_id
  FROM public.drivers
  WHERE user_id = auth.uid() AND COALESCE(is_frozen, false) = false;
  IF v_driver_id IS NULL THEN RETURN; END IF;

  -- Déjà une course active → pas d'autre attribution.
  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.delivery_driver_id = v_driver_id
      AND o.status NOT IN ('completed', 'cancelled')
      AND o.delivery_delivered_at IS NULL
  ) THEN
    RETURN;
  END IF;

  -- Commande express éligible la PLUS PROCHE dans le rayon.
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

  -- Lien livreur ↔ commerçant : respecte un éventuel blocage, sinon (ré)active.
  SELECT id, status INTO v_md_id, v_md_status
  FROM public.merchant_drivers
  WHERE merchant_id = v_order.merchant_id AND driver_id = v_driver_id;

  IF v_md_id IS NULL THEN
    INSERT INTO public.merchant_drivers (merchant_id, driver_id, status)
    VALUES (v_order.merchant_id, v_driver_id, 'active')
    RETURNING id INTO v_md_id;
  ELSIF v_md_status = 'blocked' THEN
    RETURN; -- bloqué par ce commerçant → on n'attribue pas.
  ELSIF v_md_status <> 'active' THEN
    UPDATE public.merchant_drivers
      SET status = 'active', status_changed_at = now()
      WHERE id = v_md_id;
  END IF;

  -- Attribution (mêmes effets que pull_next_express).
  UPDATE public.orders
    SET delivery_driver_id = v_driver_id,
        driver_notified_at = COALESCE(driver_notified_at, now())
    WHERE id = v_order.id;

  INSERT INTO public.driver_availability (merchant_driver_id, status, current_order_id)
    VALUES (v_md_id, 'busy', v_order.id)
    ON CONFLICT (merchant_driver_id)
    DO UPDATE SET status = 'busy', current_order_id = v_order.id;

  order_id := v_order.id;
  merchant_driver_id := v_md_id;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.pull_next_express_nearby(NUMERIC, NUMERIC, NUMERIC) TO authenticated;
