-- =============================================================================
-- 0341 — Livraisons bloquées : remontée SUPER-ADMIN + auto-guérison.
-- =============================================================================
-- Incident réel (07/07) : un livreur est resté « bloqué » sur une course que le
-- support avait validée à sa place — personne côté plateforme ne VOIT ces
-- situations tant qu'un humain ne se plaint pas. On les remonte désormais dans
-- le moteur d'alertes (domaine livraison, hub Pilotage/Alertes + cloche), et on
-- répare tout seul ce qui peut l'être :
--
--   1. `deliveries_stuck_in_transit` — commandes RÉCUPÉRÉES chez le commerçant
--      (picked_up) mais sans issue (ni livrée, ni annulée, ni no-show) depuis
--      platform_settings.express_stuck_transit_alert_min (défaut 60 min ;
--      0 = désactivé). Le support ouvre la fiche commande et TRAITE : valider,
--      no-show, échec, réattribuer, indemniser. warning, critical ×2 délai.
--      (Avant récupération, la libération auto 0323 s'en charge déjà — ici
--      c'est la phase POST-pickup, non auto-libérable : garde COD.)
--   2. `ghost_busy_drivers` — lignes driver_availability encore 'busy' alors
--      que leur commande est terminée/disparue : le livreur ne reçoit plus
--      rien. Alerte + AUTO-GUÉRISON : release_stale_express_claims() (déjà
--      appelée en tête de chaque pull + cron quotidien) libère ces lignes —
--      traitement automatique, l'alerte ne persiste que si ça revient.
--
-- Corps des fonctions repris VERBATIM de leur dernière définition (0290 pour
-- les règles livraison, 0323 pour le watchdog) + ajouts.
-- =============================================================================

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS express_stuck_transit_alert_min INTEGER NOT NULL DEFAULT 60;

-- ── 1. Règles d'alerte livraison (0290 + 2 règles) ───────────────────────
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
  HAVING COUNT(*) > 0

  UNION ALL
  -- Courses RÉCUPÉRÉES sans issue depuis > seuil : le livreur est sur le
  -- terrain sans résolution (client injoignable, litige, oubli de valider…).
  -- Le support tranche depuis la fiche commande (valider / no-show / échec /
  -- réattribuer / indemniser).
  SELECT 'deliveries_stuck_in_transit', 'livraison',
         CASE WHEN MIN(o.delivery_picked_up_at)
                   < now() - make_interval(mins => 2 * COALESCE(ps.express_stuck_transit_alert_min, 60))
              THEN 'critical' ELSE 'warning' END,
         CASE WHEN MIN(o.delivery_picked_up_at)
                   < now() - make_interval(mins => 2 * COALESCE(ps.express_stuck_transit_alert_min, 60))
              THEN 3 ELSE 2 END,
         COUNT(*)::int, MIN(o.delivery_picked_up_at),
         'Livraisons récupérées sans issue (à trancher)',
         '/admin/orders?st=active&ft=delivery'
    FROM public.orders o
   CROSS JOIN public.platform_settings ps
   WHERE ps.id = true
     AND COALESCE(ps.express_stuck_transit_alert_min, 60) > 0
     AND o.fulfillment_type = 'delivery'
     AND o.status NOT IN ('completed', 'cancelled')
     AND o.delivery_picked_up_at IS NOT NULL
     AND o.delivery_delivered_at IS NULL
     AND o.delivery_no_show_at IS NULL
     AND o.delivery_picked_up_at
         < now() - make_interval(mins => COALESCE(ps.express_stuck_transit_alert_min, 60))
  GROUP BY ps.express_stuck_transit_alert_min
  HAVING COUNT(*) > 0

  UNION ALL
  -- Disponibilités FANTÔMES : livreur encore 'busy' sur une commande terminée
  -- ou disparue → il ne reçoit plus aucune course. Auto-guérie par
  -- release_stale_express_claims (pull in-band + cron) ; l'alerte ne devrait
  -- donc jamais persister — si elle reste, un flux ne libère pas proprement.
  SELECT 'ghost_busy_drivers', 'livraison', 'warning', 2,
         COUNT(*)::int, NULL::timestamptz,
         'Livreurs bloqués « en course » sur une commande terminée',
         '/admin/drivers'
    FROM public.driver_availability da
    LEFT JOIN public.orders o ON o.id = da.current_order_id
   WHERE da.status = 'busy'
     AND (da.current_order_id IS NULL
          OR o.id IS NULL
          OR o.status IN ('completed', 'cancelled'))
  HAVING COUNT(*) > 0;
$$;
REVOKE ALL ON FUNCTION public._admin_alert_rules_livraison()
  FROM PUBLIC, authenticated, anon;

-- ── 2. Auto-guérison des 'busy' fantômes (corps 0323 verbatim + bloc 2b) ──
CREATE OR REPLACE FUNCTION public.release_stale_express_claims()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_timeout INTEGER;
  v_count   INTEGER := 0;
  r         RECORD;
BEGIN
  -- 2b. Libère les disponibilités fantômes (commande terminée/disparue mais
  -- ligne encore 'busy') — le livreur redevient joignable par le dispatch.
  -- Indépendant du timeout de claim : une incohérence se répare toujours.
  UPDATE public.driver_availability da
     SET status = 'available', current_order_id = NULL
   WHERE da.status = 'busy'
     AND (da.current_order_id IS NULL
          OR NOT EXISTS (
                SELECT 1 FROM public.orders o
                 WHERE o.id = da.current_order_id
                   AND o.status NOT IN ('completed', 'cancelled')));

  SELECT express_claim_timeout_min INTO v_timeout
  FROM public.platform_settings WHERE id = true;
  IF COALESCE(v_timeout, 0) <= 0 THEN
    RETURN 0; -- politique désactivée
  END IF;

  FOR r IN
    SELECT o.id, o.delivery_driver_id, o.status
      FROM public.orders o
     WHERE o.delivery_mode = 'express'
       AND o.fulfillment_type = 'delivery'
       AND o.delivery_driver_id IS NOT NULL
       AND o.delivery_picked_up_at IS NULL
       AND o.status IN ('preparing', 'ready')
       AND COALESCE(o.driver_claimed_at, o.driver_notified_at)
             < now() - make_interval(mins => v_timeout)
       FOR UPDATE OF o SKIP LOCKED
  LOOP
    INSERT INTO public.express_declines (order_id, driver_id)
    VALUES (r.id, r.delivery_driver_id)
    ON CONFLICT (order_id, driver_id) DO UPDATE SET declined_at = now();

    UPDATE public.orders
       SET delivery_driver_id = NULL,
           driver_claimed_at  = NULL
     WHERE id = r.id;

    UPDATE public.driver_availability
       SET status = 'available', current_order_id = NULL
     WHERE current_order_id = r.id;

    INSERT INTO public.order_events (order_id, from_status, to_status, note)
    VALUES (r.id, r.status::public.order_status, r.status::public.order_status,
            'auto_release_stale_claim: livreur sans progression depuis '
              || v_timeout || ' min — commande remise en file');

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.release_stale_express_claims() FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.release_stale_express_claims() TO service_role;
