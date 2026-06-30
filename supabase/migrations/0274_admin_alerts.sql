-- =============================================================================
-- 0274 — Moteur d'alertes super-admin (socle, style Uber)
-- =============================================================================
-- CONTEXTE : le back-office super-admin n'avait que 3 compteurs isolés calculés
-- à la main dans le layout (commandes en retard, versements à traiter, demandes
-- commerçant). Ni hiérarchie de gravité, ni vue d'ensemble, ni remontée pour les
-- autres domaines. Le super-admin ne pouvait pas voir d'un coup d'œil OÙ agir en
-- priorité.
--
-- Cette migration livre le SOCLE d'un moteur d'alertes centralisé, calculé EN
-- BASE (vérité unique, inviolable) :
--
--   public.admin_alerts() — RETURNS jsonb : tableau d'alertes, une par règle,
--   chacune { code, domain, severity, count, label, href, since }. Triées par
--   priorité (critical > warning > info) puis volume. SEULES les règles dont le
--   compteur > 0 sont émises.
--
--     • severity : 'critical' (rouge, urgent) | 'warning' (orange, risque)
--                  | 'info' (en attente non urgent). 'ok' = absence d'alerte
--                  (le domaine n'apparaît tout simplement pas).
--     • code     : identifiant STABLE (traçabilité / tests / front).
--     • domain   : une des 8 clés de domaine du drawer admin.
--     • href     : lien profond vers la liste filtrée exacte (drill-down).
--     • since    : horodatage du plus ancien élément (pilote l'escalade par âge).
--
-- SÉCURITÉ (bypass-proof) :
--   • SECURITY DEFINER + 1ʳᵉ instruction `is_super_admin()` → inappelable hors
--     super-admin même en tapant l'API PostgREST directement (RAISE 42501).
--   • GRANT EXECUTE TO authenticated : la session admin EST `authenticated`
--     (createClient). REVOKE la rendrait inappelable (cf. mig 0272). La garde
--     interne reste la seule barrière. anon n'a PAS le GRANT.
--   • LECTURE SEULE : ne mute aucune table. Aucune PII dans le payload
--     (compteurs + codes seulement) ; le détail nominatif s'obtient sur la page
--     gatée du domaine.
--
-- SOCLE = 4 règles couvrant 3 domaines (zéro régression : la somme des deux
-- règles « retard » == l'ancien lateCount ; payouts/merchants inchangés) :
--   pilotage    → orders_late_warn (30–60 min) / orders_late_crit (> 60 min)
--   finances    → payouts_pending  (versements à traiter, escalade > 3 j)
--   commercants → merchants_pending (demandes d'inscription, escalade > 24 h)
--
-- Les domaines Livraison / Drive / Confiance / Plateforme / Marketing seront
-- branchés par les migrations suivantes (une par domaine).
-- =============================================================================

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
  -- Garde inviolable : aucune donnée ne sort hors d'une session super-admin.
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'code',     a.code,
               'domain',   a.domain,
               'severity', a.severity,
               'count',    a.count,
               'label',    a.label,
               'href',     a.href,
               'since',    a.since
             )
             ORDER BY a.prio DESC, a.count DESC
           ),
           '[]'::jsonb
         )
    INTO v_alerts
    FROM (
      -- =====================================================================
      -- PILOTAGE — commandes en retard. Une commande est « en retard » quand
      -- elle est encore ACTIVE et que son heure prévue (pickup_slot_at) est
      -- dépassée. On exclut l'online non payé (client ayant abandonné le
      -- paiement, cohérent mig 0068). Découpé en deux paliers de gravité.
      -- =====================================================================
      SELECT 'orders_late_crit'                       AS code,
             'pilotage'                               AS domain,
             'critical'                               AS severity,
             3                                        AS prio,
             COUNT(*)::int                            AS count,
             MIN(o.pickup_slot_at)                    AS since,
             'Commandes en retard de plus d''1 h'     AS label,
             '/admin/alertes?domain=pilotage'         AS href
        FROM public.orders o
       WHERE o.status IN ('pending','accepted','preparing','ready')
         AND o.pickup_slot_at < now() - interval '60 minutes'
         AND (o.payment_method = 'cash'
              OR (o.payment_method = 'online' AND o.payment_status = 'paid'))
      HAVING COUNT(*) > 0

      UNION ALL

      SELECT 'orders_late_warn',
             'pilotage',
             'warning',
             2,
             COUNT(*)::int,
             MIN(o.pickup_slot_at),
             'Commandes en retard (30–60 min)',
             '/admin/alertes?domain=pilotage'
        FROM public.orders o
       WHERE o.status IN ('pending','accepted','preparing','ready')
         AND o.pickup_slot_at <  now() - interval '30 minutes'
         AND o.pickup_slot_at >= now() - interval '60 minutes'
         AND (o.payment_method = 'cash'
              OR (o.payment_method = 'online' AND o.payment_status = 'paid'))
      HAVING COUNT(*) > 0

      UNION ALL

      -- =====================================================================
      -- FINANCES — versements commerçant à traiter (pending + approved). En
      -- attente = info ; au-delà de 3 jours sans traitement = warning (risque
      -- d'insatisfaction commerçant / trésorerie qui traîne).
      -- =====================================================================
      SELECT 'payouts_pending',
             'finances',
             CASE WHEN MIN(pr.created_at) < now() - interval '3 days'
                  THEN 'warning' ELSE 'info' END,
             CASE WHEN MIN(pr.created_at) < now() - interval '3 days'
                  THEN 2 ELSE 1 END,
             COUNT(*)::int,
             MIN(pr.created_at),
             'Versements à traiter',
             '/admin/versements'
        FROM public.payout_requests pr
       WHERE pr.status IN ('pending','approved')
      HAVING COUNT(*) > 0

      UNION ALL

      -- =====================================================================
      -- COMMERÇANTS — demandes d'inscription en attente de validation. En
      -- attente = info ; au-delà de 24 h non traitée = warning (un commerçant
      -- qui attend trop longtemps risque d'abandonner).
      -- =====================================================================
      SELECT 'merchants_pending',
             'commercants',
             CASE WHEN MIN(COALESCE(m.submitted_at, m.created_at))
                       < now() - interval '24 hours'
                  THEN 'warning' ELSE 'info' END,
             CASE WHEN MIN(COALESCE(m.submitted_at, m.created_at))
                       < now() - interval '24 hours'
                  THEN 2 ELSE 1 END,
             COUNT(*)::int,
             MIN(COALESCE(m.submitted_at, m.created_at)),
             'Demandes d''inscription à valider',
             '/admin/merchants'
        FROM public.merchants m
       WHERE m.approval_status = 'pending'
      HAVING COUNT(*) > 0
    ) a;

  RETURN v_alerts;
END;
$$;

-- La session super-admin se connecte en rôle `authenticated` : REVOKE rendrait
-- la RPC inappelable (« permission denied for function », cf. mig 0272). La
-- garde interne is_super_admin() est la seule barrière voulue.
REVOKE ALL ON FUNCTION public.admin_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_alerts() TO authenticated;

COMMENT ON FUNCTION public.admin_alerts() IS
  'Moteur d''alertes super-admin (mig 0274). Lecture seule, gardé is_super_admin. '
  'Retourne un tableau jsonb {code,domain,severity,count,label,href,since} trié '
  'par priorité. Étendu domaine par domaine par les migrations suivantes.';
