-- =============================================================================
-- 0338 — Gestion avancée des commandes (super-admin) : RPC
-- =============================================================================
-- Module « Commandes » du hub Pilotage : recherche multi-critères, fiche
-- commande, réattribution livreur, indemnisation, remboursement client manuel,
-- échec de livraison. Toutes les RPC sont SECURITY DEFINER gardées par
-- `admin_can(domaine)` (pattern 0303) : un staff hors domaine qui tape `rpc()`
-- directement est rejeté. GRANT EXECUTE par rôle appelant (cf. piège 0303 :
-- la session admin est `authenticated`).
--
--  1. admin_search_orders        — recherche combinée (n°/client/commerçant/
--                                  livreur/statut/paiement/mode/date) paginée.
--  2. admin_reassign_delivery v2 — + trace order_events, + fix driver_claimed_at
--                                  (sans quoi le watchdog 0323 libérait à tort le
--                                  NOUVEAU livreur sur la base de l'ancien claim),
--                                  garde scopée domaine (pilotage OU livraison).
--  3. admin_compensate_driver    — indemnité discrétionnaire (delivery_ledger
--                                  'driver_compensation', UNE par commande).
--  4. driver_outstanding / generate_driver_statements — redéfinis pour compter
--                                  'driver_compensation' comme un dû plateforme
--                                  (« à recevoir », déduit de l'encours cash),
--                                  même mécanique que 'driver_advance_refund'.
--  5. admin_refund_customer      — remboursement MANUEL partiel/total → crédit
--                                  Coligo Pay, plafonné à ce que le client a
--                                  réellement payé, anti-double (FOR UPDATE +
--                                  cumul orders.admin_refunded_da). Réservé aux
--                                  commandes TERMINÉES : une commande en cours
--                                  s'annule (admin_cancel_order rembourse déjà
--                                  tout, triggers compris) — évite tout double
--                                  re-crédit annulation + manuel.
--  6. admin_mark_delivery_failed — échec de livraison : pose delivery_failed_at
--                                  + motif puis réutilise admin_cancel_order
--                                  (remboursements/notifs cohérents).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Recherche multi-critères paginée.
--    `p_q` : n° commande / nom / téléphone client (+ id exact).
--    `p_merchant_q`, `p_driver_q` : nom / téléphone / id exact.
--    `p_status` : statut exact ou 'active' (pending|accepted|preparing|ready).
--    Bornes de date en timestamptz (l'UI convertit la période Alger).
--    total_count fenêtré → une seule requête pour la page + le total.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_search_orders(
  p_q              TEXT DEFAULT NULL,
  p_merchant_q     TEXT DEFAULT NULL,
  p_driver_q       TEXT DEFAULT NULL,
  p_status         TEXT DEFAULT NULL,
  p_payment_method TEXT DEFAULT NULL,
  p_payment_status TEXT DEFAULT NULL,
  p_fulfillment    TEXT DEFAULT NULL,
  p_delivery_mode  TEXT DEFAULT NULL,
  p_from           TIMESTAMPTZ DEFAULT NULL,
  p_to             TIMESTAMPTZ DEFAULT NULL,
  p_limit          INTEGER DEFAULT 30,
  p_offset         INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID, order_number TEXT, status TEXT,
  fulfillment_type TEXT, delivery_mode TEXT,
  payment_method TEXT, payment_status TEXT,
  total_da INTEGER, admin_refunded_da INTEGER,
  customer_name TEXT, customer_phone TEXT,
  merchant_id UUID, merchant_name TEXT,
  driver_id UUID, driver_name TEXT,
  cancelled_by TEXT, delivery_no_show_at TIMESTAMPTZ,
  delivery_failed_at TIMESTAMPTZ, created_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q  TEXT := NULLIF(btrim(COALESCE(p_q, '')), '');
  v_mq TEXT := NULLIF(btrim(COALESCE(p_merchant_q, '')), '');
  v_dq TEXT := NULLIF(btrim(COALESCE(p_driver_q, '')), '');
BEGIN
  -- Lecture partagée Pilotage (cockpit) + Commerçants (onglet Commandes du hub).
  IF NOT (public.admin_can('pilotage') OR public.admin_can('commercants')) THEN
    RETURN; -- fail-closed : aucune ligne
  END IF;

  RETURN QUERY
  SELECT
    o.id, o.order_number, o.status::TEXT,
    o.fulfillment_type::TEXT, o.delivery_mode::TEXT,
    o.payment_method::TEXT, o.payment_status::TEXT,
    o.total_da, o.admin_refunded_da,
    o.customer_name, o.customer_phone,
    o.merchant_id, m.name AS merchant_name,
    o.delivery_driver_id AS driver_id, d.full_name AS driver_name,
    o.cancelled_by, o.delivery_no_show_at,
    o.delivery_failed_at, o.created_at,
    COUNT(*) OVER () AS total_count
  FROM public.orders o
  JOIN public.merchants m ON m.id = o.merchant_id
  LEFT JOIN public.drivers d ON d.id = o.delivery_driver_id
  WHERE
    (v_q IS NULL
      OR o.order_number ILIKE '%' || v_q || '%'
      OR o.customer_name ILIKE '%' || v_q || '%'
      OR o.customer_phone ILIKE '%' || v_q || '%'
      OR o.delivery_phone ILIKE '%' || v_q || '%'
      OR o.id::TEXT = lower(v_q)
      OR o.customer_id::TEXT = lower(v_q))
    AND (v_mq IS NULL
      OR m.name ILIKE '%' || v_mq || '%'
      OR m.id::TEXT = lower(v_mq))
    AND (v_dq IS NULL
      OR (d.id IS NOT NULL AND (
            d.full_name ILIKE '%' || v_dq || '%'
         OR d.phone ILIKE '%' || v_dq || '%'
         OR d.id::TEXT = lower(v_dq))))
    AND (p_status IS NULL
      OR (p_status = 'active' AND o.status IN ('pending','accepted','preparing','ready'))
      OR o.status::TEXT = p_status)
    AND (p_payment_method IS NULL OR o.payment_method::TEXT = p_payment_method)
    AND (p_payment_status IS NULL OR o.payment_status::TEXT = p_payment_status)
    AND (p_fulfillment IS NULL OR o.fulfillment_type::TEXT = p_fulfillment)
    AND (p_delivery_mode IS NULL OR o.delivery_mode::TEXT = p_delivery_mode)
    AND (p_from IS NULL OR o.created_at >= p_from)
    AND (p_to IS NULL OR o.created_at < p_to)
  ORDER BY o.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_search_orders(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,INTEGER,INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_orders(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,INTEGER,INTEGER) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Réattribution v2 (corps 0107 + correctifs).
--    • Garde scopée : pilotage (fiche commande) OU livraison (fiche livreur).
--    • FIX watchdog : en mode 'driver', `driver_claimed_at` gardait l'horodatage
--      de l'ANCIEN livreur → release_stale_express_claims (0323) pouvait retirer
--      la commande au nouveau porteur avant ses 20 min. On le pose à now()
--      (mode driver) / NULL (mode pool).
--    • Trace order_events (statut inchangé, porteur changé) — historique fiche.
-- ----------------------------------------------------------------------------
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
  v_new_name   TEXT;
BEGIN
  IF NOT (public.admin_can('pilotage') OR public.admin_can('livraison')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  IF v_order.fulfillment_type <> 'delivery' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_delivery');
  END IF;
  IF v_order.status IN ('completed', 'cancelled')
     OR v_order.delivery_delivered_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_terminal');
  END IF;

  v_old_driver := v_order.delivery_driver_id;

  IF v_old_driver IS NOT NULL THEN
    UPDATE public.driver_availability da
      SET status = 'available', current_order_id = NULL
      FROM public.merchant_drivers md
      WHERE da.merchant_driver_id = md.id
        AND md.driver_id = v_old_driver
        AND da.current_order_id = p_order_id;
  END IF;

  IF p_mode = 'pool' THEN
    UPDATE public.orders
      SET delivery_driver_id  = NULL,
          driver_notified_at  = NULL,
          driver_claimed_at   = NULL,
          delivery_picked_up_at = NULL,
          delivery_arrived_at = NULL
      WHERE id = p_order_id;
    IF v_old_driver IS NOT NULL THEN
      INSERT INTO public.express_declines (order_id, driver_id)
        VALUES (p_order_id, v_old_driver)
        ON CONFLICT (order_id, driver_id) DO UPDATE SET declined_at = now();
    END IF;

    INSERT INTO public.order_events (order_id, from_status, to_status, note)
      VALUES (p_order_id, v_order.status, v_order.status,
              'admin_reassign: commande remise au réseau (livreur retiré)');

  ELSIF p_mode = 'driver' THEN
    IF p_driver_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'driver_required');
    END IF;
    SELECT full_name INTO v_new_name FROM public.drivers
      WHERE id = p_driver_id
        AND COALESCE(is_frozen, false) = false
        AND COALESCE(is_blocked, false) = false;
    IF v_new_name IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'driver_unavailable');
    END IF;

    UPDATE public.orders
      SET delivery_driver_id  = p_driver_id,
          driver_notified_at  = now(),
          driver_claimed_at   = now(),
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

    INSERT INTO public.order_events (order_id, from_status, to_status, note)
      VALUES (p_order_id, v_order.status, v_order.status,
              'admin_reassign: attribuée à ' || v_new_name);

  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_mode');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'merchant_id', v_order.merchant_id,
    'old_driver_id', v_old_driver,
    'new_driver_id', CASE WHEN p_mode = 'driver' THEN p_driver_id ELSE NULL END,
    'order_number', v_order.order_number
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Indemnisation discrétionnaire d'un livreur sur une commande.
--    Le livreur indemnisé n'est PAS forcément le porteur actuel (cas type :
--    commande retirée après déplacement inutile). UNE indemnité par commande
--    (UNIQUE order_id+type). Note OBLIGATOIRE (traçabilité de la décision).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_compensate_driver(
  p_order_id  UUID,
  p_driver_id UUID,
  p_amount_da INTEGER,
  p_note      TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order  public.orders%ROWTYPE;
  v_driver public.drivers%ROWTYPE;
  v_id     UUID;
BEGIN
  IF NOT (public.admin_can('pilotage') OR public.admin_can('livraison')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF p_amount_da IS NULL OR p_amount_da < 1 OR p_amount_da > 20000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_amount');
  END IF;
  IF NULLIF(btrim(COALESCE(p_note, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'note_required');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  SELECT * INTO v_driver FROM public.drivers WHERE id = p_driver_id;
  IF v_driver.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'driver_not_found');
  END IF;

  INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (p_driver_id, v_order.merchant_id, p_order_id,
            'driver_compensation', p_amount_da, btrim(p_note))
    ON CONFLICT (order_id, type) DO NOTHING
    RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_compensated');
  END IF;

  -- Contrepartie comptable Coligo (dépense).
  INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (p_order_id, 'driver_compensation_expense', -p_amount_da)
    ON CONFLICT (order_id, type) DO NOTHING;

  INSERT INTO public.order_events (order_id, from_status, to_status, note)
    VALUES (p_order_id, v_order.status, v_order.status,
            'admin_compensation: ' || p_amount_da || ' DA → ' || v_driver.full_name
              || ' — ' || btrim(p_note));

  RETURN jsonb_build_object(
    'ok', true, 'amount_da', p_amount_da,
    'driver_name', v_driver.full_name,
    'order_number', v_order.order_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_compensate_driver(UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_compensate_driver(UUID, UUID, INTEGER, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Relevés + encours : 'driver_compensation' est un dû PLATEFORME → LIVREUR,
--    quel que soit le mode de paiement de la commande — compté « à recevoir »
--    dans le relevé et DÉDUIT de l'encours cash. Corps 0160 verbatim + la
--    branche driver_compensation (sinon l'écriture serait réglée sans jamais
--    être payée : avalée par le relevé).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_driver_statements(
  p_period_start DATE,
  p_period_end   DATE
)
RETURNS TABLE (statements_created INTEGER, drivers_total INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_created INTEGER := 0;
  v_total   INTEGER := 0;
  r         RECORD;
  v_stmt_id UUID;
  v_due     TIMESTAMPTZ;
BEGIN
  v_due := (p_period_end + INTERVAL '2 day')::date + TIME '23:59';

  FOR r IN
    SELECT
      dl.driver_id                                                            AS driver_id,
      COUNT(DISTINCT dl.order_id)                                             AS deliveries_count,
      COALESCE(SUM(CASE WHEN dl.type = 'driver_payout'
                        THEN dl.amount_da ELSE 0 END), 0)                     AS gross_driver_da,
      COALESCE(SUM(CASE WHEN dl.type = 'driver_payout'
                        AND (o.payment_method = 'online' OR o.delivery_failed_at IS NOT NULL)
                        THEN dl.amount_da
                        WHEN dl.type IN ('driver_advance_refund', 'driver_compensation')
                        THEN dl.amount_da ELSE 0 END), 0)                     AS to_receive_da,
      COALESCE(SUM(CASE WHEN dl.type = 'driver_owes_platform'
                        THEN dl.amount_da ELSE 0 END), 0)                     AS to_reverse_da,
      COALESCE(SUM(CASE WHEN dl.type = 'driver_owes_platform'
                        THEN COALESCE(o.commission_da, 0) ELSE 0 END), 0)     AS commission_da,
      COALESCE(SUM(CASE WHEN dl.type = 'driver_owes_platform'
                        THEN COALESCE(o.service_fee_da, 0) ELSE 0 END), 0)    AS service_fee_da,
      COALESCE(SUM(CASE WHEN dl.type = 'driver_owes_platform'
                        THEN COALESCE(o.driver_fee_da, 0) ELSE 0 END), 0)     AS driver_fee_da
    FROM public.delivery_ledger dl
    LEFT JOIN public.orders o ON o.id = dl.order_id
    WHERE dl.settled_at IS NULL
      AND dl.created_at >= p_period_start
      AND dl.created_at <  (p_period_end + INTERVAL '1 day')
    GROUP BY dl.driver_id
  LOOP
    v_total := v_total + 1;

    INSERT INTO public.driver_statements (
      driver_id, period_start, period_end, deliveries_count,
      gross_driver_da, commission_da, service_fee_da, driver_fee_da,
      to_reverse_da, to_receive_da, net_da, direction, status, due_at,
      method, details
    )
    SELECT
      r.driver_id, p_period_start, p_period_end, r.deliveries_count,
      r.gross_driver_da, r.commission_da, r.service_fee_da, r.driver_fee_da,
      r.to_reverse_da, r.to_receive_da,
      (r.to_receive_da - r.to_reverse_da),
      CASE WHEN (r.to_receive_da - r.to_reverse_da) > 0 THEN 'receive'
           WHEN (r.to_receive_da - r.to_reverse_da) < 0 THEN 'reverse'
           ELSE 'settled' END,
      CASE WHEN (r.to_receive_da - r.to_reverse_da) = 0 THEN 'paid' ELSE 'due' END,
      v_due,
      d.payout_method, d.payout_details
    FROM public.drivers d
    WHERE d.id = r.driver_id
    ON CONFLICT (driver_id, period_start, period_end) DO NOTHING
    RETURNING id INTO v_stmt_id;

    IF v_stmt_id IS NOT NULL THEN
      v_created := v_created + 1;
      UPDATE public.delivery_ledger
         SET statement_id = v_stmt_id, settled_at = now()
       WHERE driver_id = r.driver_id
         AND settled_at IS NULL
         AND created_at >= p_period_start
         AND created_at <  (p_period_end + INTERVAL '1 day');
    END IF;
    v_stmt_id := NULL;
  END LOOP;

  RETURN QUERY SELECT v_created, v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_driver_statements(DATE, DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.driver_outstanding(p_driver_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(0, COALESCE(
    SUM(CASE WHEN dl.type = 'driver_owes_platform' THEN dl.amount_da
             WHEN dl.type = 'driver_payout'
                  AND (o.payment_method = 'online' OR o.delivery_failed_at IS NOT NULL)
                  THEN -dl.amount_da
             WHEN dl.type IN ('driver_advance_refund', 'driver_compensation')
                  THEN -dl.amount_da
             ELSE 0 END), 0))::INTEGER
  FROM public.delivery_ledger dl
  LEFT JOIN public.orders o ON o.id = dl.order_id
  WHERE dl.driver_id = p_driver_id
    AND dl.settled_at IS NULL;
$$;

-- ----------------------------------------------------------------------------
-- 5. Remboursement MANUEL client (partiel ou total) → crédit Coligo Pay.
--    Réservé aux commandes TERMINÉES (completed) : une commande en cours
--    s'ANNULE (admin_cancel_order + triggers remboursent déjà carte + cashback
--    + Coligo Pay utilisés) — sinon un remboursement manuel PUIS une annulation
--    doublerait le re-crédit. Plafond = tout ce que le client a réellement
--    déboursé (total encaissé + portefeuille utilisé) − déjà remboursé manuel.
--    L'écriture wallet porte order_id NULL (précédent admin_cancel_order 0128 :
--    UNIQUE(order_id,type) doit rester libre pour les crédits nominaux) ; le
--    suivi anti-double vit dans orders.admin_refunded_da sous FOR UPDATE.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_refund_customer(
  p_order_id  UUID,
  p_amount_da INTEGER,
  p_note      TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order     public.orders%ROWTYPE;
  v_paid      INTEGER;
  v_remaining INTEGER;
  v_new_ps    TEXT;
BEGIN
  IF NOT public.admin_can('pilotage') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF p_amount_da IS NULL OR p_amount_da < 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_amount');
  END IF;
  IF NULLIF(btrim(COALESCE(p_note, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'note_required');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  IF v_order.customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_customer');
  END IF;
  IF v_order.status = 'cancelled' THEN
    -- L'annulation a déjà tout remboursé (triggers + admin_cancel_order).
    RETURN jsonb_build_object('ok', false, 'reason', 'cancelled_already_refunded');
  END IF;
  IF v_order.status <> 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_completed_use_cancel');
  END IF;

  -- Déboursé réel : total encaissé (carte si payée / espèces à la livraison)
  -- + portefeuille consommé à la création (cashback + Coligo Pay).
  v_paid := COALESCE(v_order.cashback_used_da, 0) + COALESCE(v_order.topup_used_da, 0)
          + CASE
              WHEN v_order.payment_method = 'online'
                   AND v_order.payment_status IN ('paid', 'refunded')
                THEN COALESCE(v_order.total_da, 0)
              WHEN v_order.payment_method = 'cash'
                THEN COALESCE(v_order.total_da, 0)
              ELSE 0
            END;
  IF v_order.payment_status = 'refunded' THEN
    -- Déjà remboursée intégralement côté encaissement (ex. no-show en ligne
    -- traité ailleurs) : il ne reste rien à rendre au-delà du cumul manuel.
    v_paid := LEAST(v_paid, COALESCE(v_order.admin_refunded_da, 0));
  END IF;

  v_remaining := v_paid - COALESCE(v_order.admin_refunded_da, 0);
  IF v_remaining < 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'nothing_refundable');
  END IF;
  IF p_amount_da > v_remaining THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'exceeds_refundable',
                              'remaining_da', v_remaining);
  END IF;

  v_new_ps := CASE
    WHEN v_order.payment_method = 'online'
         AND v_order.payment_status = 'paid'
         AND (COALESCE(v_order.admin_refunded_da, 0) + p_amount_da)
               >= COALESCE(v_order.total_da, 0)
      THEN 'refunded'
    ELSE v_order.payment_status::TEXT
  END;

  UPDATE public.orders
     SET admin_refunded_da = COALESCE(admin_refunded_da, 0) + p_amount_da,
         payment_status    = v_new_ps::public.payment_status
   WHERE id = p_order_id;

  INSERT INTO public.customer_wallet_entries
      (customer_id, order_id, type, source, amount_da, note)
    VALUES
      (v_order.customer_id, NULL, 'topup_credit', 'topup', p_amount_da,
       'Remboursement commande #' || COALESCE(v_order.order_number, left(p_order_id::TEXT, 6))
         || ' — ' || btrim(p_note));

  INSERT INTO public.order_events (order_id, from_status, to_status, note)
    VALUES (p_order_id, v_order.status, v_order.status,
            'admin_refund: ' || p_amount_da || ' DA re-crédités Coligo Pay — '
              || btrim(p_note));

  RETURN jsonb_build_object(
    'ok', true,
    'refunded_da', p_amount_da,
    'total_refunded_da', COALESCE(v_order.admin_refunded_da, 0) + p_amount_da,
    'remaining_da', v_remaining - p_amount_da,
    'payment_status', v_new_ps,
    'order_number', v_order.order_number,
    'customer_id', v_order.customer_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_refund_customer(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_refund_customer(UUID, INTEGER, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Échec de livraison : marqueurs (delivery_failed_at/reason) + annulation
--    via admin_cancel_order (remboursements + libération livreur cohérents,
--    même garde 'pilotage' — un appel imbriqué re-vérifie, c'est voulu).
--    NB : delivery_failed_at rend un éventuel driver_payout « à recevoir »
--    (règle 0160) — ici aucun payout n'existe (pas de complétion), donc seul
--    le bouton Indemniser crédite le livreur, explicitement.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_mark_delivery_failed(
  p_order_id UUID,
  p_reason   TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order  public.orders%ROWTYPE;
  v_reason TEXT := COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Échec de livraison');
  v_res    jsonb;
BEGIN
  IF NOT public.admin_can('pilotage') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  IF v_order.fulfillment_type <> 'delivery' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_delivery');
  END IF;
  IF v_order.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_terminal');
  END IF;

  UPDATE public.orders
     SET delivery_failed_at     = COALESCE(delivery_failed_at, now()),
         delivery_failed_reason = v_reason
   WHERE id = p_order_id;

  v_res := public.admin_cancel_order(p_order_id, 'Échec de livraison : ' || v_reason);
  RETURN v_res || jsonb_build_object('failed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_mark_delivery_failed(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_delivery_failed(UUID, TEXT) TO authenticated;

-- =============================================================================
-- VÉRIF (hors session admin → fail-closed) :
--   SELECT * FROM public.admin_search_orders();                      -- 0 ligne
--   SELECT public.admin_compensate_driver(gen_random_uuid(), gen_random_uuid(), 100, 'x');
--                                                       -- {ok:false, forbidden}
-- =============================================================================
