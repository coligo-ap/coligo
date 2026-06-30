-- =============================================================================
-- 0279 — Alertes domaine CONFIANCE & SÉCURITÉ
-- =============================================================================
-- Signalements non résolus, source de vérité unique pour tous les litiges :
--   • delivery_reports (mig 0095) non résolus : status IN ('open','reviewing').
--   • ride_reports (mig 0139) non résolus : status = 'open'.
-- warning → critical au-delà de 48 h (un litige qui traîne érode la confiance).
-- Les deux pointent vers /admin/reports (file de modération existante).
-- =============================================================================

CREATE OR REPLACE FUNCTION public._admin_alert_rules_confiance()
RETURNS TABLE (
  code text, domain text, severity text, prio int,
  count int, since timestamptz, label text, href text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Signalements livraison non résolus
  SELECT 'delivery_reports_open', 'confiance',
         CASE WHEN MIN(dr.created_at) < now() - interval '48 hours'
              THEN 'critical' ELSE 'warning' END,
         CASE WHEN MIN(dr.created_at) < now() - interval '48 hours' THEN 3 ELSE 2 END,
         COUNT(*)::int, MIN(dr.created_at),
         'Signalements livraison non résolus', '/admin/reports'
    FROM public.delivery_reports dr
   WHERE dr.status IN ('open','reviewing')
  HAVING COUNT(*) > 0

  UNION ALL
  -- Signalements course (Drive) non résolus
  SELECT 'ride_reports_open', 'confiance',
         CASE WHEN MIN(rr.created_at) < now() - interval '48 hours'
              THEN 'critical' ELSE 'warning' END,
         CASE WHEN MIN(rr.created_at) < now() - interval '48 hours' THEN 3 ELSE 2 END,
         COUNT(*)::int, MIN(rr.created_at),
         'Signalements course non résolus', '/admin/reports'
    FROM public.ride_reports rr
   WHERE rr.status = 'open'
  HAVING COUNT(*) > 0;
$$;

REVOKE ALL ON FUNCTION public._admin_alert_rules_confiance() FROM PUBLIC, authenticated, anon;

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
      UNION ALL SELECT * FROM public._admin_alert_rules_drive()
      UNION ALL SELECT * FROM public._admin_alert_rules_confiance()
    ) r;

  RETURN v_alerts;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_alerts() TO authenticated;
