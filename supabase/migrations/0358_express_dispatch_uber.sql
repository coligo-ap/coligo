-- =============================================================================
-- 0358 — Dispatch EXPRESS v2 « façon Uber » (demande produit du 11/07/2026)
-- =============================================================================
-- Trois évolutions du canal de proposition, SANS changement d'API côté app
-- (les livreurs continuent d'appeler pull_next_express_nearby) :
--
-- 1. RE-OFFRE ADAPTATIVE (« insister ») — avant : un refus immunisait le
--    livreur 10 min, même si PERSONNE d'autre n'acceptait la commande.
--    Maintenant : si la commande est AFFAMÉE (dispatchable depuis ≥ 6 min et
--    toujours sans livreur), le cooldown de refus tombe à 2 min → la commande
--    REVIENT vers les livreurs qui l'ont refusée, comme Uber ré-insiste,
--    plutôt que de laisser le client attendre.
--
-- 2. VAGUES DE PROXIMITÉ + FIABILITÉ — avant : premier livreur qui « pull »
--    gagne, quelle que soit sa distance ou son historique.
--    Maintenant :
--      • la commande n'est d'abord visible qu'aux livreurs PROCHES (2 km),
--        puis le rayon s'élargit de ~1,5 km/min jusqu'au rayon max — les plus
--        proches ont une longueur d'avance (vagues Uber) ;
--      • les FAIBLES ACCEPTEURS (taux d'acceptation 30 j < 40 %, avec au
--        moins 8 décisions — les nouveaux livreurs ont le bénéfice du doute)
--        ne voient la commande qu'à partir de 2 min : les livreurs qui
--        acceptent beaucoup sont servis d'abord ;
--      • les commandes AFFAMÉES passent EN TÊTE du tri (le client le plus en
--        attente est prioritaire), puis proximité.
--
-- 3. admin_requeue_cancelled_delivery — le super-admin peut REMETTRE AU CANAL
--    une livraison ANNULÉE (non livrée, non remboursée) : la commande
--    redevient 'ready', l'attribution et les refus sont purgés (fresh start),
--    et le FIFO la re-propose immédiatement au réseau.
--
-- Sécurité inchangée : kill-switch, vérifié/gelé/bloqué, plafond COD (A2),
-- watchdog claims (A3), blocages commerçant, zone de travail. Ce fichier ne
-- fait qu'AFFINER la sélection.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1+2. pull_next_express_nearby v3 — re-offre adaptative + vagues.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pull_next_express_nearby(
  p_lat numeric, p_lng numeric, p_radius_km numeric DEFAULT 6
)
 RETURNS TABLE(res_order_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_driver_id     UUID;
  v_zone_lat      NUMERIC;
  v_zone_lng      NUMERIC;
  v_zone_radius   NUMERIC;
  v_cfg_radius    NUMERIC;
  v_ref_lat       NUMERIC;
  v_ref_lng       NUMERIC;
  v_radius        NUMERIC;
  v_can_cash      BOOLEAN;
  v_order         RECORD;
  v_declines_30d  INTEGER;
  v_delivered_30d INTEGER;
  v_low_acceptor  BOOLEAN;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN; END IF;

  -- Kill-switch super-admin : service express coupé = aucune attribution.
  IF public.feature_blocked('express') THEN RETURN; END IF;

  -- Appelant = un livreur VÉRIFIÉ, ni gelé NI bloqué (+ sa zone de travail perso).
  SELECT id, work_zone_lat, work_zone_lng, work_zone_radius_km
    INTO v_driver_id, v_zone_lat, v_zone_lng, v_zone_radius
  FROM public.drivers
  WHERE user_id = auth.uid()
    AND COALESCE(is_verified, false) = true
    AND COALESCE(is_frozen, false) = false
    AND COALESCE(is_blocked, false) = false;
  IF v_driver_id IS NULL THEN RETURN; END IF;

  -- A3 : auto-guérison — les commandes gelées par un livreur disparu
  -- redeviennent attribuables au moment exact où quelqu'un cherche une course.
  PERFORM public.release_stale_express_claims();

  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.delivery_driver_id = v_driver_id
      AND o.status NOT IN ('completed', 'cancelled')
      AND o.delivery_delivered_at IS NULL
  ) THEN
    RETURN;
  END IF;

  -- A2 : plafond d'encours COD (mig 0103). Au plafond, le livreur ne reçoit
  -- plus d'ESPÈCES ; l'online reste ouvert.
  v_can_cash := public.driver_can_accept(v_driver_id);

  -- FIABILITÉ 30 j : taux d'acceptation = livraisons / (livraisons + refus).
  -- « Faible accepteur » = < 40 % avec ≥ 8 décisions (les nouveaux livreurs,
  -- peu de données, gardent le bénéfice du doute → vague 1).
  SELECT count(*) INTO v_declines_30d
  FROM public.express_declines
  WHERE driver_id = v_driver_id AND declined_at > now() - interval '30 days';
  SELECT count(*) INTO v_delivered_30d
  FROM public.orders
  WHERE delivery_driver_id = v_driver_id
    AND delivery_delivered_at > now() - interval '30 days';
  v_low_acceptor :=
    (v_declines_30d + v_delivered_30d) >= 8
    AND v_delivered_30d::numeric
        / GREATEST(v_declines_30d + v_delivered_30d, 1) < 0.40;

  SELECT COALESCE(express_dispatch_radius_km, 6) INTO v_cfg_radius
  FROM public.platform_settings WHERE id = true;

  IF v_zone_lat IS NOT NULL AND v_zone_lng IS NOT NULL
     AND COALESCE(v_zone_radius, 0) > 0 THEN
    v_ref_lat := v_zone_lat; v_ref_lng := v_zone_lng;
    v_radius  := GREATEST(0.5, LEAST(v_zone_radius, 50));
  ELSE
    v_ref_lat := p_lat; v_ref_lng := p_lng;
    v_radius  := GREATEST(0.5, LEAST(COALESCE(v_cfg_radius, 6), 50));
  END IF;

  SELECT o.id AS id,
         public.km_between(p_lat, p_lng, m.latitude, m.longitude) AS dist_km,
         -- Âge « dispatchable » de la commande (base des vagues + starvation).
         GREATEST(
           0,
           extract(epoch FROM (
             now() - COALESCE(o.marked_ready_at, o.prep_notif_at, o.created_at)
           )) / 60.0
         ) AS age_min
    INTO v_order
  FROM public.orders o
  JOIN public.merchants m ON m.id = o.merchant_id
  WHERE o.fulfillment_type = 'delivery'
    AND o.delivery_mode = 'express'
    AND o.delivery_driver_id IS NULL
    AND o.status IN ('preparing', 'ready')
    AND m.express_enabled = true
    AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
    AND (o.payment_method <> 'cash' OR v_can_cash)
    AND (
      o.prep_notif_at IS NULL
      OR o.marked_ready_at IS NOT NULL
      OR o.status = 'ready'
      OR o.prep_notif_at <= now()
    )
    -- RE-OFFRE ADAPTATIVE : un refus immunise 10 min en temps normal, mais
    -- seulement 2 min si la commande est AFFAMÉE (≥ 6 min sans preneur) → la
    -- commande revient « insister » auprès des refusants plutôt que d'attendre.
    AND NOT EXISTS (
      SELECT 1 FROM public.express_declines ed
      WHERE ed.order_id = o.id
        AND ed.driver_id = v_driver_id
        AND ed.declined_at > now() - make_interval(mins =>
          CASE
            WHEN COALESCE(o.marked_ready_at, o.prep_notif_at, o.created_at)
                 <= now() - interval '6 minutes'
            THEN 2 ELSE 10
          END)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.merchant_drivers md
      WHERE md.merchant_id = o.merchant_id
        AND md.driver_id = v_driver_id
        AND md.status = 'blocked'
    )
    AND public.km_between(v_ref_lat, v_ref_lng, m.latitude, m.longitude) <= v_radius
    -- VAGUE FIABILITÉ : les faibles accepteurs ne voient la commande qu'à
    -- partir de 2 min — les livreurs qui acceptent beaucoup sont servis d'abord.
    AND (
      NOT v_low_acceptor
      OR COALESCE(o.marked_ready_at, o.prep_notif_at, o.created_at)
         <= now() - interval '2 minutes'
    )
    -- VAGUE PROXIMITÉ : visible d'abord à 2 km du livreur (position RÉELLE),
    -- puis +1,5 km/min jusqu'au rayon max — les plus proches d'abord.
    AND public.km_between(p_lat, p_lng, m.latitude, m.longitude) <=
        LEAST(
          v_radius,
          2 + GREATEST(
            0,
            extract(epoch FROM (
              now() - COALESCE(o.marked_ready_at, o.prep_notif_at, o.created_at)
            )) / 60.0
          ) * 1.5
        )
  -- Tri : commandes AFFAMÉES d'abord (client le plus en attente), puis le plus
  -- PROCHE, puis FIFO. Le client est livré le plus vite possible.
  ORDER BY
    (COALESCE(o.marked_ready_at, o.prep_notif_at, o.created_at)
       <= now() - interval '6 minutes') DESC,
    dist_km ASC,
    o.created_at ASC
  FOR UPDATE OF o SKIP LOCKED
  LIMIT 1;

  IF v_order.id IS NULL THEN RETURN; END IF;

  UPDATE public.orders
    SET delivery_driver_id = v_driver_id,
        driver_claimed_at  = now(),
        driver_notified_at = COALESCE(driver_notified_at, now())
    WHERE id = v_order.id;

  res_order_id := v_order.id;
  RETURN NEXT;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. Remise au canal d'une livraison ANNULÉE (super-admin).
-- ----------------------------------------------------------------------------
-- Sûre : aucune écriture financière n'existe avant la livraison validée
-- (trigger sur delivered/completed) ; on refuse si la commande a été livrée ou
-- si un remboursement manuel a déjà été émis (admin_refunded_da > 0).
CREATE OR REPLACE FUNCTION public.admin_requeue_cancelled_delivery(
  p_order_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
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
  IF v_order.status <> 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_cancelled');
  END IF;
  IF v_order.delivery_delivered_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_delivered');
  END IF;
  IF COALESCE(v_order.admin_refunded_da, 0) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_refunded');
  END IF;

  UPDATE public.orders
    SET status                = 'ready',
        cancelled_by          = NULL,
        delivery_driver_id    = NULL,
        driver_claimed_at     = NULL,
        driver_notified_at    = NULL,
        delivery_picked_up_at = NULL,
        delivery_arrived_at   = NULL
    WHERE id = p_order_id;

  -- Fresh start : la commande repart au canal SANS mémoire des refus (tous
  -- les livreurs, y compris ceux qui avaient refusé, la revoient tout de suite).
  DELETE FROM public.express_declines WHERE order_id = p_order_id;

  INSERT INTO public.order_events (order_id, from_status, to_status, note)
  VALUES (
    p_order_id, 'cancelled', 'ready',
    'admin_requeue: remise au canal de proposition'
      || COALESCE(' — ' || NULLIF(trim(p_reason), ''), '')
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Pattern grants du projet (cf. 0338) : REVOKE PUBLIC/anon, GRANT authenticated
-- (le garde is_super_admin() DANS la fonction fait autorité).
REVOKE ALL ON FUNCTION public.admin_requeue_cancelled_delivery(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_requeue_cancelled_delivery(uuid, text)
  TO authenticated;
