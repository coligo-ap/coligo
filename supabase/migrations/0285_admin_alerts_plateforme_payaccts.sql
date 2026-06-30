-- =============================================================================
-- 0285 — Alerte PLATEFORME : comptes de versement non configurés
-- =============================================================================
-- Étend `_admin_alert_rules_plateforme()` (maintenance, mig 0281) avec un signal
-- de configuration : un module (driver/chauffeur/merchant/partner) dont le compte
-- de versement plateforme (mig 0200) n'a NI CCP réel NI RIB → la recharge par
-- virement de ce module affiche un compte vide/placeholder, paiement impossible.
-- warning. href /admin/recharges. Règle services_maintenance de 0281 conservée.
-- =============================================================================

CREATE OR REPLACE FUNCTION public._admin_alert_rules_plateforme()
RETURNS TABLE (
  code text, domain text, severity text, prio int,
  count int, since timestamptz, label text, href text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Service(s) en maintenance
  SELECT 'services_maintenance', 'plateforme', 'warning', 2,
         COUNT(*)::int, NULL::timestamptz,
         'Service(s) en maintenance', '/admin/controle'
    FROM public.feature_flags ff
   WHERE ff.status = 'maintenance'
  HAVING COUNT(*) > 0

  UNION ALL
  -- Comptes de versement non configurés (CCP vide/placeholder ET RIB vide)
  SELECT 'payment_accounts_missing', 'plateforme', 'warning', 2,
         COUNT(*)::int, NULL::timestamptz,
         'Comptes de versement non configurés', '/admin/recharges'
    FROM public.platform_payment_accounts ppa
   WHERE (btrim(ppa.ccp_number) = '' OR ppa.ccp_number ~ '^0+$')
     AND btrim(ppa.bank_rib) = ''
  HAVING COUNT(*) > 0;
$$;

REVOKE ALL ON FUNCTION public._admin_alert_rules_plateforme()
  FROM PUBLIC, authenticated, anon;
