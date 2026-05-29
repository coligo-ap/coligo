-- =============================================================================
-- 0056 — Refus d'une offre Express (release + cooldown)
-- =============================================================================
-- Le livreur peut REFUSER une commande Express qui vient de lui être attribuée
-- par le FIFO (écran « offre de course »), tant qu'il ne l'a pas encore
-- récupérée. La commande retourne alors en file pour les autres livreurs et le
-- livreur reste EN LIGNE — mais on trace le refus pour qu'il ne puisse pas
-- re-recevoir CETTE commande pendant 10 min (cooldown anti-boucle FIFO).
-- =============================================================================

-- 1) Journal des refus (1 ligne par (commande, livreur), horodatée).
CREATE TABLE IF NOT EXISTS public.express_declines (
  order_id    UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  driver_id   UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  declined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, driver_id)
);
CREATE INDEX IF NOT EXISTS idx_express_declines_lookup
  ON public.express_declines (driver_id, order_id, declined_at DESC);

ALTER TABLE public.express_declines ENABLE ROW LEVEL SECURITY;
-- Lecture de ses propres refus (les écritures passent par RPC SECURITY DEFINER).
DROP POLICY IF EXISTS "express_declines_own_read" ON public.express_declines;
CREATE POLICY "express_declines_own_read" ON public.express_declines
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = express_declines.driver_id AND d.user_id = auth.uid()
    )
  );

-- 2) RPC : refuser/libérer une commande Express attribuée (avant pickup).
CREATE OR REPLACE FUNCTION public.release_express_order(p_order_id UUID)
RETURNS TABLE(ok BOOLEAN, reason TEXT) AS $$
DECLARE
  v_driver_id UUID;
  v_order     public.orders%ROWTYPE;
  v_md_id     UUID;
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver_id IS NULL THEN
    ok := false; reason := 'not_a_driver'; RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    ok := false; reason := 'order_not_found'; RETURN NEXT; RETURN;
  END IF;
  IF v_order.delivery_driver_id IS NULL OR v_order.delivery_driver_id <> v_driver_id THEN
    ok := false; reason := 'not_attributed_to_you'; RETURN NEXT; RETURN;
  END IF;
  IF v_order.delivery_mode <> 'express' THEN
    ok := false; reason := 'not_express'; RETURN NEXT; RETURN;
  END IF;
  IF v_order.delivery_picked_up_at IS NOT NULL THEN
    ok := false; reason := 'already_picked_up'; RETURN NEXT; RETURN;
  END IF;
  IF v_order.status IN ('completed', 'cancelled') THEN
    ok := false; reason := 'order_closed'; RETURN NEXT; RETURN;
  END IF;

  -- Trace le refus (cooldown anti re-pull immédiat).
  INSERT INTO public.express_declines (order_id, driver_id)
    VALUES (p_order_id, v_driver_id)
    ON CONFLICT (order_id, driver_id) DO UPDATE SET declined_at = now();

  -- Libère la commande → retourne en file pour les autres livreurs.
  UPDATE public.orders
    SET delivery_driver_id = NULL
    WHERE id = p_order_id;

  -- Libère le livreur chez CE commerçant : la paire redevient « available ».
  SELECT md.id INTO v_md_id
  FROM public.merchant_drivers md
  WHERE md.driver_id = v_driver_id
    AND md.merchant_id = v_order.merchant_id
    AND md.status = 'active';

  IF v_md_id IS NOT NULL THEN
    UPDATE public.driver_availability
      SET status = 'available', current_order_id = NULL
      WHERE merchant_driver_id = v_md_id;
  END IF;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.release_express_order(UUID) TO authenticated;

-- 3) Patch pull_next_express : ignorer une commande refusée par CE livreur
--    pendant 10 minutes (cooldown). Le reste de la logique FIFO est inchangé
--    (cf. 0048).
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
    -- Cooldown : ne pas re-proposer une commande que CE livreur vient de refuser.
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
    SET delivery_driver_id = v_driver_id
    WHERE id = v_order_id;

  INSERT INTO public.driver_availability (merchant_driver_id, status, current_order_id)
    VALUES (p_merchant_driver_id, 'busy', v_order_id)
    ON CONFLICT (merchant_driver_id)
    DO UPDATE SET status = 'busy', current_order_id = v_order_id;

  RETURN QUERY SELECT v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
