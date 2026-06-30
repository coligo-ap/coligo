-- =============================================================================
-- 0278 — Alertes domaine COLIGO DRIVE
-- =============================================================================
-- Signal : chauffeurs ayant des pièces en attente de validation
-- (chauffeur_documents.status='pending', mig 0148). On compte les CHAUFFEURS
-- distincts (workload « demandes à valider »), pas les pièces. info → warning > 24 h.
-- =============================================================================

CREATE OR REPLACE FUNCTION public._admin_alert_rules_drive()
RETURNS TABLE (
  code text, domain text, severity text, prio int,
  count int, since timestamptz, label text, href text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 'chauffeur_docs_pending', 'drive',
         CASE WHEN MIN(cd.created_at) < now() - interval '24 hours'
              THEN 'warning' ELSE 'info' END,
         CASE WHEN MIN(cd.created_at) < now() - interval '24 hours' THEN 2 ELSE 1 END,
         COUNT(DISTINCT cd.chauffeur_id)::int, MIN(cd.created_at),
         'Chauffeurs à valider (pièces)', '/admin/chauffeurs/inscriptions'
    FROM public.chauffeur_documents cd
   WHERE cd.status = 'pending'
  HAVING COUNT(*) > 0;
$$;

REVOKE ALL ON FUNCTION public._admin_alert_rules_drive() FROM PUBLIC, authenticated, anon;

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
    ) r;

  RETURN v_alerts;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_alerts() TO authenticated;
