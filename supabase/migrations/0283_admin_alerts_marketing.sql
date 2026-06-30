-- =============================================================================
-- 0283 — Alertes domaine MARKETING (8ᵉ et dernier domaine)
-- =============================================================================
-- Signal : bannières promo EXPIRÉES mais encore ACTIVES (active=true AND
-- ends_at < now()). Elles s'affichent toujours côté client alors qu'elles ne
-- devraient plus → à désactiver. warning (hygiène vitrine). href /admin/bannieres.
-- (Pas d'alerte « pushes programmés en échec » : aucune table de planification
--  de push n'existe — les envois sont immédiats.)
-- =============================================================================

CREATE OR REPLACE FUNCTION public._admin_alert_rules_marketing()
RETURNS TABLE (
  code text, domain text, severity text, prio int,
  count int, since timestamptz, label text, href text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 'banners_expired', 'marketing', 'warning', 2,
         COUNT(*)::int, MIN(b.ends_at),
         'Bannières expirées encore actives', '/admin/bannieres'
    FROM public.promo_banners b
   WHERE b.active = true
     AND b.ends_at IS NOT NULL
     AND b.ends_at < now()
  HAVING COUNT(*) > 0;
$$;

REVOKE ALL ON FUNCTION public._admin_alert_rules_marketing()
  FROM PUBLIC, authenticated, anon;

-- Agrégateur : 8 domaines complets.
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
      UNION ALL SELECT * FROM public._admin_alert_rules_marketing()
    ) r;

  RETURN v_alerts;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_alerts() TO authenticated;
