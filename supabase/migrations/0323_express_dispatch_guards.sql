-- =============================================================================
-- 0323 — Garde-fous dispatch EXPRESS (audit 04/07/2026, anomalies A2 + A3)
-- =============================================================================
-- A2 — Le plafond d'encours COD (`driver_can_accept`, mig 0103,
--   platform_settings.driver_float_cap_da) n'était appliqué NULLE PART : un
--   livreur pouvait accumuler un cash collecté non reversé illimité et
--   continuer à recevoir des courses. Correctif : les commandes ESPÈCES sont
--   filtrées du dispatch quand l'encours atteint le plafond. Les commandes EN
--   LIGNE (prépayées, zéro cash) restent attribuables : elles n'aggravent pas
--   le risque et génèrent des payouts qui RÉDUISENT l'encours au relevé.
--   Appliqué aux DEUX chemins d'attribution : `pull_next_express_nearby`
--   (réseau, actif) et `pull_next_express` (lié commerçant, legacy mais
--   toujours GRANTé → bypass possible sinon).
--
-- A3 — L'attribution « pull » posait `delivery_driver_id` immédiatement, sans
--   AUCUNE libération automatique si le livreur disparaissait sans décliner
--   (crash, batterie, mauvaise foi) : la commande restait gelée jusqu'à
--   `admin_reassign_delivery` (0107). Correctif :
--     • `orders.driver_claimed_at` : horodatage posé À CHAQUE prise (le
--       `driver_notified_at` existant n'est posé qu'à la PREMIÈRE prise —
--       COALESCE — donc inutilisable pour un timeout re-déclenchable).
--     • `release_stale_express_claims()` : libère les commandes attribuées
--       non récupérées depuis platform_settings.express_claim_timeout_min
--       (défaut 20 min ; 0 = désactivé). Le livreur fantôme reçoit un
--       `express_declines` (cooldown anti re-pull immédiat) et sa
--       disponibilité est libérée. Trace `order_events` (statut inchangé).
--     • Auto-guérison IN-BAND : appelée en tête de chaque pull (dès qu'un
--       livreur cherche une course, les commandes gelées redeviennent
--       attribuables — aucun cron requis pour le cas nominal) + filet
--       quotidien via /api/cron/expire-orders.
--
-- Bonus kill-switch (A6, flags posés en 0324) : le pull réseau vérifie
--   `feature_blocked('express')` — coupé = plus aucune attribution.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Colonne + réglage + index partiel (scan du watchdog quasi gratuit).
-- ----------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS driver_claimed_at TIMESTAMPTZ;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS express_claim_timeout_min INTEGER NOT NULL DEFAULT 20;

CREATE INDEX IF NOT EXISTS idx_orders_express_stale_claims
  ON public.orders (COALESCE(driver_claimed_at, driver_notified_at))
  WHERE delivery_mode = 'express'
    AND delivery_driver_id IS NOT NULL
    AND delivery_picked_up_at IS NULL
    AND status IN ('preparing', 'ready');

-- ----------------------------------------------------------------------------
-- 2. Libération des attributions abandonnées (A3).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_stale_express_claims()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_timeout INTEGER;
  v_count   INTEGER := 0;
  r         RECORD;
BEGIN
  SELECT express_claim_timeout_min INTO v_timeout
  FROM public.platform_settings WHERE id = true;
  IF COALESCE(v_timeout, 0) <= 0 THEN
    RETURN 0; -- politique désactivée
  END IF;

  FOR r IN
    SELECT o.id, o.delivery_driver_id, o.status
      FROM public.orders o
     WHERE o.delivery_mode = 'express'
       AND o.fulfillment_type = 'delivery'
       AND o.delivery_driver_id IS NOT NULL
       AND o.delivery_picked_up_at IS NULL
       AND o.status IN ('preparing', 'ready')
       AND COALESCE(o.driver_claimed_at, o.driver_notified_at)
             < now() - make_interval(mins => v_timeout)
       FOR UPDATE OF o SKIP LOCKED
  LOOP
    -- Cooldown pour le livreur fantôme : il ne re-pull pas la même commande
    -- dans la foulée (même mécanique qu'un refus explicite, mig 0056).
    INSERT INTO public.express_declines (order_id, driver_id)
    VALUES (r.id, r.delivery_driver_id)
    ON CONFLICT (order_id, driver_id) DO UPDATE SET declined_at = now();

    UPDATE public.orders
       SET delivery_driver_id = NULL,
           driver_claimed_at  = NULL
     WHERE id = r.id;

    UPDATE public.driver_availability
       SET status = 'available', current_order_id = NULL
     WHERE current_order_id = r.id;

    -- Trace honnête : le STATUT commande ne change pas, seul le porteur saute.
    INSERT INTO public.order_events (order_id, from_status, to_status, note)
    VALUES (r.id, r.status::public.order_status, r.status::public.order_status,
            'auto_release_stale_claim: livreur sans progression depuis '
              || v_timeout || ' min — commande remise en file');

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Appelée en interne (DEFINER) par les pulls + par le cron (service_role).
-- Jamais directement par un client.
REVOKE ALL ON FUNCTION public.release_stale_express_claims() FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.release_stale_express_claims() TO service_role;

-- ----------------------------------------------------------------------------
-- 3. Dispatch réseau (re-définition de 0182) :
--    + kill-switch express  + auto-guérison A3  + plafond COD A2
--    + driver_claimed_at posé à CHAQUE prise.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pull_next_express_nearby(
  p_lat numeric, p_lng numeric, p_radius_km numeric DEFAULT 6)
RETURNS TABLE(res_order_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_driver_id   UUID;
  v_zone_lat    NUMERIC;
  v_zone_lng    NUMERIC;
  v_zone_radius NUMERIC;
  v_cfg_radius  NUMERIC;
  v_ref_lat     NUMERIC;
  v_ref_lng     NUMERIC;
  v_radius      NUMERIC;
  v_can_cash    BOOLEAN;
  v_order       RECORD;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN; END IF;

  -- Kill-switch super-admin : service express coupé = aucune attribution.
  IF public.feature_blocked('express') THEN RETURN; END IF;

  -- Appelant = un livreur ni gelé NI bloqué (+ sa zone de travail perso).
  SELECT id, work_zone_lat, work_zone_lng, work_zone_radius_km
    INTO v_driver_id, v_zone_lat, v_zone_lng, v_zone_radius
  FROM public.drivers
  WHERE user_id = auth.uid()
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

  -- A2 : plafond d'encours COD (mig 0103, enfin appliqué). Au plafond, le
  -- livreur ne reçoit plus d'ESPÈCES ; l'online reste ouvert (zéro cash, et
  -- ses payouts réduisent l'encours au relevé).
  v_can_cash := public.driver_can_accept(v_driver_id);

  -- Rayon par défaut = réglage plateforme (A).
  SELECT COALESCE(express_dispatch_radius_km, 6) INTO v_cfg_radius
  FROM public.platform_settings WHERE id = true;

  -- (B) Zone perso prioritaire ; sinon position live + rayon configurable.
  IF v_zone_lat IS NOT NULL AND v_zone_lng IS NOT NULL
     AND COALESCE(v_zone_radius, 0) > 0 THEN
    v_ref_lat := v_zone_lat; v_ref_lng := v_zone_lng;
    v_radius  := GREATEST(0.5, LEAST(v_zone_radius, 50));
  ELSE
    v_ref_lat := p_lat; v_ref_lng := p_lng;
    v_radius  := GREATEST(0.5, LEAST(COALESCE(v_cfg_radius, 6), 50));
  END IF;

  SELECT o.id AS id,
         public.km_between(p_lat, p_lng, m.latitude, m.longitude) AS dist_km
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
    -- Filtre géo : zone perso si définie, sinon position live.
    AND public.km_between(v_ref_lat, v_ref_lng, m.latitude, m.longitude) <= v_radius
  ORDER BY dist_km ASC, o.created_at ASC
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
$$;

-- ----------------------------------------------------------------------------
-- 4. Dispatch legacy lié commerçant (re-définition de 0108) : mêmes gardes
--    A2 (plafond COD) + driver_claimed_at ; sinon identique.
-- ----------------------------------------------------------------------------
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
  v_can_cash       BOOLEAN;
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

  IF public.feature_blocked('express') THEN RETURN; END IF;

  PERFORM public.release_stale_express_claims();

  IF EXISTS (
    SELECT 1 FROM public.driver_availability
    WHERE merchant_driver_id = p_merchant_driver_id AND status = 'busy'
  ) THEN
    RETURN;
  END IF;

  -- A2 : plafond d'encours COD, même règle que le dispatch réseau.
  v_can_cash := public.driver_can_accept(v_driver_id);

  SELECT o.id INTO v_order_id
  FROM public.orders o
  WHERE o.merchant_id = v_merchant_id
    AND o.fulfillment_type = 'delivery'
    AND o.delivery_mode = 'express'
    AND o.delivery_driver_id IS NULL
    AND o.status IN ('preparing', 'ready')
    AND (o.payment_method <> 'cash' OR v_can_cash)
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
        driver_claimed_at  = now(),
        driver_notified_at = COALESCE(driver_notified_at, now())
    WHERE id = v_order_id;

  INSERT INTO public.driver_availability (merchant_driver_id, status, current_order_id)
    VALUES (p_merchant_driver_id, 'busy', v_order_id)
    ON CONFLICT (merchant_driver_id)
    DO UPDATE SET status = 'busy', current_order_id = v_order_id;

  RETURN QUERY SELECT v_order_id;
END;
$$;
