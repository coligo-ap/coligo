-- =============================================================================
-- 0128 — Annulation : ne PAS payer le commerçant + rembourser le bon montant
-- =============================================================================
-- Deux corrections sur le flux d'annulation :
--
-- FIX B (fuite préexistante) — Le commerçant était crédité dès le PAIEMENT online
--   (sale + commission), donc une commande online PAYÉE puis ANNULÉE laissait le
--   commerçant crédité (argent pour rien) + le client remboursé → double perte.
--   Correctif : commerçant/plateforme crédités à la COMPLÉTION (fulfillment),
--   cash ET online. Une commande annulée (jamais complétée) ne crédite personne.
--
-- FIX A (régression du correctif « livraison facturée online ») — Depuis qu'on
--   facture la livraison par carte, le remboursement doit rendre le MONTANT CARTE
--   COMPLET = total_da (et non total_da − livraison). Les soldes wallet dépensés
--   (cashback/Coligo Pay) restent re-crédités à part par les triggers d'annulation.
--   Corrigé dans les 3 fonctions : client / commerçant / super-admin.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- FIX B — crédit commerçant/plateforme à la COMPLÉTION (reprend 0127, seule la
-- condition de déclenchement `v_generate` change).
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
  -- Crédit à la COMPLÉTION (fulfillment), cash ET online. Online : le paiement
  -- est une condition NÉCESSAIRE (gating 0068) mais pas suffisante — sinon une
  -- commande payée puis annulée créditerait le commerçant.
  v_generate := (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed');
  IF v_generate AND NEW.payment_method <> 'cash'
     AND NEW.payment_status <> 'paid' THEN
    v_generate := false;   -- sécurité : online non encaissé → on ne crédite pas.
  END IF;

  IF NOT v_generate THEN
    RETURN NEW;
  END IF;

  -- COD EXPRESS : custodian livreur (delivery_ledger / 0124). Pas d'écriture ici.
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

  v_cashback := round(v_products_da * v_cash_rate)::INTEGER;
  IF NEW.payment_method = 'cash' THEN
    v_cashback := LEAST(v_cashback,
                        (v_products_da / 2),
                        GREATEST(v_commission + v_service_fee + v_delivery_fee, 0));
  END IF;

  v_is_tour := (NEW.fulfillment_type = 'delivery' AND NEW.delivery_mode = 'tour');
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
-- FIX A — remboursement = MONTANT CARTE COMPLET (total_da). Les 3 fonctions.
-- ---------------------------------------------------------------------------

-- 1) Client (reprend 0075, anti-fraude inclus).
CREATE OR REPLACE FUNCTION public.cancel_order_by_customer(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer    uuid;
  v_order       RECORD;
  v_online_paid boolean := false;
  v_refund      integer := 0;
  v_cap         integer;
  v_prior       integer;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'Profil client introuvable.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, customer_id, merchant_id, status, payment_method, payment_status,
         order_number, customer_name, total_da, delivery_fee_da
    INTO v_order
  FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commande introuvable.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_order.customer_id IS DISTINCT FROM v_customer THEN
    RAISE EXCEPTION 'Cette commande ne t''appartient pas.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_order.status <> 'pending' THEN
    RAISE EXCEPTION 'Trop tard : le commerçant a déjà pris ta commande en charge.'
      USING ERRCODE = 'check_violation';
  END IF;

  v_online_paid := (v_order.payment_method = 'online' AND v_order.payment_status = 'paid');

  IF v_online_paid THEN
    SELECT COALESCE(max_online_refund_cancels_30d, 3) INTO v_cap
    FROM public.platform_settings WHERE id = true;
    SELECT count(*) INTO v_prior
    FROM public.orders
    WHERE customer_id = v_customer AND payment_method = 'online'
      AND cancelled_by = 'customer' AND payment_status = 'refunded'
      AND created_at >= now() - INTERVAL '30 days';
    IF v_prior >= COALESCE(v_cap, 3) THEN
      RAISE EXCEPTION 'Cette commande ne bénéficie pas d''un remboursement après plusieurs annulations. Merci de la récupérer.'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Montant CARTE complet (la livraison est désormais encaissée par carte).
    v_refund := GREATEST(0, COALESCE(v_order.total_da, 0));
  END IF;

  UPDATE public.orders
  SET status = 'cancelled', cancelled_by = 'customer',
      payment_status = CASE WHEN v_online_paid THEN 'refunded' ELSE payment_status END
  WHERE id = p_order_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La commande vient de changer d''état, réessaie.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.order_events (order_id, from_status, to_status, note)
  VALUES (p_order_id, 'pending', 'cancelled', 'Annulée par le client');

  IF v_refund > 0 THEN
    INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
    VALUES (v_order.customer_id, NULL, 'topup_credit', 'topup', v_refund,
            'Remboursement commande ' || COALESCE('#' || v_order.order_number, '')
              || ' (annulée) — crédité sur Coligo Pay.');
  END IF;

  RETURN jsonb_build_object('ok', true, 'merchant_id', v_order.merchant_id,
    'order_number', v_order.order_number, 'customer_name', v_order.customer_name,
    'refunded_to_coligo_pay', v_refund);
END;
$$;

-- 2) Super-admin.
CREATE OR REPLACE FUNCTION public.admin_cancel_order(
  p_order_id UUID, p_reason TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_order   public.orders%ROWTYPE;
  v_from    TEXT;
  v_reason  TEXT := COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Annulation plateforme');
  v_refund  INTEGER := 0;
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  IF v_order.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_terminal');
  END IF;

  v_from := v_order.status::text;
  UPDATE public.orders SET status = 'cancelled', cancelled_by = 'system' WHERE id = p_order_id;

  IF v_order.payment_method = 'online' AND v_order.payment_status = 'paid' THEN
    v_refund := GREATEST(0, COALESCE(v_order.total_da, 0));   -- montant carte complet
    UPDATE public.orders SET payment_status = 'refunded' WHERE id = p_order_id;
    IF v_refund > 0 THEN
      INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
      VALUES (v_order.customer_id, NULL, 'topup_credit', 'topup', v_refund,
        'Remboursement commande #' || COALESCE(v_order.order_number, left(p_order_id::text, 6))
          || ' (annulée par la plateforme) — crédité sur Coligo Pay.');
    END IF;
  END IF;

  INSERT INTO public.order_events (order_id, from_status, to_status, note)
    VALUES (p_order_id, v_order.status, 'cancelled',
            'Annulée par la plateforme — ' || v_reason || ' (statut avant : ' || v_from || ')')
    ON CONFLICT DO NOTHING;

  IF v_order.delivery_mode = 'express' THEN
    UPDATE public.driver_availability SET status = 'available', current_order_id = NULL
      WHERE current_order_id = p_order_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'from_status', v_from, 'refunded_da', v_refund,
    'merchant_id', v_order.merchant_id, 'order_number', v_order.order_number,
    'customer_name', v_order.customer_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 3) Commerçant.
CREATE OR REPLACE FUNCTION public.merchant_cancel_order(
  p_order_id UUID, p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_order  public.orders%ROWTYPE;
  v_from   TEXT;
  v_reason TEXT := COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Client injoignable');
  v_refund INTEGER := 0;
  v_owner  BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = v_order.merchant_id AND m.user_id = auth.uid())
    INTO v_owner;
  IF NOT v_owner AND NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF v_order.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_terminal');
  END IF;
  IF v_order.delivery_picked_up_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_picked_up');
  END IF;

  v_from := v_order.status::text;
  UPDATE public.orders SET status = 'cancelled', cancelled_by = 'merchant' WHERE id = p_order_id;

  IF v_order.payment_method = 'online' AND v_order.payment_status = 'paid' THEN
    v_refund := GREATEST(0, COALESCE(v_order.total_da, 0));   -- montant carte complet
    UPDATE public.orders SET payment_status = 'refunded' WHERE id = p_order_id;
    IF v_refund > 0 THEN
      INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
      VALUES (v_order.customer_id, NULL, 'topup_credit', 'topup', v_refund,
        'Remboursement commande #' || COALESCE(v_order.order_number, left(p_order_id::text, 6))
          || ' (annulée par le commerçant) — crédité sur Coligo Pay.');
    END IF;
  END IF;

  INSERT INTO public.order_events (order_id, from_status, to_status, note)
    VALUES (p_order_id, v_order.status, 'cancelled',
            'Annulée par le commerçant — ' || v_reason || ' (statut avant : ' || v_from || ')')
    ON CONFLICT DO NOTHING;

  IF v_order.delivery_mode = 'express' THEN
    UPDATE public.driver_availability SET status = 'available', current_order_id = NULL
      WHERE current_order_id = p_order_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'from_status', v_from, 'refunded_da', v_refund,
    'order_number', v_order.order_number);
END;
$$;
