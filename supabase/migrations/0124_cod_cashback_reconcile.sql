-- =============================================================================
-- 0124 — Réconciliation COD : cashback gagné/dépensé + Coligo Pay (fuites #2 & #3)
-- =============================================================================
-- AUDIT (2026-06-10) — deux déséquilibres prouvés sur le custodian livreur (COD) :
--
--   FUITE #3 — cashback GAGNÉ en COD : l'ancien `owes_platform` soustrayait le
--     cashback gagné (round(produits × taux)). En COD, « le livreur reverse
--     moins » ne crédite PAS le client : le cash filait dans la poche du livreur,
--     ET le client était crédité par ailleurs (0118) → cashback financé DEUX fois.
--
--   FUITE #2 — cashback/Coligo Pay DÉPENSÉS en COD : `owes_platform` ne tenait
--     PAS compte de cashback_used_da/topup_used_da. Le livreur encaisse moins de
--     cash (le client a payé une partie en wallet) mais devait reverser autant
--     → livreur EN DÉFICIT.
--
-- CORRECTIF (résidu livreur = 0, prouvé) :
--   owes_platform = commission + frais_service + driver_fee − cashback_used − topup_used   (SIGNÉ)
--   • on RETIRE le terme « − cashback_gagné » (il ne doit pas réduire le cash dû) ;
--   • on SOUSTRAIT les montants DÉPENSÉS (la plateforme absorbe : elle détenait le
--     Coligo Pay, et le cashback dépensé éteint un passif déjà provisionné) ;
--   • `owes_platform` peut être NÉGATIF = la plateforme DOIT au livreur (il a
--     beaucoup avancé au commerçant, le client a payé en wallet) → réglé au relevé.
--   • le cashback GAGNÉ est désormais provisionné comme CHARGE plateforme
--     (`platform_ledger.cashback_expense`) — en COD le trigger wallet est skip,
--     donc c'est ici qu'on l'enregistre (cohérent avec le crédit client de 0118).
--
-- Réconciliation : driver_cash_collected − owes_merchant − owes_platform − payout
--   = (P+S+D−C−T) − (P−comm) − (comm+S+df−C−T) − (D−df) = 0  ✅
-- =============================================================================

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
  v_cashback        INTEGER;   -- cashback GAGNÉ (provisionné en charge)
  v_redeemed        INTEGER;   -- cashback + Coligo Pay DÉPENSÉS par le client
  v_owes_merchant   INTEGER;
  v_owes_platform   INTEGER;   -- SIGNÉ
BEGIN
  -- Custodian = EXPRESS uniquement (la tournée passe par le wallet commerçant).
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
     SET driver_fee_rate_applied = v_s.driver_fee_rate,
         driver_fee_da           = v_driver_fee,
         driver_net_da           = v_driver_net,
         commission_rate_applied = COALESCE(commission_rate_applied, v_comm_rate),
         commission_da           = COALESCE(commission_da, v_commission)
   WHERE id = NEW.id;

  INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
  VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_payout', v_driver_net, NULL)
  ON CONFLICT (order_id, type) DO NOTHING;

  IF NEW.payment_method = 'cash' THEN
    -- Cashback GAGNÉ (même plafond que le crédit client 0118) → provisionné en charge.
    v_cashback := round(v_products_da * v_cashback_rate)::INTEGER;
    v_cashback := LEAST(v_cashback,
                        (v_products_da / 2),
                        GREATEST(v_commission + v_service_fee + v_delivery_fee, 0));

    -- Wallet DÉPENSÉ par le client (cashback + Coligo Pay) : réduit le cash encaissé
    -- ET ce que le livreur reverse (absorbé par la plateforme).
    v_redeemed := GREATEST(0, COALESCE(NEW.cashback_used_da, 0) + COALESCE(NEW.topup_used_da, 0));

    v_owes_merchant := GREATEST(v_products_da - v_commission, 0);
    -- SIGNÉ : peut être négatif = la plateforme doit au livreur (réglé au relevé).
    v_owes_platform := v_commission + v_service_fee + v_driver_fee - v_redeemed;

    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_cash_collected', NEW.total_da, NULL)
    ON CONFLICT (order_id, type) DO NOTHING;

    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_owes_merchant', v_owes_merchant, NULL)
    ON CONFLICT (order_id, type) DO NOTHING;

    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_owes_platform', v_owes_platform, NULL)
    ON CONFLICT (order_id, type) DO NOTHING;

    -- Charge cashback plateforme (en COD le trigger wallet est skip → c'est ici).
    IF v_cashback > 0 THEN
      INSERT INTO public.platform_ledger (order_id, type, amount_da)
      VALUES (NEW.id, 'cashback_expense', -v_cashback)
      ON CONFLICT (order_id, type) DO NOTHING;
    END IF;

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
