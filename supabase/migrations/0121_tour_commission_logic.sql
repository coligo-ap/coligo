-- =============================================================================
-- 0121 — Logique commission TOURNÉE + custodian réservé à l'EXPRESS
-- =============================================================================
-- Deux modèles de livraison, deux circuits financiers :
--
--  EXPRESS (livreur indépendant, géré plateforme) — INCHANGÉ :
--    • Le LIVREUR est custodian du cash (COD) ; il reverse commission+S+driver_fee
--      à la plateforme via delivery_ledger ; la plateforme le paie (relevés).
--    • Le commerçant n'a AUCUNE écriture wallet sur un COD express livré.
--
--  TOURNÉE (livreur inscrit chez le commerçant, livraison « en propre ») — NOUVEAU :
--    • Le COMMERÇANT encaisse les frais de livraison D (qu'il a fixés, ≤ barème).
--    • Il PAIE une commission plateforme = round(D × tour_delivery_commission_rate).
--    • Il paie SON livreur lui-même (hors plateforme : aucune écriture livreur).
--    • Donc : le custodian livreur est DÉSACTIVÉ en tournée, et le wallet
--      commerçant porte la livraison (revenu D online) + sa commission tournée.
--
--      COD tournée  : merchant doit = commission(produits) + S + tour_comm
--                     (il a le cash en main via son livreur). Wallet négatif.
--      Online tourn.: merchant reçoit = P − commission + D − tour_comm.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. generate_wallet_entries_on_completion — custodian EXPRESS only + tournée.
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
BEGIN
  IF NEW.payment_method = 'cash' THEN
    v_generate := (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed');
  ELSE
    v_generate := (NEW.payment_status = 'paid' AND OLD.payment_status IS DISTINCT FROM 'paid');
  END IF;

  IF NOT v_generate THEN
    RETURN NEW;
  END IF;

  -- RÉCONCILIATION COD EXPRESS : le LIVREUR est seul custodian du cash et reverse
  -- commission + S via delivery_ledger. Aucune écriture commerçant ici. NB : ce
  -- skip est désormais RÉSERVÉ À L'EXPRESS (la tournée passe par le wallet).
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
  v_commission  := round(v_products_da * v_comm_rate)::INTEGER;
  v_cashback    := round(v_products_da * v_cash_rate)::INTEGER;
  v_chargily    := round(NEW.total_da * v_fee_rate)::INTEGER;

  -- Commission TOURNÉE sur les frais de livraison (le commerçant encaisse D).
  v_is_tour      := (NEW.fulfillment_type = 'delivery' AND NEW.delivery_mode = 'tour');
  v_delivery_fee := COALESCE(NEW.delivery_fee_da, 0);
  IF v_is_tour AND v_delivery_fee > 0 THEN
    SELECT tour_delivery_commission_rate INTO v_tour_rate FROM public.platform_settings WHERE id = true;
    v_tour_comm := round(v_delivery_fee * COALESCE(v_tour_rate, 0))::INTEGER;
  END IF;

  UPDATE public.orders
  SET commission_rate_applied              = v_comm_rate,
      cashback_rate_applied                = v_cash_rate,
      chargily_fee_rate_applied            = v_fee_rate,
      commission_da                        = v_commission,
      tour_delivery_commission_rate_applied= CASE WHEN v_is_tour THEN COALESCE(v_tour_rate, 0) ELSE tour_delivery_commission_rate_applied END,
      tour_delivery_commission_da          = CASE WHEN v_is_tour THEN v_tour_comm ELSE tour_delivery_commission_da END
  WHERE id = NEW.id;

  -- ============================ WALLET COMMERÇANT ============================
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

  -- TOURNÉE : revenu livraison + commission tournée.
  IF v_is_tour THEN
    -- En ONLINE, la plateforme a encaissé D → elle le crédite au commerçant.
    -- En CASH, le commerçant détient déjà D (via son livreur) : pas de crédit.
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

  -- ============================== COMPTA COLIGO =============================
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

  IF NEW.payment_method = 'online' THEN
    IF v_chargily > 0 THEN
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
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. generate_delivery_ledger_on_complete — custodian RÉSERVÉ À L'EXPRESS.
--    (Reprend 0116 à l'identique, on ajoute `delivery_mode = 'express'` au garde.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_delivery_ledger_on_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s               public.platform_settings%ROWTYPE;
  v_products_da     INTEGER;
  v_comm_rate       NUMERIC(5, 4);
  v_cashback_rate   NUMERIC(5, 4);
  v_commission      INTEGER;
  v_service_fee     INTEGER;
  v_delivery_fee    INTEGER;
  v_driver_fee      INTEGER;
  v_driver_net      INTEGER;
  v_cashback        INTEGER;
  v_owes_merchant   INTEGER;
  v_owes_platform   INTEGER;
BEGIN
  -- Custodian livreur = EXPRESS uniquement. En tournée, le commerçant paie son
  -- livreur lui-même → aucune écriture delivery_ledger.
  IF NOT (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed'
          AND NEW.fulfillment_type = 'delivery'
          AND NEW.delivery_driver_id IS NOT NULL
          AND NEW.delivery_mode = 'express') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_s FROM public.platform_settings WHERE id = true;

  v_products_da  := GREATEST(0, COALESCE(NEW.net_total_da, NEW.subtotal_da - NEW.discount_da));
  v_service_fee  := COALESCE(NEW.service_fee_da, 0);
  v_delivery_fee := COALESCE(NEW.delivery_fee_da, 0);

  IF NEW.payment_method = 'cash' THEN
    v_comm_rate     := public.resolve_rate(NEW.merchant_id, 'commission_cash');
    v_cashback_rate := public.resolve_rate(NEW.merchant_id, 'cashback_cash');
  ELSE
    v_comm_rate     := public.resolve_rate(NEW.merchant_id, 'commission_online');
    v_cashback_rate := public.resolve_rate(NEW.merchant_id, 'cashback_online');
  END IF;

  v_commission := round(v_products_da * v_comm_rate)::INTEGER;

  IF v_delivery_fee <= 0 THEN
    v_driver_fee := 0;
  ELSE
    v_driver_fee := LEAST(
      v_delivery_fee,
      GREATEST(
        v_s.driver_fee_min_da,
        LEAST(round(v_delivery_fee * v_s.driver_fee_rate)::INTEGER,
              round(v_delivery_fee * v_s.driver_fee_cap_rate)::INTEGER)
      )
    );
  END IF;
  v_driver_net := v_delivery_fee - v_driver_fee;

  UPDATE public.orders
     SET driver_fee_rate_applied   = v_s.driver_fee_rate,
         driver_fee_da             = v_driver_fee,
         driver_net_da             = v_driver_net,
         commission_rate_applied   = COALESCE(commission_rate_applied, v_comm_rate),
         commission_da             = COALESCE(commission_da, v_commission)
   WHERE id = NEW.id;

  INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
  VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_payout', v_driver_net, NULL)
  ON CONFLICT (order_id, type) DO NOTHING;

  IF NEW.payment_method = 'cash' THEN
    v_cashback := round(v_products_da * v_cashback_rate)::INTEGER;
    v_cashback := LEAST(v_cashback,
                        (v_products_da / 2),
                        GREATEST(v_commission + v_service_fee + v_delivery_fee, 0));

    v_owes_merchant := GREATEST(v_products_da - v_commission, 0);
    v_owes_platform := GREATEST(v_commission + v_service_fee + v_driver_fee - v_cashback, 0);

    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_cash_collected', NEW.total_da, NULL)
    ON CONFLICT (order_id, type) DO NOTHING;

    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_owes_merchant', v_owes_merchant, NULL)
    ON CONFLICT (order_id, type) DO NOTHING;

    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_owes_platform', v_owes_platform, NULL)
    ON CONFLICT (order_id, type) DO NOTHING;

    UPDATE public.orders
       SET driver_owes_platform_da  = v_owes_platform,
           driver_owes_merchant_da  = v_owes_merchant,
           driver_cash_collected_da = NEW.total_da,
           cashback_rate_applied    = COALESCE(cashback_rate_applied, v_cashback_rate)
     WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. driver_report_no_show — l'indemnité plateforme (driver_payout) ne vaut que
--    pour l'EXPRESS. En tournée, le commerçant gère son livreur : on annule la
--    commande sans écriture livreur plateforme. (Reprend 0116, garde ajouté.)
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
  v_delivery_fee INTEGER;
  v_driver_fee   INTEGER;
  v_driver_net   INTEGER;
  v_reason       TEXT;
  v_wait         INTEGER;
  v_required_min INTEGER;
  v_client_replied BOOLEAN;
  v_liability    INTEGER;
  v_recovered    INTEGER := 0;
  v_take         INTEGER;
  v_bal          INTEGER;
  v_label        TEXT;
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

  v_delivery_fee := COALESCE(v_order.delivery_fee_da, 0);
  IF v_delivery_fee <= 0 THEN
    v_driver_fee := 0;
  ELSE
    v_driver_fee := LEAST(
      v_delivery_fee,
      GREATEST(v_s.driver_fee_min_da,
        LEAST(round(v_delivery_fee * v_s.driver_fee_rate)::INTEGER,
              round(v_delivery_fee * v_s.driver_fee_cap_rate)::INTEGER)));
  END IF;
  v_driver_net := v_delivery_fee - v_driver_fee;

  UPDATE public.orders
     SET status                  = 'cancelled',
         delivery_failed_at      = now(),
         delivery_failed_reason  = v_reason,
         driver_fee_rate_applied = v_s.driver_fee_rate,
         driver_fee_da           = v_driver_fee,
         driver_net_da           = v_driver_net
   WHERE id = p_order_id;

  INSERT INTO public.order_events (order_id, from_status, to_status, client_operation_id, note)
  VALUES (p_order_id, v_order.status, 'cancelled', NULL,
          'driver_no_show:' || v_reason || ':' || COALESCE(p_client_operation_id, ''))
  ON CONFLICT DO NOTHING;

  -- Indemnité livreur = EXPRESS uniquement (plateforme paie SON livreur). En
  -- tournée, le commerçant indemnise son propre livreur hors plateforme.
  IF v_driver_net > 0 AND v_order.delivery_mode = 'express' THEN
    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (v_driver_id, v_order.merchant_id, p_order_id, 'driver_payout', v_driver_net,
            'Indemnité course no-show (client absent/refus).')
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  -- Pénalité client (anti-abus) : prélèvement cashback puis Coligo Pay, sinon
  -- drapeau pénalité douce. Identique express/tournée.
  IF v_order.customer_id IS NOT NULL THEN
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

    PERFORM set_config('app.allow_risk_update', 'on', true);
    UPDATE public.customers
       SET noshow_count   = noshow_count + 1,
           noshow_pending = noshow_pending OR (v_liability - v_recovered) > 0
     WHERE id = v_order.customer_id;
  END IF;

  IF v_order.delivery_mode = 'express' THEN
    UPDATE public.driver_availability
       SET status = 'available', current_order_id = NULL
     WHERE current_order_id = p_order_id;
  END IF;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_report_no_show(UUID, TEXT, TEXT) TO authenticated;
