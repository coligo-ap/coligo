-- =============================================================================
-- 0125 — Cashback CASH hors-COD : provisionner la charge (retrait + tournée cash)
-- =============================================================================
-- Avec cashback_cash > 0 (réglé à 2 %), une commande CASH hors-COD (retrait sur
-- place, ou tournée cash) crédite le client (trigger 0118) mais l'ancien
-- generate_wallet_entries_on_completion ne provisionnait `cashback_expense`
-- QU'EN ONLINE → charge plateforme sous-estimée et écriture non équilibrée.
--
-- Correctif : on provisionne `cashback_expense` (et `cashback_grants`) pour CASH
-- ET online, avec le MÊME plafond COD que le crédit client (0118/0124) en cash.
-- Le frais Chargily reste réservé à l'online. Le cas COD express (custodian) est
-- toujours skippé ici et géré par 0124.
-- =============================================================================

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

  -- COD EXPRESS : le livreur est custodian (delivery_ledger / 0124). Pas d'écriture ici.
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

  -- Cashback GAGNÉ = montant CRÉDITÉ au client (0118). En CASH : même plafond COD
  -- (≤ panier/2, ≤ commission+service+livraison). En online : non plafonné.
  v_cashback := round(v_products_da * v_cash_rate)::INTEGER;
  IF NEW.payment_method = 'cash' THEN
    v_cashback := LEAST(v_cashback,
                        (v_products_da / 2),
                        GREATEST(v_commission + v_service_fee + v_delivery_fee, 0));
  END IF;

  -- Commission TOURNÉE sur les frais de livraison (le commerçant encaisse D).
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

  -- Frais Chargily : online uniquement (coût du PSP).
  IF NEW.payment_method = 'online' AND v_chargily > 0 THEN
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NEW.id, 'chargily_fee', -v_chargily)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  -- Cashback : provisionné pour CASH **et** online (= ce qui est crédité au
  -- client par 0118). Le cas COD express est traité par 0124 (custodian).
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
