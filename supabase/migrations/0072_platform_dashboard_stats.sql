-- =============================================================================
-- 0072 — Statistiques plateforme pour le tableau de bord SUPER-ADMIN
-- =============================================================================
-- Deux fonctions SECURITY DEFINER, STRICTEMENT gardées par is_super_admin() :
-- l'agrégation se fait côté SQL (précis + performant, pas de tirage de milliers
-- de lignes côté app). Sécurité : tout appelant non super-admin reçoit une
-- exception (insufficient_privilege).
--
-- Modèle de profit (cf. platform_ledger, mig 0010/0013) :
--   revenus  (+) : commission_income (commission sur marchandises),
--                  service_fee_income (frais de service)
--   coûts    (-) : chargily_fee, cashback_expense
--   => bénéfice net plateforme = SUM(platform_ledger.amount_da)
-- Livraison : en MVP le driver_payout = delivery_fee (marge plateforme = 0).
-- Cashback : earned (+) / spent (-) ; encours non consommé = SUM(source=cashback).
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
    -- Commerçants
    'merchants_total',
      (SELECT count(*) FROM public.merchants),
    'merchants_active',
      (SELECT count(*) FROM public.merchants WHERE is_active),
    'merchants_sold',
      (SELECT count(DISTINCT merchant_id) FROM public.orders
        WHERE status = 'completed'),
    -- Volume d'affaires (marchandises livrées)
    'orders_completed',
      (SELECT count(*) FROM public.orders WHERE status = 'completed'),
    'gmv_da',
      (SELECT COALESCE(SUM(total_da), 0) FROM public.orders
        WHERE status = 'completed'),
    -- Profit plateforme (platform_ledger : revenus +, coûts -)
    'net_profit_da',
      (SELECT COALESCE(SUM(amount_da), 0) FROM public.platform_ledger),
    'commission_income_da',
      (SELECT COALESCE(SUM(amount_da), 0) FROM public.platform_ledger
        WHERE type = 'commission_income'),
    'service_fee_income_da',
      (SELECT COALESCE(SUM(amount_da), 0) FROM public.platform_ledger
        WHERE type = 'service_fee_income'),
    'chargily_fee_da',
      (SELECT COALESCE(SUM(amount_da), 0) FROM public.platform_ledger
        WHERE type = 'chargily_fee'),
    'cashback_expense_da',
      (SELECT COALESCE(SUM(amount_da), 0) FROM public.platform_ledger
        WHERE type = 'cashback_expense'),
    -- Paiement en ligne : bénéfice net issu des commandes online
    'online_orders',
      (SELECT count(*) FROM public.orders
        WHERE status = 'completed' AND payment_method = 'online'
          AND payment_status = 'paid'),
    'online_net_da',
      (SELECT COALESCE(SUM(pl.amount_da), 0)
         FROM public.platform_ledger pl
         JOIN public.orders o ON o.id = pl.order_id
        WHERE o.payment_method = 'online'),
    -- Livraison
    'delivery_orders',
      (SELECT count(*) FROM public.orders
        WHERE status = 'completed' AND fulfillment_type = 'delivery'),
    'delivery_fees_da',
      (SELECT COALESCE(SUM(delivery_fee_da), 0) FROM public.orders
        WHERE status = 'completed' AND fulfillment_type = 'delivery'),
    'driver_payouts_da',
      (SELECT COALESCE(SUM(amount_da), 0) FROM public.delivery_ledger
        WHERE type = 'driver_payout'),
    -- Cashback
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

-- Détail par commerçant (top par chiffre d'affaires).
CREATE OR REPLACE FUNCTION public.platform_merchant_rows()
RETURNS TABLE (
  id uuid,
  name text,
  city text,
  is_active boolean,
  is_frozen boolean,
  completed_orders bigint,
  gmv_da bigint,
  commission_da bigint,
  balance_da bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Accès réservé aux super-administrateurs.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.name,
    m.city,
    m.is_active,
    m.is_frozen,
    COALESCE(o.cnt, 0)::bigint,
    COALESCE(o.gmv, 0)::bigint,
    COALESCE(pl.comm, 0)::bigint,
    COALESCE(w.bal, 0)::bigint
  FROM public.merchants m
  LEFT JOIN (
    SELECT merchant_id, count(*) AS cnt, SUM(total_da) AS gmv
    FROM public.orders WHERE status = 'completed' GROUP BY merchant_id
  ) o ON o.merchant_id = m.id
  LEFT JOIN (
    SELECT merchant_id, SUM(amount_da) AS bal
    FROM public.wallet_entries GROUP BY merchant_id
  ) w ON w.merchant_id = m.id
  LEFT JOIN (
    SELECT o2.merchant_id, SUM(pl2.amount_da) AS comm
    FROM public.platform_ledger pl2
    JOIN public.orders o2 ON o2.id = pl2.order_id
    WHERE pl2.type = 'commission_income'
    GROUP BY o2.merchant_id
  ) pl ON pl.merchant_id = m.id
  ORDER BY COALESCE(o.gmv, 0) DESC, m.name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_merchant_rows() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_merchant_rows() TO authenticated;
