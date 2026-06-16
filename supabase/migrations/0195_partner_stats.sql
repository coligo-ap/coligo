-- =============================================================================
-- 0195 — Statistiques du point de recharge (tableau de bord partenaire)
-- =============================================================================
-- Pour le portail partenaire : solde, total rechargé (achats de crédit),
-- total revendu (envois aux opérateurs), bonus reçus, nb de reventes.
-- Résolu par session via my_operator_wallet().
-- =============================================================================

CREATE OR REPLACE FUNCTION public.my_partner_stats()
RETURNS TABLE (
  balance_da     INTEGER,
  total_topup_da INTEGER,
  total_sold_da  INTEGER,
  total_bonus_da INTEGER,
  sales_count    INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH w AS (SELECT public.my_operator_wallet() AS id)
  SELECT
    COALESCE(SUM(e.amount_da), 0)::INTEGER,
    COALESCE(SUM(e.amount_da) FILTER (
      WHERE e.type IN ('topup_chargily','topup_manual','topup_partner')
    ), 0)::INTEGER,
    COALESCE(-SUM(e.amount_da) FILTER (WHERE e.type = 'recharge_sale'), 0)::INTEGER,
    COALESCE(SUM(e.amount_da) FILTER (WHERE e.type = 'bonus'), 0)::INTEGER,
    COALESCE(COUNT(*) FILTER (WHERE e.type = 'recharge_sale'), 0)::INTEGER
  FROM w
  LEFT JOIN public.operator_wallet_entries e ON e.wallet_id = w.id;
$$;
GRANT EXECUTE ON FUNCTION public.my_partner_stats() TO authenticated;
