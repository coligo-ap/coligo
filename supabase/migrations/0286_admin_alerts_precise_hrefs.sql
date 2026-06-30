-- =============================================================================
-- 0286 — Liens d'alerte plus précis (atterrir sur le sous-écran exact)
-- =============================================================================
-- Pour que l'alerte se retrouve EXACTEMENT là où elle se traite, on pointe
-- merchants_pending vers l'onglet « inscriptions » du hub Commerçants (la file
-- d'attente), pas la racine du hub. Reste de la règle inchangé (0282).
-- =============================================================================

CREATE OR REPLACE FUNCTION public._admin_alert_rules_commercants()
RETURNS TABLE (
  code text, domain text, severity text, prio int,
  count int, since timestamptz, label text, href text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 'merchants_pending', 'commercants',
         CASE WHEN MIN(COALESCE(m.submitted_at, m.created_at))
                   < now() - interval '24 hours' THEN 'warning' ELSE 'info' END,
         CASE WHEN MIN(COALESCE(m.submitted_at, m.created_at))
                   < now() - interval '24 hours' THEN 2 ELSE 1 END,
         COUNT(*)::int, MIN(COALESCE(m.submitted_at, m.created_at)),
         'Demandes d''inscription à valider', '/admin/merchants/inscriptions'
    FROM public.merchants m
   WHERE m.approval_status = 'pending'
  HAVING COUNT(*) > 0

  UNION ALL
  SELECT 'merchant_cash_debt', 'commercants', 'critical', 3,
         COUNT(*)::int, NULL::timestamptz,
         'Commerçants en dette espèces (plafond atteint)',
         '/admin/merchants/finances'
    FROM (
      SELECT we.merchant_id, SUM(we.amount_da) AS bal
        FROM public.wallet_entries we
       WHERE we.merchant_id IS NOT NULL
       GROUP BY we.merchant_id
    ) b
   CROSS JOIN public.platform_settings ps
   WHERE ps.id = true
     AND b.bal <= -COALESCE(ps.max_debt_da, 5000)
  HAVING COUNT(*) > 0;
$$;

REVOKE ALL ON FUNCTION public._admin_alert_rules_commercants()
  FROM PUBLIC, authenticated, anon;
