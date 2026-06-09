-- =============================================================================
-- 0108 — Distinction GEL (souple) vs BLOCAGE (dur) d'un compte livreur
-- =============================================================================
-- GELÉ (is_frozen) = sanction SOUPLE : le livreur accède toujours à son compte
--   et à ses pages, MAIS son activité est suspendue (impossible de passer en
--   ligne / recevoir des courses). Ex. cotisations impayées, compte non vérifié.
-- BLOQUÉ (is_blocked) = sanction DURE : aucun accès aux pages (juste un message
--   « compte bloqué » + la barre de navigation), activité suspendue aussi.
--   Ex. livreur dangereux / suspect / violation du contrat.
-- Les deux suspendent l'activité ; le blocage est plus strict côté accès UI
--   (géré dans le layout livreur).
-- =============================================================================

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS is_blocked    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS block_reason  TEXT,
  ADD COLUMN IF NOT EXISTS frozen_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS freeze_reason TEXT;

-- ----------------------------------------------------------------------------
-- Gardes d'activité : un livreur gelé OU bloqué ne peut ni passer en ligne ni
-- recevoir de course. (On élargit les gardes 0104 à `is_blocked`.)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_driver_availability(
  p_merchant_driver_id uuid, p_status driver_avail_status)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user UUID;
  v_blocked_or_frozen BOOLEAN;
  v_current_order UUID;
BEGIN
  SELECT d.user_id, (COALESCE(d.is_frozen, false) OR COALESCE(d.is_blocked, false))
    INTO v_user, v_blocked_or_frozen
  FROM public.merchant_drivers md
  JOIN public.drivers d ON d.id = md.driver_id
  WHERE md.id = p_merchant_driver_id AND md.status = 'active';

  IF v_user IS NULL OR v_user <> auth.uid() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Gelé/bloqué → seul le retour « offline » est permis.
  IF v_blocked_or_frozen AND p_status <> 'offline' THEN
    RAISE EXCEPTION 'account_frozen';
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
$$;

CREATE OR REPLACE FUNCTION public.pull_next_express(p_merchant_driver_id uuid)
RETURNS TABLE(order_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_driver_user_id UUID;
  v_merchant_id    UUID;
  v_driver_id      UUID;
  v_blocked_frozen BOOLEAN;
  v_order_id       UUID;
BEGIN
  SELECT d.user_id, md.merchant_id, md.driver_id,
         (COALESCE(d.is_frozen, false) OR COALESCE(d.is_blocked, false))
    INTO v_driver_user_id, v_merchant_id, v_driver_id, v_blocked_frozen
  FROM public.merchant_drivers md
  JOIN public.drivers d ON d.id = md.driver_id
  WHERE md.id = p_merchant_driver_id
    AND md.status = 'active';

  IF v_driver_user_id IS NULL OR v_driver_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF v_blocked_frozen THEN
    RETURN; -- gelé ou bloqué → aucune attribution
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.driver_availability
    WHERE merchant_driver_id = p_merchant_driver_id AND status = 'busy'
  ) THEN
    RETURN;
  END IF;

  SELECT o.id INTO v_order_id
  FROM public.orders o
  WHERE o.merchant_id = v_merchant_id
    AND o.fulfillment_type = 'delivery'
    AND o.delivery_mode = 'express'
    AND o.delivery_driver_id IS NULL
    AND o.status IN ('preparing', 'ready')
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
  ORDER BY o.created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_order_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.orders
    SET delivery_driver_id = v_driver_id,
        driver_notified_at = COALESCE(driver_notified_at, now())
    WHERE id = v_order_id;

  INSERT INTO public.driver_availability (merchant_driver_id, status, current_order_id)
    VALUES (p_merchant_driver_id, 'busy', v_order_id)
    ON CONFLICT (merchant_driver_id)
    DO UPDATE SET status = 'busy', current_order_id = v_order_id;

  RETURN QUERY SELECT v_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pull_next_express_nearby(p_lat numeric, p_lng numeric, p_radius_km numeric DEFAULT 6)
RETURNS TABLE(res_order_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_driver_id UUID;
  v_radius    NUMERIC := GREATEST(0.5, LEAST(COALESCE(p_radius_km, 6), 20));
  v_order     RECORD;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN; END IF;

  -- Appelant = un livreur ni gelé NI bloqué.
  SELECT id INTO v_driver_id
  FROM public.drivers
  WHERE user_id = auth.uid()
    AND COALESCE(is_frozen, false) = false
    AND COALESCE(is_blocked, false) = false;
  IF v_driver_id IS NULL THEN RETURN; END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.delivery_driver_id = v_driver_id
      AND o.status NOT IN ('completed', 'cancelled')
      AND o.delivery_delivered_at IS NULL
  ) THEN
    RETURN;
  END IF;

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
    AND NOT EXISTS (
      SELECT 1 FROM public.express_declines ed
      WHERE ed.order_id = o.id
        AND ed.driver_id = v_driver_id
        AND ed.declined_at > now() - interval '10 minutes'
    )
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

  UPDATE public.orders
    SET delivery_driver_id = v_driver_id,
        driver_notified_at = COALESCE(driver_notified_at, now())
    WHERE id = v_order.id;

  res_order_id := v_order.id;
  RETURN NEXT;
END;
$$;

-- =============================================================================
-- VÉRIF :
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='drivers' AND column_name IN ('is_blocked','block_reason');
-- =============================================================================
