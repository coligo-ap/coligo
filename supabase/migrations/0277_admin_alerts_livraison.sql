-- =============================================================================
-- 0277 — Alertes domaine LIVRAISON
-- =============================================================================
-- Deux signaux opérationnels :
--   • driver_refund_claims pending — demandes de remboursement livreur (no-show
--     validé support, mig 0160) en attente de décision. warning, → critical > 48 h.
--   • drivers_over_cap — livreurs dont l'encours cash a atteint le plafond
--     (driver_outstanding ≥ driver_float_cap_da) : BLOQUÉS pour accepter (mig 0103,
--     driver_can_accept) → à régulariser (versement/encaissement). Calculé en UNE
--     passe agrégée sur delivery_ledger non soldé (pas N appels de fonction).
-- =============================================================================

CREATE OR REPLACE FUNCTION public._admin_alert_rules_livraison()
RETURNS TABLE (
  code text, domain text, severity text, prio int,
  count int, since timestamptz, label text, href text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Remboursements livreur à valider
  SELECT 'driver_refund_pending', 'livraison',
         CASE WHEN MIN(rc.created_at) < now() - interval '48 hours'
              THEN 'critical' ELSE 'warning' END,
         CASE WHEN MIN(rc.created_at) < now() - interval '48 hours' THEN 3 ELSE 2 END,
         COUNT(*)::int, MIN(rc.created_at),
         'Remboursements livreur à valider', '/admin/livraison'
    FROM public.driver_refund_claims rc
   WHERE rc.status = 'pending'
  HAVING COUNT(*) > 0

  UNION ALL
  -- Livreurs au plafond d'encours cash (bloqués pour accepter)
  SELECT 'drivers_over_cap', 'livraison', 'warning', 2,
         COUNT(*)::int, NULL::timestamptz,
         'Livreurs au plafond d''encours cash', '/admin/drivers/finances'
    FROM (
      SELECT dl.driver_id,
             GREATEST(0, COALESCE(SUM(
               CASE WHEN dl.type = 'driver_owes_platform' THEN dl.amount_da
                    WHEN dl.type = 'driver_payout' AND o.payment_method = 'online'
                         THEN -dl.amount_da
                    ELSE 0 END), 0)) AS outstanding
        FROM public.delivery_ledger dl
        LEFT JOIN public.orders o ON o.id = dl.order_id
       WHERE dl.settled_at IS NULL
       GROUP BY dl.driver_id
    ) x
   CROSS JOIN public.platform_settings ps
   WHERE ps.id = true
     AND x.outstanding >= COALESCE(ps.driver_float_cap_da, 8000)
  HAVING COUNT(*) > 0;
$$;

REVOKE ALL ON FUNCTION public._admin_alert_rules_livraison() FROM PUBLIC, authenticated, anon;

-- Agrégateur : on ajoute la ligne Livraison.
CREATE OR REPLACE FUNCTION public.admin_alerts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_alerts jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'code', r.code, 'domain', r.domain, 'severity', r.severity,
               'count', r.count, 'label', r.label, 'href', r.href, 'since', r.since
             )
             ORDER BY r.prio DESC, r.count DESC
           ),
           '[]'::jsonb
         )
    INTO v_alerts
    FROM (
      SELECT * FROM public._admin_alert_rules_pilotage()
      UNION ALL SELECT * FROM public._admin_alert_rules_commercants()
      UNION ALL SELECT * FROM public._admin_alert_rules_finances()
      UNION ALL SELECT * FROM public._admin_alert_rules_livraison()
    ) r;

  RETURN v_alerts;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_alerts() TO authenticated;
