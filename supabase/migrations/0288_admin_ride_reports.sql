-- =============================================================================
-- 0288 — UI manquante : modération des signalements de course (Drive)
-- =============================================================================
-- BUG MÉTIER : les `ride_reports` (signalements de course, mig 0139) n'avaient
-- AUCUNE surface admin — ils s'accumulaient invisibles (l'alerte ride_reports_open
-- les comptait mais /admin/reports ne montrait que les signalements LIVRAISON).
-- Cette migration livre les deux RPC manquantes (miroir de admin_delivery_reports),
-- gardées is_super_admin :
--   • admin_ride_reports(limit)        — liste avec contexte course + chauffeur.
--   • admin_resolve_ride_report(id,…)  — passer à reviewed / dismissed / open.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_ride_reports(p_limit integer DEFAULT 200)
RETURNS TABLE (
  id              uuid,
  ride_id         uuid,
  reporter        text,
  reason          text,
  status          text,
  decision        text,
  created_at      timestamptz,
  reviewed_at     timestamptz,
  chauffeur_name  text,
  chauffeur_phone text,
  pickup_text     text,
  dest_text       text,
  ride_status     text,
  price_da        integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT rr.id, rr.ride_id, rr.reporter, rr.reason, rr.status, rr.decision,
         rr.created_at, rr.reviewed_at,
         ch.full_name, ch.phone, ri.pickup_text, ri.dest_text, ri.status,
         COALESCE(ri.agreed_price_da, ri.proposed_price_da,
                  ri.suggested_price_da)::int
    FROM public.ride_reports rr
    JOIN public.rides ri      ON ri.id = rr.ride_id
    LEFT JOIN public.chauffeurs ch ON ch.id = ri.chauffeur_id
   WHERE public.is_super_admin()
   ORDER BY CASE rr.status WHEN 'open' THEN 0 WHEN 'reviewed' THEN 1 ELSE 2 END,
            rr.created_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000));
$$;

CREATE OR REPLACE FUNCTION public.admin_resolve_ride_report(
  p_report_id uuid,
  p_status    text,
  p_decision  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF p_status NOT IN ('open','reviewed','dismissed') THEN
    RAISE EXCEPTION 'statut invalide: %', p_status;
  END IF;
  UPDATE public.ride_reports
     SET status      = p_status,
         decision    = NULLIF(btrim(COALESCE(p_decision, '')), ''),
         reviewed_at = CASE WHEN p_status = 'open' THEN NULL ELSE now() END
   WHERE id = p_report_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ride_reports(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_resolve_ride_report(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ride_reports(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_ride_report(uuid, text, text)
  TO authenticated;
