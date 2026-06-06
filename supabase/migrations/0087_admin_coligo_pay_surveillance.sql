-- =============================================================================
-- Coligo v3 - Migration 0087 : Surveillance / réconciliation Coligo Pay (admin)
-- =============================================================================
-- Deux fonctions SECURITY DEFINER STRICTEMENT gardées par is_super_admin() :
--   - admin_coligo_pay_overview() : métriques de circulation + contrôles
--     d'intégrité (réconciliation). Tout doit « tomber juste » (double-entrée=0,
--     aucun solde négatif).
--   - admin_coligo_pay_audit(limit) : journal d'audit unifié (recharges,
--     paiements marchand, transferts P2P), du plus récent au plus ancien.
--
-- Lecture seule. Aucune écriture. N'expose JAMAIS le PIN (table interdite).
-- =============================================================================

-- ============================================================================
-- 1. Vue d'ensemble + réconciliation
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_coligo_pay_overview()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v JSONB;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Accès refusé.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT jsonb_build_object(
    -- ── Circulation (passif : argent Coligo Pay dû aux clients) ───────────
    'circulation_da', COALESCE((
      SELECT SUM(amount_da) FROM public.customer_wallet_entries
      WHERE source = 'topup'), 0),
    'accounts_with_balance', COALESCE((
      SELECT count(*) FROM (
        SELECT customer_id FROM public.customer_wallet_entries
        WHERE source = 'topup'
        GROUP BY customer_id HAVING SUM(amount_da) > 0
      ) a), 0),

    -- ── Flux par source ──────────────────────────────────────────────────
    'recharges_count', COALESCE((
      SELECT count(*) FROM public.customer_wallet_entries
      WHERE type = 'topup_credit' AND chargily_checkout_id IS NOT NULL), 0),
    'recharges_da', COALESCE((
      SELECT SUM(amount_da) FROM public.customer_wallet_entries
      WHERE type = 'topup_credit' AND chargily_checkout_id IS NOT NULL), 0),
    'merchant_payments_count', COALESCE((
      SELECT count(*) FROM public.coligo_pay_payments), 0),
    'merchant_payments_da', COALESCE((
      SELECT SUM(amount_da) FROM public.coligo_pay_payments), 0),
    'merchant_payments_commission_da', COALESCE((
      SELECT SUM(commission_da) FROM public.coligo_pay_payments), 0),
    'transfers_count', COALESCE((
      SELECT count(*) FROM public.coligo_pay_transfers), 0),
    'transfers_da', COALESCE((
      SELECT SUM(amount_da) FROM public.coligo_pay_transfers), 0),

    -- ── Contrôles d'intégrité (réconciliation : tout doit valoir 0) ───────
    'negative_balances', COALESCE((
      SELECT count(*) FROM (
        SELECT customer_id FROM public.customer_wallet_entries
        WHERE source = 'topup'
        GROUP BY customer_id HAVING SUM(amount_da) < 0
      ) n), 0),
    'unbalanced_payments', COALESCE((
      SELECT count(*) FROM public.coligo_pay_payments p
      WHERE (
        COALESCE((SELECT SUM(amount_da) FROM public.customer_wallet_entries
                  WHERE coligo_pay_payment_id = p.id), 0)
      + COALESCE((SELECT SUM(amount_da) FROM public.wallet_entries
                  WHERE coligo_pay_payment_id = p.id), 0)
      + COALESCE((SELECT SUM(amount_da) FROM public.platform_ledger
                  WHERE coligo_pay_payment_id = p.id), 0)
      ) <> 0), 0),
    'unbalanced_transfers', COALESCE((
      SELECT count(*) FROM public.coligo_pay_transfers t
      WHERE COALESCE((SELECT SUM(amount_da) FROM public.customer_wallet_entries
                      WHERE coligo_pay_transfer_id = t.id), 0) <> 0), 0),
    'pin_locked_now', COALESCE((
      SELECT count(*) FROM public.customer_wallet_security
      WHERE locked_until IS NOT NULL AND locked_until > now()), 0),
    'generated_at', now()
  ) INTO v;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_coligo_pay_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_coligo_pay_overview() TO authenticated;

-- ============================================================================
-- 2. Journal d'audit unifié (recharges + paiements + transferts)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_coligo_pay_audit(p_limit INTEGER DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v JSONB;
  v_lim INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Accès refusé.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.at DESC), '[]'::jsonb)
  INTO v
  FROM (
    -- Paiements marchand
    SELECT p.created_at AS at, 'payment'::text AS kind, p.amount_da,
           p.commission_da,
           (SELECT full_name FROM public.customers WHERE id = p.customer_id) AS from_name,
           (SELECT name FROM public.merchants WHERE id = p.merchant_id) AS to_name,
           p.id::text AS ref
    FROM public.coligo_pay_payments p
    UNION ALL
    -- Transferts P2P
    SELECT t.created_at, 'transfer', t.amount_da, 0,
           (SELECT full_name FROM public.customers WHERE id = t.sender_customer_id),
           (SELECT full_name FROM public.customers WHERE id = t.recipient_customer_id),
           t.id::text
    FROM public.coligo_pay_transfers t
    UNION ALL
    -- Recharges (Chargily)
    SELECT e.created_at, 'recharge', e.amount_da, 0,
           NULL,
           (SELECT full_name FROM public.customers WHERE id = e.customer_id),
           e.chargily_checkout_id
    FROM public.customer_wallet_entries e
    WHERE e.type = 'topup_credit' AND e.chargily_checkout_id IS NOT NULL
    ORDER BY at DESC
    LIMIT v_lim
  ) s;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_coligo_pay_audit(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_coligo_pay_audit(INTEGER) TO authenticated;

-- =============================================================================
-- VÉRIF (en session super-admin) :
--   SELECT public.admin_coligo_pay_overview();
--   SELECT public.admin_coligo_pay_audit(20);
-- =============================================================================
