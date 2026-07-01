-- =============================================================================
-- 0298 — Fonction d'intégrité `integrity_violations()` (source unique)
-- =============================================================================
-- Regroupe en UNE fonction SQL les invariants financiers / d'état vérifiés
-- jusqu'ici par le script CLI `scripts/audit-integrity.mjs`. Elle renvoie UNE
-- LIGNE PAR INVARIANT VIOLÉ (donc AUCUNE ligne = base saine). Utilisée par :
--   • le cron /api/cron/integrity (surveillance quotidienne + alerte) ;
--   • le script CLI (refactoré pour l'appeler → une seule vérité) ;
--   • potentiellement l'alerte super-admin (via la trace admin_audit_log).
--
-- SECURITY DEFINER + REVOKE authenticated/anon : appelée uniquement par le
-- service_role (cron) — jamais exposée au client.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.integrity_violations()
RETURNS TABLE(code text, severity text, cnt int, detail text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- GATING 0068 : online payé/remboursé DOIT avoir un numéro
  SELECT 'gating_paid_no_number', 'critical', count(*)::int,
         'commande online payée sans order_number'
    FROM public.orders
   WHERE payment_method='online' AND payment_status IN ('paid','refunded')
     AND (order_number IS NULL OR order_number='')
  HAVING count(*) > 0

  UNION ALL
  -- GATING 0068 : online NON payé ne DOIT PAS avoir de numéro (fuite commerçant)
  SELECT 'gating_unpaid_has_number', 'critical', count(*)::int,
         'commande online non payée avec order_number (visible commerçant)'
    FROM public.orders
   WHERE payment_method='online' AND payment_status NOT IN ('paid','refunded')
     AND order_number IS NOT NULL AND order_number<>''
  HAVING count(*) > 0

  UNION ALL
  -- Commande online complétée mais non payée
  SELECT 'online_completed_unpaid', 'critical', count(*)::int,
         'commande online completed mais non payée'
    FROM public.orders
   WHERE payment_method='online' AND status='completed'
     AND payment_status NOT IN ('paid','refunded')
  HAVING count(*) > 0

  UNION ALL
  -- Solde Coligo Pay (topup) négatif
  SELECT 'topup_balance_negative', 'critical', count(*)::int,
         'client avec solde Coligo Pay négatif'
    FROM public.customers cu
   WHERE public.customer_topup_balance(cu.id) < 0
  HAVING count(*) > 0

  UNION ALL
  -- Solde cashback négatif
  SELECT 'cashback_balance_negative', 'critical', count(*)::int,
         'client avec solde cashback négatif'
    FROM public.customers cu
   WHERE public.customer_cashback_balance(cu.id) < 0
  HAVING count(*) > 0

  UNION ALL
  -- Dérive : SUM(grand livre topup) != solde renvoyé par la RPC
  SELECT 'topup_ledger_drift', 'critical', count(*)::int,
         'écart entre SUM(ledger topup) et customer_topup_balance()'
    FROM public.customers cu
   WHERE COALESCE((SELECT SUM(amount_da) FROM public.customer_wallet_entries e
                    WHERE e.customer_id=cu.id AND e.source='topup'),0)
         <> public.customer_topup_balance(cu.id)
  HAVING count(*) > 0

  UNION ALL
  -- P2P Coligo Pay : chaque transfert doit sommer à 0
  SELECT 'p2p_transfer_unbalanced', 'critical', count(*)::int,
         'transfert P2P Coligo Pay non équilibré (SUM<>0)'
    FROM (
      SELECT coligo_pay_transfer_id
        FROM public.customer_wallet_entries
       WHERE coligo_pay_transfer_id IS NOT NULL
       GROUP BY 1 HAVING SUM(amount_da) <> 0
    ) t
  HAVING count(*) > 0

  UNION ALL
  -- Paiement marchand Coligo Pay : débit client = -montant du paiement
  SELECT 'coligo_pay_payment_mismatch', 'critical', count(*)::int,
         'paiement marchand Coligo Pay : débit client != -montant'
    FROM (
      SELECT p.id
        FROM public.coligo_pay_payments p
        LEFT JOIN public.customer_wallet_entries e ON e.coligo_pay_payment_id=p.id
       GROUP BY p.id, p.amount_da
      HAVING COALESCE(SUM(e.amount_da),0) <> -p.amount_da
    ) t
  HAVING count(*) > 0

  UNION ALL
  -- Transfert opérateur inter-portefeuilles : SUM = 0
  SELECT 'operator_transfer_unbalanced', 'critical', count(*)::int,
         'transfert opérateur inter-portefeuilles non équilibré (SUM<>0)'
    FROM (
      SELECT client_operation_id
        FROM public.operator_wallet_entries
       WHERE counterparty_wallet_id IS NOT NULL
       GROUP BY 1 HAVING SUM(amount_da) <> 0
    ) t
  HAVING count(*) > 0

  UNION ALL
  -- Cohérence : commande livrée sans livreur attribué
  SELECT 'delivered_without_driver', 'warning', count(*)::int,
         'commande delivery livrée sans delivery_driver_id'
    FROM public.orders
   WHERE fulfillment_type='delivery' AND delivery_delivered_at IS NOT NULL
     AND delivery_driver_id IS NULL
  HAVING count(*) > 0;
$$;

REVOKE ALL ON FUNCTION public.integrity_violations()
  FROM PUBLIC, authenticated, anon;
