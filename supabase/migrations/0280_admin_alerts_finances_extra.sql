-- =============================================================================
-- 0280 — Alertes domaine FINANCES : preuves de recharge + pièces agent
-- =============================================================================
-- Étend `_admin_alert_rules_finances()` (déjà dans l'agrégateur depuis 0275) avec
-- deux files de validation financière :
--   • wallet_topup_requests pending (mig 0187) — preuves de recharge wallet
--     (CCP/virement) à vérifier. info → warning > 24 h.
--   • partner_documents pending (mig 0196) — pièces d'Agent Coligo Pay à valider.
--     Compte les AGENTS distincts (wallet_id). info → warning > 24 h.
-- La règle payouts_pending d'origine est conservée. CREATE OR REPLACE préserve
-- les privilèges (REVOKE de 0276 reste) ; on re-REVOKE par sécurité.
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
  HAVING COUNT(*) > 0;
$$;

REVOKE ALL ON FUNCTION public._admin_alert_rules_finances() FROM PUBLIC, authenticated, anon;
