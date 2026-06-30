-- =============================================================================
-- 0275 — Moteur d'alertes : refactor PAR DOMAINE + Pilotage complet
-- =============================================================================
-- CONTEXTE : la mig 0274 a livré `admin_alerts()` monolithique (toutes les
-- règles inline). Pour brancher les domaines suivants « un par un sans casser »,
-- on refactore en architecture ANTI-DUPLICATION :
--
--   • Une fonction de règles PAR DOMAINE : `_admin_alert_rules_<domaine>()`,
--     RETURNS TABLE(code, domain, severity, prio, count, since, label, href).
--     Chaque domaine futur = créer SA fonction + ajouter UNE ligne d'UNION dans
--     l'agrégateur. Aucune réécriture des autres domaines.
--
--   • Un AGRÉGATEUR fin `admin_alerts()` : garde `is_super_admin()` + UNION ALL
--     des fonctions de domaine + tri + jsonb. C'est la SEULE fonction exposée
--     (GRANT authenticated). Les fonctions de règles sont REVOKE FROM PUBLIC →
--     inappelables directement (défense en profondeur : même sans PII, on ne
--     laisse pas un non-admin les sonder). Elles tournent en SECURITY DEFINER et
--     ne sont atteignables que depuis l'agrégateur (lui-même gardé).
--
-- AJOUT MÉTIER (Pilotage) : `orders_stuck_pending` — commande effective encore
-- en 'pending' (non acceptée par le commerçant) depuis > 15 min mais PAS encore
-- en retard (handoff propre avec orders_late_warn : dès que le créneau est
-- dépassé de 30 min, l'alerte bascule en « retard »). Détecte les commandes que
-- le commerçant tarde à accepter, AVANT qu'elles ne deviennent un retard.
-- =============================================================================

-- Type de retour commun via RETURNS TABLE répété (pas de type composite nommé
-- pour rester simple/idempotent). Toutes les fonctions de domaine ont la MÊME
-- signature de sortie → UNION ALL direct dans l'agrégateur.

-- ---------------------------------------------------------------------------
-- PILOTAGE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._admin_alert_rules_pilotage()
RETURNS TABLE (
  code text, domain text, severity text, prio int,
  count int, since timestamptz, label text, href text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Retards > 1 h (critique)
  SELECT 'orders_late_crit', 'pilotage', 'critical', 3,
         COUNT(*)::int, MIN(o.pickup_slot_at),
         'Commandes en retard de plus d''1 h', '/admin/alertes?domain=pilotage'
    FROM public.orders o
   WHERE o.status IN ('pending','accepted','preparing','ready')
     AND o.pickup_slot_at < now() - interval '60 minutes'
     AND (o.payment_method = 'cash'
          OR (o.payment_method = 'online' AND o.payment_status = 'paid'))
  HAVING COUNT(*) > 0

  UNION ALL
  -- Retards 30–60 min (à surveiller)
  SELECT 'orders_late_warn', 'pilotage', 'warning', 2,
         COUNT(*)::int, MIN(o.pickup_slot_at),
         'Commandes en retard (30–60 min)', '/admin/alertes?domain=pilotage'
    FROM public.orders o
   WHERE o.status IN ('pending','accepted','preparing','ready')
     AND o.pickup_slot_at <  now() - interval '30 minutes'
     AND o.pickup_slot_at >= now() - interval '60 minutes'
     AND (o.payment_method = 'cash'
          OR (o.payment_method = 'online' AND o.payment_status = 'paid'))
  HAVING COUNT(*) > 0

  UNION ALL
  -- Commandes non acceptées > 15 min, pas encore en retard (early-warning)
  SELECT 'orders_stuck_pending', 'pilotage', 'warning', 2,
         COUNT(*)::int, MIN(o.created_at),
         'Commandes non acceptées (> 15 min)', '/admin/alertes?domain=pilotage'
    FROM public.orders o
   WHERE o.status = 'pending'
     AND o.created_at < now() - interval '15 minutes'
     AND o.pickup_slot_at >= now() - interval '30 minutes'
     AND (o.payment_method = 'cash'
          OR (o.payment_method = 'online' AND o.payment_status = 'paid'))
  HAVING COUNT(*) > 0;
$$;

-- ---------------------------------------------------------------------------
-- COMMERÇANTS
-- ---------------------------------------------------------------------------
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
  SELECT 'merchants_pending', 'commercants',
         CASE WHEN MIN(COALESCE(m.submitted_at, m.created_at))
                   < now() - interval '24 hours' THEN 'warning' ELSE 'info' END,
         CASE WHEN MIN(COALESCE(m.submitted_at, m.created_at))
                   < now() - interval '24 hours' THEN 2 ELSE 1 END,
         COUNT(*)::int, MIN(COALESCE(m.submitted_at, m.created_at)),
         'Demandes d''inscription à valider', '/admin/merchants'
    FROM public.merchants m
   WHERE m.approval_status = 'pending'
  HAVING COUNT(*) > 0;
$$;

-- ---------------------------------------------------------------------------
-- COLIGO PAY & FINANCES
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._admin_alert_rules_finances()
RETURNS TABLE (
  code text, domain text, severity text, prio int,
  count int, since timestamptz, label text, href text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 'payouts_pending', 'finances',
         CASE WHEN MIN(pr.created_at) < now() - interval '3 days'
              THEN 'warning' ELSE 'info' END,
         CASE WHEN MIN(pr.created_at) < now() - interval '3 days'
              THEN 2 ELSE 1 END,
         COUNT(*)::int, MIN(pr.created_at),
         'Versements à traiter', '/admin/versements'
    FROM public.payout_requests pr
   WHERE pr.status IN ('pending','approved')
  HAVING COUNT(*) > 0;
$$;

-- ---------------------------------------------------------------------------
-- AGRÉGATEUR (seule fonction exposée). Garde + UNION ALL + tri + jsonb.
-- ---------------------------------------------------------------------------
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
               'count', r.count, 'label', r.label, 'href', r.href,
               'since', r.since
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
    ) r;

  RETURN v_alerts;
END;
$$;

-- Sécurité : les fonctions de règles NE sont PAS exposées (inappelables hors de
-- l'agrégateur gardé). Seul admin_alerts() est grantée à authenticated.
REVOKE ALL ON FUNCTION public._admin_alert_rules_pilotage()   FROM PUBLIC;
REVOKE ALL ON FUNCTION public._admin_alert_rules_commercants() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._admin_alert_rules_finances()    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_alerts() TO authenticated;
