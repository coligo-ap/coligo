-- =============================================================================
-- 0048 — RPCs flux livreur : pickup explicite + reorder tour
-- =============================================================================
-- Avant ce patch :
--   - pull_next_express() écrivait `delivery_picked_up_at` à l'attribution,
--     mélangeant deux états distincts (attribué vs récupéré chez commerçant).
--     On veut deux étapes séparées dans l'UI livreur :
--       1) "J'ai récupéré la commande" (le livreur passe au commerçant)
--       2) "Marquer livré" (avec code de retrait)
--   - Aucune façon de re-optimiser une tournée en cours quand le livreur
--     est déjà à mi-chemin et que les conditions ont changé.
-- =============================================================================

-- 1) Fix pull_next_express : NE PLUS écrire delivery_picked_up_at.
--    L'attribution doit juste marquer delivery_driver_id ; le pickup est
--    un acte explicite du livreur.
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
  ORDER BY o.created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_order_id IS NULL THEN
    RETURN;
  END IF;

  -- Attribution seulement — PAS de pickup_at (le livreur le fera explicitement).
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

-- 2) Nouvel RPC : le livreur confirme avoir récupéré la commande chez le
--    commerçant. Marque delivery_picked_up_at = now() (idempotent).
CREATE OR REPLACE FUNCTION public.mark_delivery_picked_up(p_order_id UUID)
RETURNS TABLE(ok BOOLEAN, reason TEXT) AS $$
DECLARE
  v_driver_id UUID;
  v_order     public.orders%ROWTYPE;
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver_id IS NULL THEN
    ok := false; reason := 'not_a_driver'; RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    ok := false; reason := 'order_not_found'; RETURN NEXT; RETURN;
  END IF;
  IF v_order.fulfillment_type <> 'delivery' THEN
    ok := false; reason := 'not_a_delivery'; RETURN NEXT; RETURN;
  END IF;
  IF v_order.delivery_driver_id IS NULL OR v_order.delivery_driver_id <> v_driver_id THEN
    ok := false; reason := 'not_attributed_to_you'; RETURN NEXT; RETURN;
  END IF;
  IF v_order.status = 'completed' THEN
    ok := false; reason := 'already_delivered'; RETURN NEXT; RETURN;
  END IF;

  UPDATE public.orders
    SET delivery_picked_up_at = COALESCE(delivery_picked_up_at, now())
    WHERE id = p_order_id;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3) Bulk pickup pour une TOURNÉE : le livreur charge toutes les commandes
--    en attente d'un coup chez le commerçant.
CREATE OR REPLACE FUNCTION public.mark_tour_picked_up(p_tour_id UUID)
RETURNS TABLE(updated INTEGER) AS $$
DECLARE
  v_driver_id UUID;
  v_tour      public.delivery_tours%ROWTYPE;
  v_count     INTEGER;
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO v_tour FROM public.delivery_tours WHERE id = p_tour_id;
  IF v_tour.id IS NULL OR v_tour.driver_id <> v_driver_id THEN
    RAISE EXCEPTION 'tour_not_found_or_not_yours';
  END IF;

  -- Marque toutes les commandes du tour qui sont encore "pending" comme
  -- récupérées. Idempotent (COALESCE).
  UPDATE public.orders o
    SET delivery_picked_up_at = COALESCE(o.delivery_picked_up_at, now())
    FROM public.tour_stops s
    WHERE s.tour_id = p_tour_id
      AND s.order_id = o.id
      AND o.status NOT IN ('completed', 'cancelled');
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Met le tour en in_progress s'il était encore "planned".
  UPDATE public.delivery_tours
    SET status = 'in_progress',
        started_at = COALESCE(started_at, now())
    WHERE id = p_tour_id AND status = 'planned';

  RETURN QUERY SELECT v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4) Re-optimisation d'une tournée depuis une position de référence
--    (typiquement : position GPS courante du livreur). Recalcule stop_order
--    via nearest-neighbor côté SQL pour les stops encore PENDING.
--    Les stops déjà delivered/failed gardent leur stop_order (historique).
CREATE OR REPLACE FUNCTION public.reorder_tour_from(
  p_tour_id UUID,
  p_from_lat DOUBLE PRECISION,
  p_from_lng DOUBLE PRECISION
) RETURNS TABLE(reordered INTEGER) AS $$
DECLARE
  v_driver_id UUID;
  v_tour      public.delivery_tours%ROWTYPE;
  v_next_order INTEGER;
  v_picked_count INTEGER := 0;
  v_current_lat DOUBLE PRECISION := p_from_lat;
  v_current_lng DOUBLE PRECISION := p_from_lng;
  v_best record;
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT * INTO v_tour FROM public.delivery_tours WHERE id = p_tour_id;
  IF v_tour.id IS NULL OR v_tour.driver_id <> v_driver_id THEN
    RAISE EXCEPTION 'tour_not_found_or_not_yours';
  END IF;

  -- Position de départ pour le 1er stop pending = la position fournie.
  -- Les stops déjà delivered/failed gardent leur ordre original ; on ne
  -- recalcule QUE pour les pending. On commence la numérotation après le
  -- max(stop_order) des stops non-pending.
  SELECT COALESCE(MAX(stop_order), 0) + 1 INTO v_next_order
  FROM public.tour_stops
  WHERE tour_id = p_tour_id AND status <> 'pending';

  -- Boucle nearest-neighbor : à chaque itération, trouver le stop pending
  -- le plus proche de la position courante, lui assigner v_next_order, et
  -- avancer le curseur sur sa lat/lng.
  LOOP
    SELECT s.id, o.delivery_lat AS lat, o.delivery_lng AS lng
      INTO v_best
    FROM public.tour_stops s
    JOIN public.orders o ON o.id = s.order_id
    WHERE s.tour_id = p_tour_id
      AND s.status = 'pending'
      AND s.stop_order >= v_next_order  -- déjà ré-ordonné les précédents
      -- Distance Haversine simplifiée (équirectangulaire) — suffisante pour
      -- comparer des stops < 50 km.
    ORDER BY
      (o.delivery_lat - v_current_lat) * (o.delivery_lat - v_current_lat) +
      (o.delivery_lng - v_current_lng) * (o.delivery_lng - v_current_lng)
    LIMIT 1;

    EXIT WHEN v_best.id IS NULL;

    -- Met stop_order = v_next_order (en utilisant un offset temporaire
    -- négatif pour éviter le conflit UNIQUE(tour_id, stop_order) le temps
    -- de la réécriture — on remet positif en fin).
    UPDATE public.tour_stops
      SET stop_order = -v_next_order
      WHERE id = v_best.id;

    v_current_lat := v_best.lat;
    v_current_lng := v_best.lng;
    v_next_order := v_next_order + 1;
    v_picked_count := v_picked_count + 1;
  END LOOP;

  -- Remet positif.
  UPDATE public.tour_stops
    SET stop_order = -stop_order
    WHERE tour_id = p_tour_id AND stop_order < 0;

  RETURN QUERY SELECT v_picked_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.mark_delivery_picked_up(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_tour_picked_up(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_tour_from(UUID, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;
