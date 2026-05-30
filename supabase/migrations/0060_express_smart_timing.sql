-- =============================================================================
-- 0060 — Express : timing intelligent (notifier le livreur PILE au bon moment)
-- =============================================================================
-- Au lieu de rendre une commande Express attribuable dès qu'elle passe en
-- `preparing` (livreur arrive trop tôt et attend), on calcule un `prep_notif_at`
--   T_notif = T_preparing + max(1 min, prep_time - estimated_pickup_minutes)
-- et `pull_next_express` n'attribue la commande qu'à partir de ce moment — sauf
-- si le commerçant l'a marquée « prête » (marked_ready_at) → attribution
-- immédiate. Backward-compat : commandes sans prep_notif_at = attribuables tout
-- de suite (comportement d'avant).
--
-- estimated_pickup_minutes : on ne traque pas la position GPS des livreurs au
-- repos (seulement pendant une livraison active). On utilise donc l'estimation
-- par défaut de 3 min (cf. PARTIE A : « si aucun livreur dispo, défaut 3 min »).
-- Le paramètre plateforme pickup_avg_speed_kmh est conservé pour un futur calcul
-- par distance si on stocke la position des livreurs au repos.
-- =============================================================================

-- 1. Paramètres plateforme (singleton)
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS default_prep_time_minutes INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS min_prep_time_minutes     INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS max_prep_time_minutes     INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS pickup_avg_speed_kmh      NUMERIC NOT NULL DEFAULT 25;

-- 2. Colonnes de timing sur orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS prep_started_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prep_estimated_ready_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prep_notif_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marked_ready_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS driver_notified_at     TIMESTAMPTZ;

-- merchants.prep_time_min existe déjà (défaut 10) → réutilisé tel quel.

-- 3. Trigger : calcule le timing au passage en `preparing` (1 seule fois),
--    et stampille marked_ready_at au passage en `ready`.
CREATE OR REPLACE FUNCTION public.set_express_prep_timing()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_prep    INTEGER;
  v_default INTEGER;
  v_min     INTEGER;
  v_max     INTEGER;
  v_pickup  INTEGER := 3; -- estimation trajet livreur par défaut (min)
BEGIN
  -- Marqueur « prêt » (accélérateur) au passage en ready.
  IF NEW.status = 'ready' AND NEW.marked_ready_at IS NULL THEN
    NEW.marked_ready_at := now();
  END IF;

  -- Timing calculé UNE fois, au passage en preparing d'une commande Express.
  IF NEW.delivery_mode = 'express'
     AND NEW.status = 'preparing'
     AND NEW.prep_started_at IS NULL THEN

    SELECT default_prep_time_minutes, min_prep_time_minutes, max_prep_time_minutes
      INTO v_default, v_min, v_max
    FROM public.platform_settings LIMIT 1;
    v_default := COALESCE(v_default, 10);
    v_min := COALESCE(v_min, 5);
    v_max := COALESCE(v_max, 30);

    SELECT prep_time_min INTO v_prep FROM public.merchants WHERE id = NEW.merchant_id;
    v_prep := LEAST(GREATEST(COALESCE(v_prep, v_default), v_min), v_max);

    NEW.prep_started_at := now();
    NEW.prep_estimated_ready_at := now() + make_interval(mins => v_prep);
    NEW.prep_notif_at := now() + make_interval(mins => GREATEST(1, v_prep - v_pickup));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_set_express_prep_timing ON public.orders;
CREATE TRIGGER trigger_set_express_prep_timing
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_express_prep_timing();

-- 4. Gate FIFO : pull_next_express ne propose une commande qu'à partir de son
--    prep_notif_at (ou si marquée prête / ready / legacy null). On stampille
--    driver_notified_at à l'attribution. Reste du FIFO inchangé (cf. 0056).
CREATE OR REPLACE FUNCTION public.pull_next_express(p_merchant_driver_id UUID)
RETURNS TABLE(order_id UUID) AS $$
DECLARE
  v_driver_user_id UUID;
  v_merchant_id    UUID;
  v_driver_id      UUID;
  v_order_id       UUID;
BEGIN
  SELECT d.user_id, md.merchant_id, md.driver_id
    INTO v_driver_user_id, v_merchant_id, v_driver_id
  FROM public.merchant_drivers md
  JOIN public.drivers d ON d.id = md.driver_id
  WHERE md.id = p_merchant_driver_id
    AND md.status = 'active';

  IF v_driver_user_id IS NULL OR v_driver_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'unauthorized';
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
    -- Timing intelligent : pas avant prep_notif_at, sauf si prête / ready /
    -- legacy (prep_notif_at NULL = ancienne commande, attribuable direct).
    AND (
      o.prep_notif_at IS NULL
      OR o.marked_ready_at IS NOT NULL
      OR o.status = 'ready'
      OR o.prep_notif_at <= now()
    )
    -- Cooldown refus (cf. 0056).
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
