-- =============================================================================
-- 0296 — Alerte FINANCES : paiement reçu APRÈS annulation de la commande
-- =============================================================================
-- Edge-case du flux paiement en ligne (cf. mig 0295 + commit 04a2371) : une
-- commande online abandonnée est annulée par le filet d'expiration, PUIS le
-- client paie quand même sur un checkout Chargily encore ouvert. Le webhook
-- `checkout.paid` ne peut plus marquer 'paid' (commande cancelled/failed) → il
-- RECRÉDITE le montant sur le Coligo Pay du client (jamais débité sans
-- contrepartie) et TRACE l'incident dans `admin_audit_log`
-- (action='paid_after_cancel', une fois par incident, idempotent via le crédit).
--
-- Ces incidents nécessitent une RÉCONCILIATION humaine (un vrai paiement a été
-- encaissé pour une commande morte) → on les remonte comme alerte super-admin
-- (domaine finances, warning), sur une fenêtre glissante de 7 jours.
--
-- CREATE OR REPLACE de _admin_alert_rules_finances() : on conserve les 4 règles
-- de 0289 (payouts / topup / partner_docs / operator_negative) + la nouvelle.
-- L'agrégateur n'a pas besoin de changer (finances déjà dans l'UNION depuis 0275).
-- =============================================================================

CREATE OR REPLACE FUNCTION public._admin_alert_rules_finances()
RETURNS TABLE (
  code text, domain text, severity text, prio int,
  count int, since timestamptz, label text, href text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Versements commerçant à traiter
  SELECT 'payouts_pending', 'finances',
         CASE WHEN MIN(pr.created_at) < now() - interval '3 days'
              THEN 'warning' ELSE 'info' END,
         CASE WHEN MIN(pr.created_at) < now() - interval '3 days' THEN 2 ELSE 1 END,
         COUNT(*)::int, MIN(pr.created_at),
         'Versements à traiter', '/admin/versements'
    FROM public.payout_requests pr
   WHERE pr.status IN ('pending','approved')
  HAVING COUNT(*) > 0

  UNION ALL
  -- Preuves de recharge wallet à valider
  SELECT 'topup_pending', 'finances',
         CASE WHEN MIN(tr.created_at) < now() - interval '24 hours'
              THEN 'warning' ELSE 'info' END,
         CASE WHEN MIN(tr.created_at) < now() - interval '24 hours' THEN 2 ELSE 1 END,
         COUNT(*)::int, MIN(tr.created_at),
         'Preuves de recharge à valider', '/admin/recharges'
    FROM public.wallet_topup_requests tr
   WHERE tr.status = 'pending'
  HAVING COUNT(*) > 0

  UNION ALL
  -- Pièces d'Agent Coligo Pay à valider (agents distincts)
  SELECT 'partner_docs_pending', 'finances',
         CASE WHEN MIN(pd.created_at) < now() - interval '24 hours'
              THEN 'warning' ELSE 'info' END,
         CASE WHEN MIN(pd.created_at) < now() - interval '24 hours' THEN 2 ELSE 1 END,
         COUNT(DISTINCT pd.wallet_id)::int, MIN(pd.created_at),
         'Agents à valider (pièces)', '/admin/agents'
    FROM public.partner_documents pd
   WHERE pd.status = 'pending'
  HAVING COUNT(*) > 0

  UNION ALL
  -- Portefeuilles opérateur en dépassement (sur-débiteurs)
  SELECT 'operator_wallets_negative', 'finances', 'warning', 2,
         COUNT(*)::int, NULL::timestamptz,
         'Portefeuilles opérateur en dépassement', '/admin/recharges'
    FROM public.operator_wallets w
   WHERE public.operator_balance(w.id) < -public.operator_neg_threshold(w.id)
  HAVING COUNT(*) > 0

  UNION ALL
  -- Paiements Chargily reçus APRÈS annulation de la commande (à réconcilier).
  -- Le client a déjà été recrédité (webhook) ; l'admin doit vérifier le paiement
  -- réel et décider du sort (garder le crédit / re-servir / rembourser Chargily).
  -- Fenêtre glissante 7 j → l'alerte s'efface d'elle-même une fois la vague passée.
  SELECT 'paid_after_cancel', 'finances', 'warning', 2,
         COUNT(*)::int, MIN(al.created_at),
         'Paiements reçus après annulation — à réconcilier', '/admin/coligo-pay'
    FROM public.admin_audit_log al
   WHERE al.action = 'paid_after_cancel'
     AND al.created_at > now() - interval '7 days'
  HAVING COUNT(*) > 0;
$$;

REVOKE ALL ON FUNCTION public._admin_alert_rules_finances()
  FROM PUBLIC, authenticated, anon;
