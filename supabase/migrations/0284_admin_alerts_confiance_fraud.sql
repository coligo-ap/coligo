-- =============================================================================
-- 0284 — Alerte CONFIANCE : anti-fraude IP partagées
-- =============================================================================
-- Étend `_admin_alert_rules_confiance()` (signalements, mig 0279) avec un signal
-- anti-fraude : adresses IP utilisées par PLUSIEURS comptes récemment (≥ 4
-- comptes distincts sur 7 jours, mig 0168 user_device_log) — indice de
-- multi-comptes / abus. info (à examiner, pas urgent). href /admin/devices.
-- Seuil conservateur (4+) pour limiter les faux positifs (NAT, lieux publics).
-- Les règles signalements de 0279 sont conservées.
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
  HAVING COUNT(*) > 0

  UNION ALL
  -- Anti-fraude : IP partagées par plusieurs comptes (7 derniers jours)
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
  HAVING COUNT(*) > 0;
$$;

REVOKE ALL ON FUNCTION public._admin_alert_rules_confiance()
  FROM PUBLIC, authenticated, anon;
