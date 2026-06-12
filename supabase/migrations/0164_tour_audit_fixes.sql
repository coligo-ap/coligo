-- =============================================================================
-- 0164 — Audit module TOURNÉE : correctifs sécurité + comptabilité + flux
-- =============================================================================
-- Constats corrigés :
--   1. startTour (server action) faisait `UPDATE orders SET delivery_driver_id`
--      avec le client AUTHENTIFIÉ du livreur → aucune policy UPDATE livreur sur
--      orders → 0 ligne mise à jour SILENCIEUSEMENT → validate_delivery répondait
--      `not_attributed_to_you` : la tournée était inutilisable en prod (le test
--      e2e masquait le bug en répliquant l'UPDATE via la connexion postgres).
--      → RPC SECURITY DEFINER `start_tour` atomique ci-dessous.
--   2. Deux livreurs actifs du même commerçant pouvaient démarrer chacun une
--      tournée sur le MÊME créneau (la vérif d'existence était par-livreur) et
--      se voler les commandes. → verrou slot + claim ligne à ligne
--      (delivery_driver_id IS NULL) + exclusion des commandes déjà dans une
--      tournée active.
--   3. Capacité créneau : le count au checkout tournait sous RLS CLIENT (ne
--      voyait que les commandes du client lui-même) → max_orders jamais
--      vraiment appliqué + race condition. → trigger DB + RPC compteur.
--   4. No-show tournée ONLINE PAYÉ : driver_payout versé au livreur tournée
--      alors que le commerçant reçoit déjà delivery_revenue (D) — la plateforme
--      payait ~92 % de D de sa poche. Le livreur tournée est payé HORS
--      plateforme par son commerçant. → payout express-only.
--   5. No-show tournée : snapshots driver_fee_da/driver_net_da (concepts
--      express) écrits sur la commande → polluaient relevés/stats. → express-only.
--   6. No-show tournée : le tour_stop restait 'pending' pour toujours (tournée
--      jamais terminable, réoptimisation routait encore vers la commande
--      annulée). → stop marqué 'failed'.
--   7. No-show tournée CASH : la pénalité (D) récupérée sur le solde client
--      restait à la plateforme alors que le coût de la course est supporté par
--      le commerçant (son livreur, son carburant). → reversée au wallet
--      commerçant ('adjustment').
--   8. Plafond cashback COD : pour une tournée cash, le plafond « montants à
--      reverser » comptait D ENTIER alors que le commerçant ne reverse que la
--      commission tournée (8 % de D) → la plateforme pouvait accorder plus de
--      cashback qu'elle n'encaisse. → composante livraison du plafond =
--      tour_comm en tournée (les DEUX fonctions, parité crédit == charge).
--   9. grant_customer_cashback n'avait pas le garde delivery_failed_at (ajouté
--      au trigger wallet en 0160) → garde aligné.
--  10. reorder_tour_from : les stops pending avec stop_order < max(non-pending)
--      n'étaient jamais réordonnés (filtre >= v_next_order). → filtre > 0.
--  11. Rien ne passait delivery_tours à 'completed' → trigger de clôture quand
--      plus aucun stop 'pending'.
--  12. Les commandes sans GPS étaient silencieusement exclues de la tournée
--      (jamais livrées) ; les commandes online NON PAYÉES étaient embarquables
--      (gating 0068 contourné). → incluses en fin d'itinéraire / exclues.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. start_tour — création de tournée atomique côté SQL (remplace la logique
--    de la server action, qui ne pouvait pas attribuer les commandes).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_tour(
  p_merchant_driver_id UUID,
  p_slot_id            UUID
) RETURNS TABLE(ok BOOLEAN, reason TEXT, tour_id UUID, stops_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user        UUID := auth.uid();
  v_link        public.merchant_drivers%ROWTYPE;
  v_driver_user UUID;
  v_slot        public.delivery_slots%ROWTYPE;
  v_lat         DOUBLE PRECISION;
  v_lng         DOUBLE PRECISION;
  v_existing_id UUID;
  v_tour_id     UUID;
  v_next        INTEGER := 1;
  v_count       INTEGER := 0;
  v_best        RECORD;
BEGIN
  -- Lien livreur↔commerçant ACTIF et appartenant à l'appelant (vérif explicite,
  -- on ne s'appuie plus sur le RLS implicite).
  SELECT * INTO v_link FROM public.merchant_drivers WHERE id = p_merchant_driver_id;
  IF v_link.id IS NULL OR v_link.status <> 'active' THEN
    ok := false; reason := 'link_not_active'; RETURN NEXT; RETURN;
  END IF;
  SELECT d.user_id INTO v_driver_user FROM public.drivers d WHERE d.id = v_link.driver_id;
  IF v_user IS NULL OR v_driver_user IS DISTINCT FROM v_user THEN
    ok := false; reason := 'unauthorized'; RETURN NEXT; RETURN;
  END IF;

  -- Verrou du créneau : sérialise deux start_tour concurrents sur le même slot.
  SELECT * INTO v_slot FROM public.delivery_slots WHERE id = p_slot_id FOR UPDATE;
  IF v_slot.id IS NULL OR v_slot.merchant_id <> v_link.merchant_id THEN
    ok := false; reason := 'slot_not_found'; RETURN NEXT; RETURN;
  END IF;
  IF v_slot.status = 'cancelled' THEN
    ok := false; reason := 'slot_cancelled'; RETURN NEXT; RETURN;
  END IF;

  SELECT m.latitude, m.longitude INTO v_lat, v_lng
  FROM public.merchants m WHERE m.id = v_link.merchant_id;
  IF v_lat IS NULL OR v_lng IS NULL THEN
    ok := false; reason := 'merchant_position_missing'; RETURN NEXT; RETURN;
  END IF;

  -- Idempotent : une tournée non annulée de CE livreur sur ce slot → on la rend.
  SELECT t.id INTO v_existing_id
  FROM public.delivery_tours t
  WHERE t.slot_id = p_slot_id AND t.driver_id = v_link.driver_id
    AND t.status <> 'cancelled'
  LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    SELECT count(*)::INTEGER INTO v_count FROM public.tour_stops s WHERE s.tour_id = v_existing_id;
    ok := true; reason := 'already_started'; tour_id := v_existing_id; stops_count := v_count;
    RETURN NEXT; RETURN;
  END IF;

  INSERT INTO public.delivery_tours (merchant_id, driver_id, slot_id, status, started_at)
  VALUES (v_link.merchant_id, v_link.driver_id, p_slot_id, 'in_progress', now())
  RETURNING id INTO v_tour_id;

  -- Claim nearest-neighbor : à chaque itération on verrouille (SKIP LOCKED) la
  -- commande NON ATTRIBUÉE la plus proche, on l'attribue, on avance le curseur.
  -- Les commandes sans GPS passent en fin d'itinéraire (CASE) au lieu d'être
  -- silencieusement abandonnées. Les online non payées sont exclues (gating 0068).
  LOOP
    SELECT o.id, o.delivery_lat AS lat, o.delivery_lng AS lng
      INTO v_best
    FROM public.orders o
    WHERE o.delivery_slot_id = p_slot_id
      AND o.fulfillment_type = 'delivery'
      AND o.delivery_mode = 'tour'
      AND o.status NOT IN ('completed', 'cancelled')
      AND (o.payment_method <> 'online' OR o.payment_status = 'paid')
      AND (o.delivery_driver_id IS NULL OR o.delivery_driver_id = v_link.driver_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.tour_stops s
        JOIN public.delivery_tours t ON t.id = s.tour_id
        WHERE s.order_id = o.id AND t.status IN ('planned', 'in_progress')
      )
    ORDER BY
      CASE WHEN o.delivery_lat IS NULL OR o.delivery_lng IS NULL THEN 1 ELSE 0 END,
      (o.delivery_lat - v_lat) * (o.delivery_lat - v_lat) +
      (o.delivery_lng - v_lng) * (o.delivery_lng - v_lng)
    LIMIT 1
    FOR UPDATE OF o SKIP LOCKED;

    EXIT WHEN v_best.id IS NULL;

    INSERT INTO public.tour_stops (tour_id, order_id, stop_order)
    VALUES (v_tour_id, v_best.id, v_next);

    UPDATE public.orders SET delivery_driver_id = v_link.driver_id WHERE id = v_best.id;

    IF v_best.lat IS NOT NULL AND v_best.lng IS NOT NULL THEN
      v_lat := v_best.lat; v_lng := v_best.lng;
    END IF;
    v_next  := v_next + 1;
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    DELETE FROM public.delivery_tours WHERE id = v_tour_id;
    ok := false; reason := 'no_orders'; RETURN NEXT; RETURN;
  END IF;

  ok := true; reason := NULL; tour_id := v_tour_id; stops_count := v_count;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_tour(UUID, UUID) TO authenticated;

-- Le client livreur n'écrit plus jamais delivery_tours/tour_stops directement
-- (tout passe par start_tour / reorder_tour_from / validate_delivery, SECURITY
-- DEFINER) → on restreint ses policies à la LECTURE. Évite aussi qu'un livreur
-- marque un stop 'delivered' sans passer par la validation.
DROP POLICY IF EXISTS "delivery_tours_driver" ON public.delivery_tours;
CREATE POLICY "delivery_tours_driver"
  ON public.delivery_tours FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = delivery_tours.driver_id AND d.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tour_stops_driver" ON public.tour_stops;
CREATE POLICY "tour_stops_driver"
  ON public.tour_stops FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.delivery_tours t
      JOIN public.drivers d ON d.id = t.driver_id
      WHERE t.id = tour_stops.tour_id AND d.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Capacité créneau : compteur fiable (le count RLS-client du checkout ne
--    voyait que les commandes du client) + garde-fou ATOMIQUE à l'INSERT.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.slot_orders_count(p_slot_id UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::INTEGER
  FROM public.orders
  WHERE delivery_slot_id = p_slot_id AND status <> 'cancelled';
$$;

GRANT EXECUTE ON FUNCTION public.slot_orders_count(UUID) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.enforce_slot_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slot public.delivery_slots%ROWTYPE;
  v_n    INTEGER;
BEGIN
  -- Verrou du slot : deux checkouts concurrents se sérialisent ici.
  SELECT * INTO v_slot FROM public.delivery_slots WHERE id = NEW.delivery_slot_id FOR UPDATE;
  IF v_slot.id IS NULL THEN
    RAISE EXCEPTION 'slot_not_found';
  END IF;
  IF v_slot.status <> 'open' THEN
    RAISE EXCEPTION 'slot_not_open';
  END IF;
  SELECT count(*) INTO v_n
  FROM public.orders
  WHERE delivery_slot_id = NEW.delivery_slot_id AND status <> 'cancelled';
  IF v_n >= v_slot.max_orders THEN
    RAISE EXCEPTION 'slot_full';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_slot_capacity_trg ON public.orders;
CREATE TRIGGER enforce_slot_capacity_trg
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  WHEN (NEW.delivery_slot_id IS NOT NULL)
  EXECUTE FUNCTION public.enforce_slot_capacity();

-- ---------------------------------------------------------------------------
-- 3. Clôture automatique de la tournée : plus aucun stop 'pending' →
--    delivery_tours.status = 'completed' (rien ne le faisait jusqu'ici).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_tour_when_done()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('delivered', 'failed') AND NOT EXISTS (
    SELECT 1 FROM public.tour_stops
    WHERE tour_id = NEW.tour_id AND status = 'pending'
  ) THEN
    UPDATE public.delivery_tours
       SET status = 'completed', ended_at = COALESCE(ended_at, now())
     WHERE id = NEW.tour_id AND status IN ('planned', 'in_progress');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS complete_tour_when_done_trg ON public.tour_stops;
CREATE TRIGGER complete_tour_when_done_trg
  AFTER UPDATE OF status ON public.tour_stops
  FOR EACH ROW
  EXECUTE FUNCTION public.complete_tour_when_done();

-- ---------------------------------------------------------------------------
-- 4. reorder_tour_from — fix : les stops pending dont stop_order était inférieur
--    au max des non-pending n'étaient JAMAIS réordonnés. Le filtre correct pour
--    « pas encore réécrit dans cette passe » est stop_order > 0 (la passe
--    courante écrit des négatifs temporaires).
-- ---------------------------------------------------------------------------
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

  SELECT COALESCE(MAX(stop_order), 0) + 1 INTO v_next_order
  FROM public.tour_stops
  WHERE tour_id = p_tour_id AND status <> 'pending';

  LOOP
    SELECT s.id, o.delivery_lat AS lat, o.delivery_lng AS lng
      INTO v_best
    FROM public.tour_stops s
    JOIN public.orders o ON o.id = s.order_id
    WHERE s.tour_id = p_tour_id
      AND s.status = 'pending'
      AND s.stop_order > 0  -- pas encore réécrit dans cette passe (négatif sinon)
    ORDER BY
      CASE WHEN o.delivery_lat IS NULL OR o.delivery_lng IS NULL THEN 1 ELSE 0 END,
      (o.delivery_lat - v_current_lat) * (o.delivery_lat - v_current_lat) +
      (o.delivery_lng - v_current_lng) * (o.delivery_lng - v_current_lng)
    LIMIT 1;

    EXIT WHEN v_best.id IS NULL;

    UPDATE public.tour_stops
      SET stop_order = -v_next_order
      WHERE id = v_best.id;

    IF v_best.lat IS NOT NULL AND v_best.lng IS NOT NULL THEN
      v_current_lat := v_best.lat;
      v_current_lng := v_best.lng;
    END IF;
    v_next_order := v_next_order + 1;
    v_picked_count := v_picked_count + 1;
  END LOOP;

  UPDATE public.tour_stops
    SET stop_order = -stop_order
    WHERE tour_id = p_tour_id AND stop_order < 0;

  RETURN QUERY SELECT v_picked_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------------
-- 5. driver_report_no_show — reprend 0162 avec les correctifs TOURNÉE :
--    • payout course (online payé) EXPRESS-ONLY (le livreur tournée est payé
--      par son commerçant, qui reçoit déjà delivery_revenue) ;
--    • snapshots driver_fee/driver_net EXPRESS-ONLY ;
--    • tour_stop marqué 'failed' (sinon tournée jamais terminable) ;
--    • pénalité cash récupérée → reversée au commerçant en TOURNÉE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_report_no_show(
  p_order_id            UUID,
  p_reason              TEXT DEFAULT 'no_show',
  p_client_operation_id TEXT DEFAULT NULL
) RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user         UUID := auth.uid();
  v_driver_id    UUID;
  v_order        public.orders%ROWTYPE;
  v_s            public.platform_settings%ROWTYPE;
  v_reason       TEXT;
  v_delivery_fee INTEGER;
  v_driver_fee   INTEGER;
  v_driver_net   INTEGER;
  v_wait         INTEGER;
  v_required_min INTEGER;
  v_client_replied BOOLEAN;
  v_liability    INTEGER;
  v_recovered    INTEGER := 0;
  v_take         INTEGER;
  v_bal          INTEGER;
  v_label        TEXT;
  v_products     INTEGER;
  v_comm_rate    NUMERIC(5, 4);
  v_advance      INTEGER;
  v_is_cash      BOOLEAN;
  v_is_express   BOOLEAN;
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = v_user;
  IF v_driver_id IS NULL THEN ok := false; reason := 'not_a_driver'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN ok := false; reason := 'order_not_found'; RETURN NEXT; RETURN; END IF;
  IF v_order.fulfillment_type <> 'delivery' THEN
    ok := false; reason := 'not_a_delivery'; RETURN NEXT; RETURN; END IF;
  IF v_order.delivery_driver_id IS NULL OR v_order.delivery_driver_id <> v_driver_id THEN
    ok := false; reason := 'not_attributed_to_you'; RETURN NEXT; RETURN; END IF;
  IF v_order.status IN ('completed', 'cancelled') THEN
    ok := false; reason := 'already_closed'; RETURN NEXT; RETURN; END IF;
  IF v_order.delivery_picked_up_at IS NULL THEN
    ok := false; reason := 'not_picked_up'; RETURN NEXT; RETURN; END IF;
  IF v_order.delivery_arrived_at IS NULL THEN
    ok := false; reason := 'not_arrived'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_s FROM public.platform_settings WHERE id = true;
  v_wait := GREATEST(1, COALESCE(v_s.noshow_wait_min, 8));

  SELECT EXISTS (
    SELECT 1 FROM public.order_messages m
     WHERE m.order_id = p_order_id
       AND m.sender_role = 'customer'
       AND m.created_at > v_order.delivery_arrived_at
  ) INTO v_client_replied;
  v_required_min := CASE WHEN v_client_replied THEN v_wait ELSE v_wait * 2 END;

  IF now() < v_order.delivery_arrived_at + make_interval(mins => v_required_min) THEN
    ok := false; reason := 'too_early'; RETURN NEXT; RETURN;
  END IF;

  v_reason := COALESCE(NULLIF(btrim(p_reason), ''), 'no_show');
  IF v_reason NOT IN ('no_show', 'refused') THEN v_reason := 'no_show'; END IF;

  v_is_cash    := (v_order.payment_method = 'cash');
  v_is_express := (v_order.delivery_mode = 'express');

  v_delivery_fee := COALESCE(v_order.delivery_fee_da, 0);
  -- driver_fee/driver_net : concepts EXPRESS (barème plateforme). En tournée le
  -- livreur est payé hors plateforme par son commerçant → 0, pas de snapshot.
  IF NOT v_is_express OR v_delivery_fee <= 0 THEN
    v_driver_fee := 0;
  ELSE
    v_driver_fee := LEAST(
      v_delivery_fee,
      GREATEST(v_s.driver_fee_min_da,
        LEAST(round(v_delivery_fee * v_s.driver_fee_rate)::INTEGER,
              round(v_delivery_fee * v_s.driver_fee_cap_rate)::INTEGER)));
  END IF;
  v_driver_net := CASE WHEN v_is_express THEN v_delivery_fee - v_driver_fee ELSE 0 END;

  -- 1) Commande annulée + tracée. delivery_failed_at posé →
  --    • les triggers refund cashback/topup SKIPPENT (pas de remboursement) ;
  --    • le trigger wallet (0160) crédite commerçant/plateforme si ONLINE PAYÉ.
  UPDATE public.orders
     SET status                  = 'cancelled',
         delivery_failed_at      = now(),
         delivery_failed_reason  = v_reason,
         driver_fee_rate_applied = CASE WHEN v_is_express THEN v_s.driver_fee_rate ELSE driver_fee_rate_applied END,
         driver_fee_da           = CASE WHEN v_is_express THEN v_driver_fee ELSE driver_fee_da END,
         driver_net_da           = CASE WHEN v_is_express THEN v_driver_net ELSE driver_net_da END
   WHERE id = p_order_id;

  -- Tournée : l'arrêt échoue (sinon la tournée reste 'in_progress' à jamais et
  -- la réoptimisation continue de router vers une commande annulée).
  UPDATE public.tour_stops
     SET status = 'failed'
   WHERE order_id = p_order_id AND status = 'pending';

  INSERT INTO public.order_events (order_id, from_status, to_status, client_operation_id, note)
  VALUES (p_order_id, v_order.status, 'cancelled', NULL,
          'driver_no_show:' || v_reason || ':' || COALESCE(p_client_operation_id, ''))
  ON CONFLICT DO NOTHING;

  -- 2) Course payée UNIQUEMENT en EXPRESS online payé. En tournée le commerçant
  --    reçoit delivery_revenue (trigger wallet) et règle son livreur lui-même —
  --    payer aussi le livreur côté plateforme = payer la course deux fois.
  IF v_is_express AND v_driver_net > 0 AND NOT v_is_cash AND v_order.payment_status = 'paid' THEN
    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (v_driver_id, v_order.merchant_id, p_order_id, 'driver_payout', v_driver_net,
            'Course payée — commande prépayée en ligne, client absent.')
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  -- 2bis) ESPÈCES (custodian express) : réclamation d'avance, validée support.
  IF v_is_cash AND v_is_express THEN
    v_products  := GREATEST(0, COALESCE(v_order.net_total_da, v_order.subtotal_da - v_order.discount_da));
    v_comm_rate := public.resolve_rate(v_order.merchant_id, 'commission_cash');
    v_advance   := GREATEST(v_products - round(v_products * v_comm_rate)::INTEGER, 0);
    IF v_advance > 0 THEN
      INSERT INTO public.driver_refund_claims
        (order_id, driver_id, merchant_id, customer_id, advance_da, reason)
      VALUES (p_order_id, v_driver_id, v_order.merchant_id, v_order.customer_id, v_advance, v_reason)
      ON CONFLICT (order_id) DO NOTHING;
    END IF;
  END IF;

  -- 3) Pénalité client — ESPÈCES uniquement.
  IF v_order.customer_id IS NOT NULL THEN
    IF v_is_cash THEN
      v_liability := GREATEST(0, v_delivery_fee);
      v_label := 'Pénalité no-show — commande ' || COALESCE(v_order.order_number, left(v_order.id::text, 8));

      v_bal := COALESCE(public.customer_cashback_balance(v_order.customer_id), 0);
      v_take := LEAST(GREATEST(v_liability - v_recovered, 0), GREATEST(v_bal, 0));
      IF v_take > 0 THEN
        INSERT INTO public.customer_wallet_entries
          (customer_id, order_id, type, source, amount_da, note)
        VALUES (v_order.customer_id, NULL, 'adjustment', 'cashback', -v_take, v_label);
        v_recovered := v_recovered + v_take;
      END IF;

      v_bal := COALESCE(public.customer_topup_balance(v_order.customer_id), 0);
      v_take := LEAST(GREATEST(v_liability - v_recovered, 0), GREATEST(v_bal, 0));
      IF v_take > 0 THEN
        INSERT INTO public.customer_wallet_entries
          (customer_id, order_id, type, source, amount_da, note)
        VALUES (v_order.customer_id, NULL, 'adjustment', 'topup', -v_take, v_label);
        v_recovered := v_recovered + v_take;
      END IF;

      -- TOURNÉE : la course perdue est un coût du COMMERÇANT (son livreur, son
      -- carburant) — la pénalité récupérée lui est reversée. En express elle
      -- reste à la plateforme (c'est elle qui indemnise le livreur).
      IF NOT v_is_express AND v_recovered > 0 THEN
        INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da, note)
        VALUES (v_order.merchant_id, p_order_id, 'adjustment', v_recovered,
                'Pénalité no-show tournée récupérée sur le solde client — reversée.')
        ON CONFLICT (order_id, type) DO NOTHING;
      END IF;
    END IF;

    PERFORM set_config('app.allow_risk_update', 'on', true);
    UPDATE public.customers
       SET noshow_count   = noshow_count + 1,
           noshow_pending = noshow_pending
             OR (v_is_cash AND (GREATEST(0, v_delivery_fee) - v_recovered) > 0)
     WHERE id = v_order.customer_id;
  END IF;

  -- 4) Express : libérer le livreur.
  IF v_is_express THEN
    UPDATE public.driver_availability
       SET status = 'available', current_order_id = NULL
     WHERE current_order_id = p_order_id;
  END IF;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. generate_wallet_entries_on_completion — reprend 0160 ; le plafond cashback
--    COD compte la commission tournée (ce que le commerçant reverse vraiment)
--    et non D entier.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_wallet_entries_on_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_generate     BOOLEAN := false;
  v_comm_rate    NUMERIC(5, 4);
  v_cash_rate    NUMERIC(5, 4);
  v_fee_rate     NUMERIC(5, 4);
  v_products_da  INTEGER;
  v_service_fee  INTEGER;
  v_commission   INTEGER;
  v_cashback     INTEGER;
  v_chargily     INTEGER;
  v_is_tour      BOOLEAN;
  v_delivery_fee INTEGER;
  v_tour_rate    NUMERIC(5, 4);
  v_tour_comm    INTEGER := 0;
  v_redeemed     INTEGER;
BEGIN
  v_generate := (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed');

  IF NOT v_generate
     AND NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled'
     AND NEW.delivery_failed_at IS NOT NULL
     AND NEW.payment_method <> 'cash' THEN
    v_generate := true;
  END IF;

  IF v_generate AND NEW.payment_method <> 'cash'
     AND NEW.payment_status <> 'paid' THEN
    v_generate := false;
  END IF;

  IF NOT v_generate THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_method = 'cash'
     AND NEW.fulfillment_type = 'delivery'
     AND NEW.delivery_driver_id IS NOT NULL
     AND NEW.delivery_mode = 'express' THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_method = 'cash' THEN
    v_comm_rate := public.resolve_rate(NEW.merchant_id, 'commission_cash');
    v_cash_rate := public.resolve_rate(NEW.merchant_id, 'cashback_cash');
    v_fee_rate  := 0;
  ELSE
    v_comm_rate := public.resolve_rate(NEW.merchant_id, 'commission_online');
    v_cash_rate := public.resolve_rate(NEW.merchant_id, 'cashback_online');
    v_fee_rate  := public.resolve_rate(NEW.merchant_id, 'chargily_fee');
  END IF;

  v_products_da := GREATEST(0, COALESCE(NEW.net_total_da, NEW.subtotal_da - NEW.discount_da));
  v_service_fee := COALESCE(NEW.service_fee_da, 0);
  v_delivery_fee := COALESCE(NEW.delivery_fee_da, 0);
  v_commission  := round(v_products_da * v_comm_rate)::INTEGER;
  v_chargily    := round(NEW.total_da * v_fee_rate)::INTEGER;
  v_redeemed    := GREATEST(0, COALESCE(NEW.cashback_used_da, 0) + COALESCE(NEW.topup_used_da, 0));

  -- Commission tournée AVANT le plafond cashback (elle y entre désormais).
  v_is_tour := (NEW.fulfillment_type = 'delivery' AND NEW.delivery_mode = 'tour');
  IF v_is_tour AND v_delivery_fee > 0 THEN
    SELECT tour_delivery_commission_rate INTO v_tour_rate FROM public.platform_settings WHERE id = true;
    v_tour_comm := round(v_delivery_fee * COALESCE(v_tour_rate, 0))::INTEGER;
  END IF;

  v_cashback := round(v_products_da * v_cash_rate)::INTEGER;
  IF NEW.payment_method = 'cash' THEN
    -- Plafond « montants à reverser » : en TOURNÉE cash, le commerçant garde D
    -- et ne reverse que la commission tournée → c'est ELLE qui entre au plafond
    -- (sinon la plateforme accorde plus de cashback qu'elle n'encaisse).
    v_cashback := LEAST(v_cashback,
                        (v_products_da / 2),
                        GREATEST(v_commission + v_service_fee +
                                 CASE WHEN v_is_tour THEN v_tour_comm ELSE v_delivery_fee END, 0));
  END IF;
  IF NEW.delivery_failed_at IS NOT NULL THEN
    v_cashback := 0;
  END IF;

  UPDATE public.orders
  SET commission_rate_applied              = v_comm_rate,
      cashback_rate_applied                = v_cash_rate,
      chargily_fee_rate_applied            = v_fee_rate,
      commission_da                        = v_commission,
      tour_delivery_commission_rate_applied= CASE WHEN v_is_tour THEN COALESCE(v_tour_rate, 0) ELSE tour_delivery_commission_rate_applied END,
      tour_delivery_commission_da          = CASE WHEN v_is_tour THEN v_tour_comm ELSE tour_delivery_commission_da END
  WHERE id = NEW.id;

  IF NEW.payment_method = 'online' THEN
    INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da)
    VALUES (NEW.merchant_id, NEW.id, 'sale', v_products_da)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da, commission_rate)
  VALUES (NEW.merchant_id, NEW.id, 'commission', -v_commission, v_comm_rate)
  ON CONFLICT (order_id, type) DO NOTHING;

  IF NEW.payment_method = 'cash' AND v_service_fee > 0 THEN
    INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.merchant_id, NEW.id, 'service_fee', -v_service_fee,
            'Frais de service encaissés en espèces — à reverser à Coligo.')
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  IF NEW.payment_method = 'cash' AND v_redeemed > 0 THEN
    INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.merchant_id, NEW.id, 'wallet_redemption', v_redeemed,
            'Cashback / Coligo Pay du client, reversé par Coligo.')
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  IF v_is_tour THEN
    IF NEW.payment_method = 'online' AND v_delivery_fee > 0 THEN
      INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da, note)
      VALUES (NEW.merchant_id, NEW.id, 'delivery_revenue', v_delivery_fee,
              'Frais de livraison tournée encaissés pour votre compte.')
      ON CONFLICT (order_id, type) DO NOTHING;
    END IF;
    IF v_tour_comm > 0 THEN
      INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da, note)
      VALUES (NEW.merchant_id, NEW.id, 'tour_delivery_commission', -v_tour_comm,
              'Commission Coligo sur la livraison tournée.')
      ON CONFLICT (order_id, type) DO NOTHING;
    END IF;
  END IF;

  INSERT INTO public.platform_ledger (order_id, type, amount_da)
  VALUES (NEW.id, 'commission_income', v_commission)
  ON CONFLICT (order_id, type) DO NOTHING;

  IF v_service_fee > 0 THEN
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NEW.id, 'service_fee_income', v_service_fee)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  IF v_tour_comm > 0 THEN
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NEW.id, 'tour_delivery_commission_income', v_tour_comm)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  IF NEW.payment_method = 'online' AND v_chargily > 0 THEN
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NEW.id, 'chargily_fee', -v_chargily)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  IF v_cashback > 0 THEN
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NEW.id, 'cashback_expense', -v_cashback)
    ON CONFLICT (order_id, type) DO NOTHING;
    INSERT INTO public.cashback_grants (order_id, customer_phone, customer_id, amount_da)
    VALUES (NEW.id, NEW.customer_phone, NEW.customer_id, v_cashback)
    ON CONFLICT (order_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. grant_customer_cashback_on_completion — reprend 0118 ; MÊME plafond tournée
--    que le trigger wallet (parité stricte crédit client == charge plateforme)
--    + garde delivery_failed_at (aligné 0160 : pas de cashback sur no-show).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_customer_cashback_on_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_products     INTEGER;
  v_cash_rate    NUMERIC(5, 4);
  v_comm_rate    NUMERIC(5, 4);
  v_amount       INTEGER;
  v_commission   INTEGER;
  v_service_fee  INTEGER;
  v_delivery_fee INTEGER;
  v_is_tour      BOOLEAN;
  v_tour_rate    NUMERIC(5, 4);
  v_tour_comm    INTEGER := 0;
BEGIN
  IF NOT (NEW.status = 'completed'
          AND OLD.status IS DISTINCT FROM 'completed'
          AND NEW.customer_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  -- Pas de cashback sur une livraison échouée (parité 0160).
  IF NEW.delivery_failed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_products := GREATEST(0, COALESCE(NEW.net_total_da, NEW.subtotal_da - NEW.discount_da));

  IF NEW.payment_method = 'cash' THEN
    v_cash_rate := public.resolve_rate(NEW.merchant_id, 'cashback_cash');
    v_comm_rate := public.resolve_rate(NEW.merchant_id, 'commission_cash');
  ELSE
    v_cash_rate := public.resolve_rate(NEW.merchant_id, 'cashback_online');
    v_comm_rate := public.resolve_rate(NEW.merchant_id, 'commission_online');
  END IF;

  v_amount := round(v_products * v_cash_rate)::INTEGER;

  IF NEW.payment_method = 'cash' THEN
    v_commission   := round(v_products * v_comm_rate)::INTEGER;
    v_service_fee  := COALESCE(NEW.service_fee_da, 0);
    v_delivery_fee := COALESCE(NEW.delivery_fee_da, 0);
    -- En tournée le commerçant garde D : seule la commission tournée entre au
    -- plafond (même formule que le trigger wallet — parité stricte).
    v_is_tour := (NEW.fulfillment_type = 'delivery' AND NEW.delivery_mode = 'tour');
    IF v_is_tour AND v_delivery_fee > 0 THEN
      SELECT tour_delivery_commission_rate INTO v_tour_rate FROM public.platform_settings WHERE id = true;
      v_tour_comm := round(v_delivery_fee * COALESCE(v_tour_rate, 0))::INTEGER;
    END IF;
    v_amount := LEAST(
      v_amount,
      (v_products / 2),
      GREATEST(v_commission + v_service_fee +
               CASE WHEN v_is_tour THEN v_tour_comm ELSE v_delivery_fee END, 0)
    );
  END IF;

  IF v_amount > 0 THEN
    INSERT INTO public.customer_wallet_entries
      (customer_id, order_id, type, source, amount_da)
    VALUES
      (NEW.customer_id, NEW.id, 'cashback_earned', 'cashback', v_amount)
    ON CONFLICT (order_id, type) DO NOTHING;

    UPDATE public.orders SET cashback_da = v_amount WHERE id = NEW.id;

    UPDATE public.cashback_grants
       SET status      = 'granted',
           customer_id = COALESCE(customer_id, NEW.customer_id)
     WHERE order_id = NEW.id
       AND status   = 'pending';
  END IF;

  RETURN NEW;
END;
$$;
