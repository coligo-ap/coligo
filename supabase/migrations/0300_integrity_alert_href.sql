-- =============================================================================
-- 0300 — Alerte intégrité : href → /admin/integrity (écran dédié)
-- =============================================================================
-- L'écran /admin/integrity existe désormais (liste les violations en direct via
-- integrity_violations()). On repointe l'alerte « anomalie d'intégrité » (0299)
-- de /admin/coligo-pay vers cet écran actionnable. CREATE OR REPLACE : les 3
-- autres règles Confiance (signalements livraison/course, IP partagées) sont
-- conservées à l'identique.
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
  SELECT 'ride_reports_open', 'confiance',
         CASE WHEN MIN(rr.created_at) < now() - interval '48 hours'
              THEN 'critical' ELSE 'warning' END,
         CASE WHEN MIN(rr.created_at) < now() - interval '48 hours' THEN 3 ELSE 2 END,
         COUNT(*)::int, MIN(rr.created_at),
         'Signalements course non résolus', '/admin/reports'
    FROM public.ride_reports rr
   WHERE rr.status = 'open'
  HAVING COUNT(*) > 0

  UNION ALL
  SELECT 'shared_ip_devices', 'confiance', 'info', 1,
         COUNT(*)::int, NULL::timestamptz,
         'Adresses IP partagées par plusieurs comptes', '/admin/devices'
    FROM (
      SELECT udl.ip
        FROM public.user_device_log udl
       WHERE udl.last_seen_at > now() - interval '7 days'
       GROUP BY udl.ip
      HAVING COUNT(DISTINCT udl.user_id) >= 4
    ) s
  HAVING COUNT(*) > 0

  UNION ALL
  -- Anomalie d'intégrité → écran dédié /admin/integrity (détail actionnable).
  SELECT 'integrity_violation', 'confiance', 'critical', 3,
         COUNT(*)::int, MIN(al.created_at),
         'Anomalie d''intégrité détectée — vérifier', '/admin/integrity'
    FROM public.admin_audit_log al
   WHERE al.action = 'integrity_violation'
     AND al.created_at > now() - interval '2 days'
  HAVING COUNT(*) > 0;
$$;

REVOKE ALL ON FUNCTION public._admin_alert_rules_confiance()
  FROM PUBLIC, authenticated, anon;
