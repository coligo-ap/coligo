-- =============================================================================
-- 0328 — No-show ONLINE « livré » : dépôt à l'adresse (leave-at-door) + support
-- =============================================================================
-- Modèle UberEats/Deliveroo pour une commande PRÉPAYÉE EN LIGNE dont le client
-- ne répond pas : la commande est traitée COMME LIVRÉE (statut No-Show), donc
-- livreur + commerçant payés comme une livraison normale et cashback accordé au
-- client (le client, ayant déjà tout payé, assume). Deux voies :
--
--  A) LIVREUR — dépôt à l'adresse (self-service, anti-fraude fort) :
--     préconditions séquencées, façon UberEats :
--       1. le livreur a TENTÉ d'appeler le client  (delivery_call_attempted_at) ;
--       2. le livreur a envoyé ≥1 message d'arrivée (order_messages courier) ;
--       3. le livreur est GÉO-CLÔTURÉ à quelques mètres de l'adresse exacte
--          (km_between ≤ noshow_geofence_m) AU MOMENT de démarrer l'attente
--          → `driver_confirm_arrival(lat,lng)` pose delivery_arrived_at (=départ
--          du minuteur) et notifie le client en temps réel ;
--       4. minuteur de noshow_wait_min minutes écoulé ;
--       5. `driver_leave_at_door(photo, note)` : dépose la commande, PHOTO de
--          preuve obligatoire + commentaire → commande 'completed' + marqueurs
--          No-Show + preuve partagée au client. Les triggers de complétion
--          paient livreur (express) / commerçant + cashback client.
--
--  B) SUPPORT — `admin_confirm_online_noshow` : le commerçant et/ou le livreur
--     signalent au support un client injoignable malgré un paiement en ligne ;
--     le super-admin CONFIRME → commande 'completed' + marqueurs No-Show (même
--     effet de paiement). Tracé dans admin_audit_log.
--
-- La géolocalisation live (client suit le livreur) EXISTE déjà : orders.
-- driver_live_* + update_driver_live_location (mig 0050) + carte client.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schéma : preuve de dépôt, tentative d'appel, géo-clôture. (Les marqueurs
--    delivery_no_show_at/kind sont créés en 0327.)
-- ----------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_call_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_geofence_ok       BOOLEAN,
  ADD COLUMN IF NOT EXISTS delivery_proof_url         TEXT,
  ADD COLUMN IF NOT EXISTS delivery_proof_note        TEXT;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS noshow_geofence_m INTEGER NOT NULL DEFAULT 150;

-- ----------------------------------------------------------------------------
-- 2. Storage : bucket public des preuves de dépôt. Lecture publique (le client
--    voit sa photo), écriture réservée aux livreurs authentifiés.
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('delivery-proofs', 'delivery-proofs', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "delivery_proofs_public_read" ON storage.objects;
CREATE POLICY "delivery_proofs_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'delivery-proofs');

DROP POLICY IF EXISTS "delivery_proofs_driver_insert" ON storage.objects;
CREATE POLICY "delivery_proofs_driver_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'delivery-proofs'
    AND EXISTS (SELECT 1 FROM public.drivers d WHERE d.user_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- 3. Le livreur a tenté d'appeler le client (précondition dépôt). Idempotent
--    (garde la 1re tentative). Le livreur attribué uniquement.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_note_call_attempt(p_order_id UUID)
RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id UUID;
  v_order     public.orders%ROWTYPE;
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver_id IS NULL THEN ok := false; reason := 'not_a_driver'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN ok := false; reason := 'order_not_found'; RETURN NEXT; RETURN; END IF;
  IF v_order.delivery_driver_id IS DISTINCT FROM v_driver_id THEN
    ok := false; reason := 'not_attributed_to_you'; RETURN NEXT; RETURN; END IF;

  UPDATE public.orders
     SET delivery_call_attempted_at = COALESCE(delivery_call_attempted_at, now())
   WHERE id = p_order_id;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_note_call_attempt(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Arrivée GÉO-CLÔTURÉE = départ du minuteur no-show. Anti-fraude : le
--    livreur doit être à quelques mètres de l'adresse exacte, avoir tenté
--    d'appeler et envoyé un message d'arrivée. Pose delivery_arrived_at (le
--    client voit « livreur arrivé » en temps réel). Idempotent.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_confirm_arrival(
  p_order_id UUID,
  p_lat      DOUBLE PRECISION,
  p_lng      DOUBLE PRECISION
) RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id UUID;
  v_order     public.orders%ROWTYPE;
  v_geo_m     INTEGER;
  v_dist_m    NUMERIC;
  v_has_msg   BOOLEAN;
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver_id IS NULL THEN ok := false; reason := 'not_a_driver'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN ok := false; reason := 'order_not_found'; RETURN NEXT; RETURN; END IF;
  IF v_order.delivery_driver_id IS DISTINCT FROM v_driver_id THEN
    ok := false; reason := 'not_attributed_to_you'; RETURN NEXT; RETURN; END IF;
  IF v_order.delivery_picked_up_at IS NULL
     OR v_order.delivery_delivered_at IS NOT NULL
     OR v_order.status IN ('completed', 'cancelled') THEN
    ok := false; reason := 'not_in_transit'; RETURN NEXT; RETURN; END IF;

  -- Idempotent : déjà arrivé → succès (minuteur déjà lancé).
  IF v_order.delivery_arrived_at IS NOT NULL THEN
    ok := true; reason := NULL; RETURN NEXT; RETURN;
  END IF;

  -- Précondition appel.
  IF v_order.delivery_call_attempted_at IS NULL THEN
    ok := false; reason := 'call_required'; RETURN NEXT; RETURN;
  END IF;

  -- Précondition message d'arrivée (au moins un message du livreur).
  SELECT EXISTS (
    SELECT 1 FROM public.order_messages m
     WHERE m.order_id = p_order_id AND m.sender_role = 'courier'
  ) INTO v_has_msg;
  IF NOT v_has_msg THEN
    ok := false; reason := 'message_required'; RETURN NEXT; RETURN;
  END IF;

  -- Géo-clôture : à quelques mètres de l'adresse exacte du client.
  SELECT COALESCE(noshow_geofence_m, 150) INTO v_geo_m
    FROM public.platform_settings WHERE id = true;

  IF v_order.delivery_lat IS NOT NULL AND v_order.delivery_lng IS NOT NULL
     AND p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    v_dist_m := public.km_between(p_lat, p_lng, v_order.delivery_lat, v_order.delivery_lng) * 1000.0;
    IF v_dist_m > v_geo_m THEN
      ok := false; reason := 'too_far'; RETURN NEXT; RETURN;
    END IF;
  ELSE
    -- Pas de coordonnées exactes (rare) : on ne peut pas géo-clôturer → refus
    -- pour éviter tout abus. Le livreur passe par le support.
    ok := false; reason := 'no_location'; RETURN NEXT; RETURN;
  END IF;

  UPDATE public.orders
     SET delivery_arrived_at  = now(),
         delivery_geofence_ok = true,
         driver_live_lat = p_lat, driver_live_lng = p_lng, driver_live_at = now()
   WHERE id = p_order_id;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_confirm_arrival(UUID, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Dépôt à l'adresse (ONLINE prépayé) : commande livrée « No-Show » avec
--    preuve. Le passage à 'completed' déclenche les triggers de complétion →
--    paiement livreur (express) / commerçant + cashback client, comme une
--    livraison normale. Express ET tournée.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_leave_at_door(
  p_order_id UUID,
  p_photo_url TEXT,
  p_note      TEXT DEFAULT NULL,
  p_client_operation_id TEXT DEFAULT NULL
) RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id UUID;
  v_order     public.orders%ROWTYPE;
  v_wait      INTEGER;
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver_id IS NULL THEN ok := false; reason := 'not_a_driver'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN ok := false; reason := 'order_not_found'; RETURN NEXT; RETURN; END IF;
  IF v_order.delivery_driver_id IS DISTINCT FROM v_driver_id THEN
    ok := false; reason := 'not_attributed_to_you'; RETURN NEXT; RETURN; END IF;
  IF v_order.status = 'completed' THEN
    ok := true; reason := 'already_delivered'; RETURN NEXT; RETURN; END IF;
  IF v_order.status = 'cancelled' THEN
    ok := false; reason := 'already_closed'; RETURN NEXT; RETURN; END IF;

  -- Dépôt réservé au PRÉPAYÉ EN LIGNE (le client a déjà tout payé). En espèces
  -- le livreur repart avec la commande (chemin driver_report_no_show).
  IF v_order.payment_method <> 'online' OR v_order.payment_status <> 'paid' THEN
    ok := false; reason := 'cash_not_allowed'; RETURN NEXT; RETURN;
  END IF;

  IF v_order.delivery_picked_up_at IS NULL THEN
    ok := false; reason := 'not_picked_up'; RETURN NEXT; RETURN; END IF;
  IF v_order.delivery_arrived_at IS NULL THEN
    ok := false; reason := 'not_arrived'; RETURN NEXT; RETURN; END IF;
  IF p_photo_url IS NULL OR btrim(p_photo_url) = '' THEN
    ok := false; reason := 'photo_required'; RETURN NEXT; RETURN; END IF;

  -- Minuteur écoulé depuis l'arrivée géo-clôturée.
  SELECT GREATEST(1, COALESCE(noshow_wait_min, 8)) INTO v_wait
    FROM public.platform_settings WHERE id = true;
  IF now() < v_order.delivery_arrived_at + make_interval(mins => v_wait) THEN
    ok := false; reason := 'too_early'; RETURN NEXT; RETURN;
  END IF;

  UPDATE public.orders
     SET status                = 'completed',
         delivery_delivered_at = now(),
         delivery_no_show_at   = now(),
         delivery_no_show_kind = 'left_at_door',
         delivery_proof_url    = p_photo_url,
         delivery_proof_note   = NULLIF(btrim(COALESCE(p_note, '')), '')
   WHERE id = p_order_id;

  UPDATE public.tour_stops
     SET status = 'delivered', delivered_at = now()
   WHERE order_id = p_order_id AND status = 'pending';

  INSERT INTO public.order_events (order_id, from_status, to_status, client_operation_id, note)
  VALUES (p_order_id, v_order.status, 'completed', NULL,
          'leave_at_door_no_show:' || COALESCE(p_client_operation_id, ''))
  ON CONFLICT DO NOTHING;

  IF v_order.delivery_mode = 'express' THEN
    UPDATE public.driver_availability
       SET status = 'available', current_order_id = NULL
     WHERE current_order_id = p_order_id;
  END IF;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_leave_at_door(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Support / super-admin : confirmer un no-show d'une commande EN LIGNE →
--    payée comme livrée (statut No-Show). Voie « le commerçant/livreur a
--    contacté le support ». service_role uniquement (back-office admin).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_confirm_online_noshow(
  p_order_id    UUID,
  p_admin_email TEXT DEFAULT NULL,
  p_note        TEXT DEFAULT NULL
) RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN ok := false; reason := 'order_not_found'; RETURN NEXT; RETURN; END IF;
  IF v_order.fulfillment_type <> 'delivery' THEN
    ok := false; reason := 'not_a_delivery'; RETURN NEXT; RETURN; END IF;
  IF v_order.payment_method <> 'online' OR v_order.payment_status <> 'paid' THEN
    ok := false; reason := 'not_online_paid'; RETURN NEXT; RETURN; END IF;
  IF v_order.status = 'completed' THEN
    ok := true; reason := 'already_completed'; RETURN NEXT; RETURN; END IF;
  IF v_order.status = 'cancelled' THEN
    ok := false; reason := 'already_cancelled'; RETURN NEXT; RETURN; END IF;
  IF v_order.delivery_driver_id IS NULL THEN
    ok := false; reason := 'no_driver'; RETURN NEXT; RETURN; END IF;

  UPDATE public.orders
     SET status                = 'completed',
         delivery_delivered_at = COALESCE(delivery_delivered_at, now()),
         delivery_no_show_at   = now(),
         delivery_no_show_kind = 'support_confirmed'
   WHERE id = p_order_id;

  UPDATE public.tour_stops
     SET status = 'delivered', delivered_at = now()
   WHERE order_id = p_order_id AND status = 'pending';

  INSERT INTO public.order_events (order_id, from_status, to_status, note)
  VALUES (p_order_id, v_order.status, 'completed',
          'admin_confirm_online_noshow' || COALESCE(' — ' || p_note, ''))
  ON CONFLICT DO NOTHING;

  IF v_order.delivery_mode = 'express' THEN
    UPDATE public.driver_availability
       SET status = 'available', current_order_id = NULL
     WHERE current_order_id = p_order_id;
  END IF;

  INSERT INTO public.admin_audit_log (admin_email, action, target_kind, target_id, note)
  VALUES (p_admin_email, 'confirm_online_noshow', 'order', p_order_id,
          'No-show en ligne confirmé — payé comme livré.' || COALESCE(' ' || p_note, ''));

  ok := true; reason := NULL; RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_confirm_online_noshow(UUID, TEXT, TEXT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_confirm_online_noshow(UUID, TEXT, TEXT) TO service_role;
