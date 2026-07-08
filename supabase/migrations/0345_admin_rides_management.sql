-- =============================================================================
-- 0344 — Gestion complète des courses Drive (parité module commandes 0337-0338).
-- =============================================================================
--  1. admin_search_rides — recherche combinée (client / chauffeur / statut /
--     paiement / période / texte trajet) paginée, COUNT fenêtré. Gardée
--     admin_can('drive').
--  2. rides.admin_refunded_da + admin_refund_ride_customer — remboursement
--     MANUEL partiel/total → crédit Coligo Pay, réservé aux courses TERMINÉES
--     (une course non terminée s'annule : admin_cancel_ride 0342 recrédite
--     déjà le séquestre), plafonné au payé réel, anti-double sous FOR UPDATE.
--  3. Alertes drive : hrefs → l'onglet Courses du hub (/admin/chauffeurs/
--     courses) où vivent désormais le panneau « à trancher » ET la recherche.
-- =============================================================================

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS admin_refunded_da INTEGER NOT NULL DEFAULT 0
    CHECK (admin_refunded_da >= 0);

-- ── 1. Recherche multi-critères paginée ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_search_rides(
  p_q           TEXT DEFAULT NULL,
  p_chauffeur_q TEXT DEFAULT NULL,
  p_status      TEXT DEFAULT NULL,
  p_payment     TEXT DEFAULT NULL,
  p_from        TIMESTAMPTZ DEFAULT NULL,
  p_to          TIMESTAMPTZ DEFAULT NULL,
  p_limit       INTEGER DEFAULT 30,
  p_offset      INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID, status TEXT, payment_method TEXT,
  price_da INTEGER, escrow_da INTEGER, admin_refunded_da INTEGER,
  pickup_text TEXT, dest_text TEXT, gamme TEXT,
  customer_id UUID, customer_name TEXT, customer_phone TEXT,
  chauffeur_id UUID, chauffeur_name TEXT,
  cancelled_by TEXT, created_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q  TEXT := NULLIF(btrim(COALESCE(p_q, '')), '');
  v_cq TEXT := NULLIF(btrim(COALESCE(p_chauffeur_q, '')), '');
BEGIN
  IF NOT public.admin_can('drive') THEN
    RETURN; -- fail-closed
  END IF;

  RETURN QUERY
  SELECT
    r.id, r.status::TEXT, r.payment_method,
    GREATEST(0, COALESCE(r.agreed_price_da,
                         r.proposed_price_da + r.boost_amount_da, 0)) AS price_da,
    r.escrow_da, r.admin_refunded_da,
    r.pickup_text, r.dest_text, r.gamme,
    r.customer_id, cu.full_name, cu.phone,
    r.chauffeur_id, ch.full_name,
    r.cancelled_by, r.created_at, r.completed_at,
    COUNT(*) OVER () AS total_count
  FROM public.rides r
  JOIN public.customers cu ON cu.id = r.customer_id
  LEFT JOIN public.chauffeurs ch ON ch.id = r.chauffeur_id
  WHERE
    (v_q IS NULL
      OR cu.full_name ILIKE '%' || v_q || '%'
      OR cu.phone ILIKE '%' || v_q || '%'
      OR r.pickup_text ILIKE '%' || v_q || '%'
      OR r.dest_text ILIKE '%' || v_q || '%'
      OR r.id::TEXT = lower(v_q)
      OR r.customer_id::TEXT = lower(v_q))
    AND (v_cq IS NULL
      OR (ch.id IS NOT NULL AND (
            ch.full_name ILIKE '%' || v_cq || '%'
         OR ch.phone ILIKE '%' || v_cq || '%'
         OR ch.id::TEXT = lower(v_cq))))
    AND (p_status IS NULL
      OR (p_status = 'active'
          AND r.status IN ('searching','scheduled','accepted','arriving','arrived','in_progress'))
      OR r.status::TEXT = p_status)
    AND (p_payment IS NULL OR r.payment_method = p_payment)
    AND (p_from IS NULL OR r.created_at >= p_from)
    AND (p_to IS NULL OR r.created_at < p_to)
  ORDER BY r.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_search_rides(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,INTEGER,INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_rides(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,INTEGER,INTEGER) TO authenticated;

-- ── 2. Remboursement MANUEL client (courses TERMINÉES uniquement) ─────────
-- Payé réel = prix final F (séquestre libéré en ligne / espèces remises au
-- chauffeur). Le geste est plafonné à F − déjà remboursé (cumul FOR UPDATE).
-- Une course annulée a déjà récupéré son séquestre → rien à rembourser ici.
CREATE OR REPLACE FUNCTION public.admin_refund_ride_customer(
  p_ride_id   UUID,
  p_amount_da INTEGER,
  p_note      TEXT
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ride      public.rides%ROWTYPE;
  v_paid      INTEGER;
  v_remaining INTEGER;
BEGIN
  IF NOT public.admin_can('drive') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF p_amount_da IS NULL OR p_amount_da < 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_amount');
  END IF;
  IF NULLIF(btrim(COALESCE(p_note, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'note_required');
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ride_not_found');
  END IF;
  IF v_ride.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cancelled_already_refunded');
  END IF;
  IF v_ride.status <> 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_completed_use_cancel');
  END IF;

  v_paid := GREATEST(0, COALESCE(v_ride.agreed_price_da,
                                 v_ride.proposed_price_da + v_ride.boost_amount_da, 0));
  v_remaining := v_paid - COALESCE(v_ride.admin_refunded_da, 0);
  IF v_remaining < 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'nothing_refundable');
  END IF;
  IF p_amount_da > v_remaining THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'exceeds_refundable',
                              'remaining_da', v_remaining);
  END IF;

  UPDATE public.rides
     SET admin_refunded_da = COALESCE(admin_refunded_da, 0) + p_amount_da
   WHERE id = p_ride_id;

  INSERT INTO public.customer_wallet_entries
      (customer_id, order_id, type, source, amount_da, note)
    VALUES
      (v_ride.customer_id, NULL, 'topup_credit', 'topup', p_amount_da,
       'Remboursement course Drive — ' || btrim(p_note));

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
    VALUES (p_ride_id, v_ride.status::text, v_ride.status::text,
            'admin_refund: ' || p_amount_da || ' DA re-crédités Coligo Pay — '
              || btrim(p_note));

  RETURN jsonb_build_object(
    'ok', true,
    'refunded_da', p_amount_da,
    'total_refunded_da', COALESCE(v_ride.admin_refunded_da, 0) + p_amount_da,
    'remaining_da', v_remaining - p_amount_da,
    'customer_id', v_ride.customer_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_refund_ride_customer(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_refund_ride_customer(UUID, INTEGER, TEXT) TO authenticated;

-- ── 3. Alertes drive : cibles → onglet Courses (corps 0342, hrefs seuls) ──
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
  HAVING COUNT(*) > 0

  UNION ALL
  SELECT 'rides_stuck_active', 'drive',
         CASE WHEN MIN(COALESCE(r.started_at, r.arrived_at, r.accepted_at, r.created_at))
                   < now() - make_interval(mins => 2 * COALESCE(ps.drive_stuck_ride_alert_min, 120))
              THEN 'critical' ELSE 'warning' END,
         CASE WHEN MIN(COALESCE(r.started_at, r.arrived_at, r.accepted_at, r.created_at))
                   < now() - make_interval(mins => 2 * COALESCE(ps.drive_stuck_ride_alert_min, 120))
              THEN 3 ELSE 2 END,
         COUNT(*)::int,
         MIN(COALESCE(r.started_at, r.arrived_at, r.accepted_at, r.created_at)),
         'Courses Drive bloquées (à trancher)', '/admin/chauffeurs/courses'
    FROM public.rides r
   CROSS JOIN public.platform_settings ps
   WHERE ps.id = true
     AND COALESCE(ps.drive_stuck_ride_alert_min, 120) > 0
     AND r.status IN ('accepted', 'arriving', 'arrived', 'in_progress')
     AND COALESCE(r.started_at, r.arrived_at, r.accepted_at, r.created_at)
         < now() - make_interval(mins => COALESCE(ps.drive_stuck_ride_alert_min, 120))
  GROUP BY ps.drive_stuck_ride_alert_min
  HAVING COUNT(*) > 0

  UNION ALL
  SELECT 'rides_searching_card_expired', 'drive', 'warning', 2,
         COUNT(*)::int, MIN(r.expires_at),
         'Recherches Drive payées carte expirées (à rembourser)',
         '/admin/chauffeurs/courses'
    FROM public.rides r
   WHERE r.status = 'searching'
     AND r.payment_method = 'card'
     AND r.online_paid_at IS NOT NULL
     AND r.expires_at IS NOT NULL
     AND r.expires_at < now()
  HAVING COUNT(*) > 0;
$$;
REVOKE ALL ON FUNCTION public._admin_alert_rules_drive()
  FROM PUBLIC, authenticated, anon;
