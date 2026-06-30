-- =============================================================================
-- 0290 — Alignement alerte ↔ page réelle (anti faux-positif / lien mort)
-- =============================================================================
-- BUG : une alerte doit compter EXACTEMENT ce que sa page de destination montre,
-- sinon le super-admin clique et ne trouve rien.
--
--  1) DRIVE — « Chauffeurs à valider » comptait les PIÈCES en attente
--     (chauffeur_documents.status='pending'). Or un chauffeur déjà VÉRIFIÉ peut
--     garder une pièce 'pending' résiduelle → alerte sonne mais la page
--     /admin/chauffeurs/inscriptions (file = NON vérifiés) est vide. On compte
--     désormais la VRAIE file : chauffeurs NON vérifiés, non bloqués, ayant
--     soumis (exactement le filtre de la page).
--
--  2) LIVRAISON — driver_refund_pending pointait vers /admin/livraison, mais les
--     avances no-show se traitent sur /admin/reports (section « Avances no-show
--     à valider »). Lien corrigé.
-- =============================================================================

-- ── DRIVE ───────────────────────────────────────────────────────────────────
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
  SELECT 'chauffeur_pending_validation', 'drive',
         CASE WHEN MIN(ch.submitted_at) < now() - interval '24 hours'
              THEN 'warning' ELSE 'info' END,
         CASE WHEN MIN(ch.submitted_at) < now() - interval '24 hours'
              THEN 2 ELSE 1 END,
         COUNT(*)::int, MIN(ch.submitted_at),
         'Chauffeurs à valider', '/admin/chauffeurs/inscriptions'
    FROM public.chauffeurs ch
   WHERE ch.is_verified = false
     AND ch.is_blocked = false
     AND ch.submitted_at IS NOT NULL
  HAVING COUNT(*) > 0;
$$;
REVOKE ALL ON FUNCTION public._admin_alert_rules_drive()
  FROM PUBLIC, authenticated, anon;

-- ── LIVRAISON (href corrigé) ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._admin_alert_rules_livraison()
RETURNS TABLE (
  code text, domain text, severity text, prio int,
  count int, since timestamptz, label text, href text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 'driver_refund_pending', 'livraison',
         CASE WHEN MIN(rc.created_at) < now() - interval '48 hours'
              THEN 'critical' ELSE 'warning' END,
         CASE WHEN MIN(rc.created_at) < now() - interval '48 hours' THEN 3 ELSE 2 END,
         COUNT(*)::int, MIN(rc.created_at),
         'Remboursements livreur à valider', '/admin/reports'
    FROM public.driver_refund_claims rc
   WHERE rc.status = 'pending'
  HAVING COUNT(*) > 0

  UNION ALL
  SELECT 'drivers_over_cap', 'livraison', 'warning', 2,
         COUNT(*)::int, NULL::timestamptz,
         'Livreurs au plafond d''encours cash', '/admin/drivers/finances'
    FROM (
      SELECT dl.driver_id,
             GREATEST(0, COALESCE(SUM(
               CASE WHEN dl.type = 'driver_owes_platform' THEN dl.amount_da
                    WHEN dl.type = 'driver_payout' AND o.payment_method = 'online'
                         THEN -dl.amount_da
                    ELSE 0 END), 0)) AS outstanding
        FROM public.delivery_ledger dl
        LEFT JOIN public.orders o ON o.id = dl.order_id
       WHERE dl.settled_at IS NULL
       GROUP BY dl.driver_id
    ) x
   CROSS JOIN public.platform_settings ps
   WHERE ps.id = true
     AND x.outstanding >= COALESCE(ps.driver_float_cap_da, 8000)
  HAVING COUNT(*) > 0;
$$;
REVOKE ALL ON FUNCTION public._admin_alert_rules_livraison()
  FROM PUBLIC, authenticated, anon;
