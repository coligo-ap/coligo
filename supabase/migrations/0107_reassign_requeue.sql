-- =============================================================================
-- 0107 — Réattribution : remise au réseau même après un retrait DÉCLARÉ par erreur
-- =============================================================================
-- Cas réel : un livreur clique « J'ai récupéré » par erreur (mauvaise commande)
-- → le super-admin doit pouvoir REMETTRE la commande au réseau (ou à un livreur
-- précis) et la faire RE-CIRCULER comme une nouvelle commande, en PRIORITÉ.
--
-- On lève donc le garde `already_picked_up` : la réattribution réinitialise
-- `delivery_picked_up_at` / `delivery_arrived_at` / `driver_notified_at`. C'est
-- SÛR car aucune écriture financière n'est générée avant la LIVRAISON validée
-- (trigger sur `completed`/`delivered`) — seul ce dernier état reste bloquant.
--
-- Priorité réseau : la commande repasse `delivery_driver_id = NULL` en statut
-- preparing/ready → `pull_next_express*` la re-propose, triée par `created_at`
-- ASC (donc la plus ancienne = prioritaire).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_reassign_delivery(
  p_order_id uuid,
  p_mode text,
  p_driver_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_order      public.orders%ROWTYPE;
  v_old_driver UUID;
  v_md_id      UUID;
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  IF v_order.fulfillment_type <> 'delivery' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_delivery');
  END IF;
  -- Seuls les états terminaux bloquent (commande livrée / annulée).
  IF v_order.status IN ('completed', 'cancelled')
     OR v_order.delivery_delivered_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_terminal');
  END IF;

  v_old_driver := v_order.delivery_driver_id;

  -- Libère la disponibilité de l'ancien livreur (paire occupée par CETTE cmd).
  IF v_old_driver IS NOT NULL THEN
    UPDATE public.driver_availability da
      SET status = 'available', current_order_id = NULL
      FROM public.merchant_drivers md
      WHERE da.merchant_driver_id = md.id
        AND md.driver_id = v_old_driver
        AND da.current_order_id = p_order_id;
  END IF;

  IF p_mode = 'pool' THEN
    -- Remise au réseau + re-circulation comme une nouvelle commande : on REMET
    -- À ZÉRO le retrait/arrivée éventuels (cas « récupéré par erreur »).
    UPDATE public.orders
      SET delivery_driver_id  = NULL,
          driver_notified_at  = NULL,
          delivery_picked_up_at = NULL,
          delivery_arrived_at = NULL
      WHERE id = p_order_id;
    -- L'ancien livreur ne re-prend pas immédiatement (cooldown 10 min) → laisse
    -- la priorité aux AUTRES livreurs du réseau.
    IF v_old_driver IS NOT NULL THEN
      INSERT INTO public.express_declines (order_id, driver_id)
        VALUES (p_order_id, v_old_driver)
        ON CONFLICT (order_id, driver_id) DO UPDATE SET declined_at = now();
    END IF;

  ELSIF p_mode = 'driver' THEN
    IF p_driver_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'driver_required');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.drivers
      WHERE id = p_driver_id AND COALESCE(is_frozen, false) = false
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'driver_unavailable');
    END IF;

    UPDATE public.orders
      SET delivery_driver_id  = p_driver_id,
          driver_notified_at  = now(),
          delivery_picked_up_at = NULL,
          delivery_arrived_at = NULL
      WHERE id = p_order_id;

    SELECT md.id INTO v_md_id
    FROM public.merchant_drivers md
    WHERE md.driver_id = p_driver_id
      AND md.merchant_id = v_order.merchant_id
      AND md.status = 'active'
    LIMIT 1;
    IF v_md_id IS NOT NULL THEN
      INSERT INTO public.driver_availability (merchant_driver_id, status, current_order_id)
        VALUES (v_md_id, 'busy', p_order_id)
        ON CONFLICT (merchant_driver_id)
        DO UPDATE SET status = 'busy', current_order_id = p_order_id;
    END IF;
    DELETE FROM public.express_declines
      WHERE order_id = p_order_id AND driver_id = p_driver_id;

  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_mode');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'merchant_id', v_order.merchant_id,
    'old_driver_id', v_old_driver,
    'order_number', v_order.order_number
  );
END;
$$;

-- =============================================================================
-- VÉRIF :
--   SELECT public.admin_reassign_delivery(
--     '00000000-0000-0000-0000-000000000000', 'pool');  -- forbidden hors admin
-- =============================================================================
