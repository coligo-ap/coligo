-- =============================================================================
-- 0282 — Alerte COMMERÇANTS : dette espèces au plafond (risque financier)
-- =============================================================================
-- Un commerçant dont le solde wallet (SUM wallet_entries = merchant_balance) est
-- ≤ -max_debt_da a atteint le plafond de dette espèces (mig 0269) : il est BLOQUÉ
-- (ne peut plus encaisser de cash) et représente un risque d'impayé. CRITIQUE.
-- Calculé en UNE passe agrégée sur wallet_entries (pas N appels merchant_balance).
-- La règle merchants_pending de 0275 est conservée.
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
  -- Demandes d'inscription à valider
  SELECT 'merchants_pending', 'commercants',
         CASE WHEN MIN(COALESCE(m.submitted_at, m.created_at))
                   < now() - interval '24 hours' THEN 'warning' ELSE 'info' END,
         CASE WHEN MIN(COALESCE(m.submitted_at, m.created_at))
                   < now() - interval '24 hours' THEN 2 ELSE 1 END,
         COUNT(*)::int, MIN(COALESCE(m.submitted_at, m.created_at)),
         'Demandes d''inscription à valider', '/admin/merchants'
    FROM public.merchants m
   WHERE m.approval_status = 'pending'
  HAVING COUNT(*) > 0

  UNION ALL
  -- Dette espèces au plafond (bloqués / risque d'impayé)
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
