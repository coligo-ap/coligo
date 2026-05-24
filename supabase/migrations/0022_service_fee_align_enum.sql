-- =============================================================================
-- Coligo v3 - Migration 0022 : alignement enum service_fee
-- =============================================================================
-- La migration 0013 avait déjà créé la valeur d'enum `service_fee` (et le
-- code TS `lib/data/wallet.ts` l'utilise). La migration 0020 a ajouté en plus
-- `service_fee_owed`, et 0021 a écrit son trigger avec ce nom-là. Résultat :
-- deux valeurs d'enum cohabitent et seule `service_fee_owed` est utilisée par
-- le trigger, alors que le code applicatif lit `service_fee`.
--
-- On rétablit `service_fee` (nom canonique, déjà câblé dans le code TS) en
-- redéclarant la fonction sans toucher à l'enum (les deux valeurs restent
-- présentes : `service_fee_owed` devient orpheline mais inoffensive).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.generate_wallet_entries_on_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_generate    BOOLEAN := false;
  v_comm_rate   NUMERIC(5, 4);
  v_cash_rate   NUMERIC(5, 4);
  v_fee_rate    NUMERIC(5, 4);
  v_products_da INTEGER;
  v_service_fee INTEGER;
  v_commission  INTEGER;
  v_cashback    INTEGER;
  v_chargily    INTEGER;
BEGIN
  IF NEW.payment_method = 'cash' THEN
    v_generate := (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed');
  ELSE
    v_generate := (NEW.payment_status = 'paid' AND OLD.payment_status IS DISTINCT FROM 'paid');
  END IF;

  IF NOT v_generate THEN
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

  -- products_da = base de calcul commission/cashback (exclut service_fee).
  v_products_da := GREATEST(0, NEW.subtotal_da - NEW.discount_da);
  v_service_fee := COALESCE(NEW.service_fee_da, 0);
  v_commission  := round(v_products_da * v_comm_rate)::INTEGER;
  v_cashback    := round(v_products_da * v_cash_rate)::INTEGER;
  v_chargily    := round(NEW.total_da * v_fee_rate)::INTEGER;

  UPDATE public.orders
  SET commission_rate_applied   = v_comm_rate,
      cashback_rate_applied     = v_cash_rate,
      chargily_fee_rate_applied = v_fee_rate
  WHERE id = NEW.id;

  -- WALLET COMMERÇANT.
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

  -- COMPTA COLIGO.
  INSERT INTO public.platform_ledger (order_id, type, amount_da)
  VALUES (NEW.id, 'commission_income', v_commission)
  ON CONFLICT (order_id, type) DO NOTHING;

  IF v_service_fee > 0 THEN
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NEW.id, 'service_fee_income', v_service_fee)
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
$$;
