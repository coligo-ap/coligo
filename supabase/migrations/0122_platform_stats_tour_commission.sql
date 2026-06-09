-- =============================================================================
-- 0122 — Tableau de bord super-admin : détail du revenu commission TOURNÉE
-- =============================================================================
-- `net_profit_da` = SUM(platform_ledger) inclut DÉJÀ le nouveau revenu
-- `tour_delivery_commission_income` (le bénéfice net est donc déjà correct).
-- On ajoute simplement la LIGNE DE DÉTAIL pour le rendre visible dans le
-- tableau de bord finances. (Reprend 0072 à l'identique + une clé.)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.platform_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Accès réservé aux super-administrateurs.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT jsonb_build_object(
    'merchants_total',
      (SELECT count(*) FROM public.merchants),
    'merchants_active',
      (SELECT count(*) FROM public.merchants WHERE is_active),
    'merchants_sold',
      (SELECT count(DISTINCT merchant_id) FROM public.orders
        WHERE status = 'completed'),
    'orders_completed',
      (SELECT count(*) FROM public.orders WHERE status = 'completed'),
    'gmv_da',
      (SELECT COALESCE(SUM(total_da), 0) FROM public.orders
        WHERE status = 'completed'),
    'net_profit_da',
      (SELECT COALESCE(SUM(amount_da), 0) FROM public.platform_ledger),
    'commission_income_da',
      (SELECT COALESCE(SUM(amount_da), 0) FROM public.platform_ledger
        WHERE type = 'commission_income'),
    'service_fee_income_da',
      (SELECT COALESCE(SUM(amount_da), 0) FROM public.platform_ledger
        WHERE type = 'service_fee_income'),
    'tour_delivery_commission_income_da',
      (SELECT COALESCE(SUM(amount_da), 0) FROM public.platform_ledger
        WHERE type = 'tour_delivery_commission_income'),
    'chargily_fee_da',
      (SELECT COALESCE(SUM(amount_da), 0) FROM public.platform_ledger
        WHERE type = 'chargily_fee'),
    'cashback_expense_da',
      (SELECT COALESCE(SUM(amount_da), 0) FROM public.platform_ledger
        WHERE type = 'cashback_expense'),
    'online_orders',
      (SELECT count(*) FROM public.orders
        WHERE status = 'completed' AND payment_method = 'online'
          AND payment_status = 'paid'),
    'online_net_da',
      (SELECT COALESCE(SUM(pl.amount_da), 0)
         FROM public.platform_ledger pl
         JOIN public.orders o ON o.id = pl.order_id
        WHERE o.payment_method = 'online'),
    'delivery_orders',
      (SELECT count(*) FROM public.orders
        WHERE status = 'completed' AND fulfillment_type = 'delivery'),
    'delivery_fees_da',
      (SELECT COALESCE(SUM(delivery_fee_da), 0) FROM public.orders
        WHERE status = 'completed' AND fulfillment_type = 'delivery'),
    -- Frais de livraison EXPRESS uniquement (les frais TOURNÉE vont au commerçant,
    -- la plateforme n'en touche que la commission). Sert au calcul de marge juste.
    'express_delivery_fees_da',
      (SELECT COALESCE(SUM(delivery_fee_da), 0) FROM public.orders
        WHERE status = 'completed' AND fulfillment_type = 'delivery'
          AND delivery_mode = 'express'),
    'driver_payouts_da',
      (SELECT COALESCE(SUM(amount_da), 0) FROM public.delivery_ledger
        WHERE type = 'driver_payout'),
    'cashback_earned_da',
      (SELECT COALESCE(SUM(amount_da), 0) FROM public.customer_wallet_entries
        WHERE type = 'cashback_earned'),
    'cashback_spent_da',
      (SELECT COALESCE(-SUM(amount_da), 0) FROM public.customer_wallet_entries
        WHERE type = 'cashback_spent'),
    'cashback_outstanding_da',
      (SELECT COALESCE(SUM(amount_da), 0) FROM public.customer_wallet_entries
        WHERE source = 'cashback'),
    'topup_outstanding_da',
      (SELECT COALESCE(SUM(amount_da), 0) FROM public.customer_wallet_entries
        WHERE source = 'topup')
  ) INTO v;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_dashboard_stats() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_dashboard_stats() TO authenticated;
