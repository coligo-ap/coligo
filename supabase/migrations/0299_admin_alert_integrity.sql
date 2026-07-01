-- =============================================================================
-- 0299 — Alerte CONFIANCE : anomalie d'intégrité détectée (surveillance)
-- =============================================================================
-- Le cron quotidien /api/cron/integrity appelle `integrity_violations()` (mig
-- 0298). En cas de violation d'un invariant financier / d'état (gating paiement,
-- solde négatif, ledger déséquilibré…), il trace l'anomalie dans admin_audit_log
-- (action='integrity_violation', note = codes×counts). On la remonte ici en
-- ALERTE super-admin CRITIQUE (domaine Confiance), fenêtre 2 jours : comme le
-- cron est quotidien, l'alerte reflète le dernier run et s'efface d'elle-même
-- dès que la base redevient saine (le run suivant n'écrit plus rien).
--
-- CREATE OR REPLACE de _admin_alert_rules_confiance() : on conserve les 3 règles
-- de 0284 (signalements livraison/course + IP partagées) + la nouvelle.
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
  HAVING COUNT(*) > 0

  UNION ALL
  -- Anomalie d'intégrité (invariant financier/d'état violé) détectée par le cron.
  SELECT 'integrity_violation', 'confiance', 'critical', 3,
         COUNT(*)::int, MIN(al.created_at),
         'Anomalie d''intégrité détectée — vérifier', '/admin/coligo-pay'
    FROM public.admin_audit_log al
   WHERE al.action = 'integrity_violation'
     AND al.created_at > now() - interval '2 days'
  HAVING COUNT(*) > 0;
$$;

REVOKE ALL ON FUNCTION public._admin_alert_rules_confiance()
  FROM PUBLIC, authenticated, anon;
