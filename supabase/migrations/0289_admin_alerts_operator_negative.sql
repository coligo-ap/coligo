-- =============================================================================
-- 0289 — Alerte bonus FINANCES : portefeuilles opérateur en dépassement
-- =============================================================================
-- Un portefeuille opérateur (livreur/chauffeur/commerçant/partenaire, mig 0184)
-- dont le solde réel est tombé SOUS son seuil négatif autorisé
-- (operator_balance < -operator_neg_threshold) est sur-débiteur → risque financier
-- à régulariser. warning. Calculé via les helpers existants (61 wallets en prod →
-- coût négligeable, et admin_alerts est de toute façon client + caché 60 s).
-- La règle est SILENCIEUSE tant que tout est sain (count 0 → non émise).
--
-- CREATE OR REPLACE de _admin_alert_rules_finances() : on conserve les 3 règles
-- de 0280 (payouts / topup / partner_docs) + on ajoute operator_wallets_negative.
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
  HAVING COUNT(*) > 0;
$$;

REVOKE ALL ON FUNCTION public._admin_alert_rules_finances()
  FROM PUBLIC, authenticated, anon;
