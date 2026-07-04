-- =============================================================================
-- 0326 — No-show ESPÈCES express : PAS de paiement automatique de la course
-- =============================================================================
-- DÉCISION PRODUIT (04/07/2026, propriétaire) — annule le §2 de la mig 0325 :
--
--   « Le livreur n'est PAS payé pour la course sur un no-show d'une commande
--     payée en ESPÈCES (express inclus). Il est uniquement remboursé de
--     l'AVANCE qu'il a remise au commerçant au retrait de la commande
--     (P − commission), et SEULEMENT après validation du support plateforme
--     (super-admin). »
--
-- Concrètement :
--   • ESPÈCES express : aucune écriture driver_payout au no-show. La seule
--     voie d'indemnisation = `driver_refund_claims` (mig 0160), résolue par
--     `admin_resolve_driver_refund_claim` (service_role, back-office admin) :
--     retour marchandise au commerçant = remboursement en main propre, sinon
--     `driver_advance_refund` au relevé. La pénalité client (= D, prélevée
--     best-effort sur ses soldes) RESTE à la plateforme (provision du risque
--     d'avance qu'elle rembourse après validation).
--   • ONLINE payé : INCHANGÉ — la course est payée (driver_payout D − fee),
--     financée par le paiement carte déjà encaissé (mig 0116/0164).
--   • TOURNÉE : INCHANGÉ — rien côté plateforme, pénalité reversée commerçant.
--
-- Le reste de la fonction est STRICTEMENT identique à 0325 (elle-même = 0164
-- hors §2). Aucune écriture rétroactive à corriger : vérifié en prod, aucune
-- ligne `driver_payout` de no-show espèces n'a été créée entre 0325 et 0326.
-- =============================================================================

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
  --    • le trigger wallet (0205) crédite commerçant/plateforme si ONLINE PAYÉ.
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

  -- 2) Course payée UNIQUEMENT en EXPRESS ONLINE PAYÉ (décision produit 0326 :
  --    en ESPÈCES le livreur n'est pas payé pour la course — il ne récupère
  --    que l'AVANCE, via le support §2bis). En tournée le commerçant reçoit
  --    delivery_revenue (trigger wallet) et règle son livreur lui-même.
  IF v_is_express AND v_driver_net > 0 AND NOT v_is_cash AND v_order.payment_status = 'paid' THEN
    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (v_driver_id, v_order.merchant_id, p_order_id, 'driver_payout', v_driver_net,
            'Course payée — commande prépayée en ligne, client absent.')
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  -- 2bis) ESPÈCES (custodian express) : réclamation de l'avance remise au
  --       commerçant au retrait (P − commission) — SEULE indemnisation du
  --       livreur, versée APRÈS validation du support plateforme (super-admin,
  --       admin_resolve_driver_refund_claim / mig 0160).
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
      -- reste à la plateforme : elle provisionne le risque d'avance qu'elle
      -- rembourse au livreur après validation support (§2bis).
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
