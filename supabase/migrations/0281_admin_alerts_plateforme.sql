-- =============================================================================
-- 0281 — Alertes domaine PLATEFORME
-- =============================================================================
-- Signal : service(s) en MAINTENANCE (feature_flags.status='maintenance',
-- mig 0182). Un service en maintenance est indisponible pour les utilisateurs →
-- état dégradé volontaire à surveiller (warning). Les autres statuts (hidden,
-- coming_soon) sont des choix produit normaux, PAS des alertes.
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
  SELECT 'services_maintenance', 'plateforme', 'warning', 2,
         COUNT(*)::int, NULL::timestamptz,
         'Service(s) en maintenance', '/admin/controle'
    FROM public.feature_flags ff
   WHERE ff.status = 'maintenance'
  HAVING COUNT(*) > 0;
$$;

REVOKE ALL ON FUNCTION public._admin_alert_rules_plateforme() FROM PUBLIC, authenticated, anon;

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
      UNION ALL SELECT * FROM public._admin_alert_rules_plateforme()
    ) r;

  RETURN v_alerts;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_alerts() TO authenticated;
