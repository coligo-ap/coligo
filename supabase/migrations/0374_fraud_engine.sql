-- ============================================================================
-- 0374 — ANTI-FRAUDE : MOTEUR (features, détecteurs, scoring, apprentissage,
--         sweep d'auto-déconnexion, RPC client + RPC admin, alertes globales)
--
-- Voir docs/ANTI-FRAUDE.md. Dépend de 0373 (tables + catalogue de règles).
--
-- Grants (fin de fichier) :
--   • fonctions moteur (ingest/evaluate/tick/daily…) : service_role SEUL ;
--   • fraud_touch_driver_presence / customer_fraud_gate /
--     customer_fraud_acknowledge : authenticated (scellées auth.uid()) ;
--   • admin_fraud_* : authenticated + garde interne admin_can('confiance')
--     (RAISE 42501) — cf. reference_admin_rpc_execute_grant.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) Règles « système » (alertes émises par le moteur lui-même, poids 0)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.fraud_rules
  (code, actor_kind, category, label, description, base_weight, params, severity) VALUES
  ('SYS_RECOMMEND_SUSPEND', 'all', 'systeme', 'Suspension recommandée',
   'Risk score au-dessus du seuil de suspension — décision humaine requise.',
   0, '{}', 'critical'),
  ('SYS_AUTO_OFFLINE', 'all', 'systeme', 'Déconnexion automatique',
   'Partenaire déconnecté automatiquement (inactivité ou offres ignorées).',
   0, '{}', 'low')
ON CONFLICT (code) DO NOTHING;

-- Réglage supplémentaire
INSERT INTO public.fraud_settings (key, value, label) VALUES
  ('force_offline_cooldown_min', '30', 'Durée (min) du hors-ligne forcé après offres ignorées')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Helpers
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fraud_setting_num(p_key TEXT, p_default NUMERIC)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    (SELECT NULLIF(value #>> '{}', '')::numeric FROM public.fraud_settings WHERE key = p_key),
    p_default);
$$;

CREATE OR REPLACE FUNCTION public.fraud_setting_bool(p_key TEXT, p_default BOOLEAN)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    (SELECT NULLIF(value #>> '{}', '')::boolean FROM public.fraud_settings WHERE key = p_key),
    p_default);
$$;

-- Distance haversine en mètres (aucune dépendance).
CREATE OR REPLACE FUNCTION public.fraud_distance_m(
  lat1 float8, lng1 float8, lat2 float8, lng2 float8)
RETURNS float8 LANGUAGE sql IMMUTABLE AS $$
  SELECT 2 * 6371000 * asin(least(1.0, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2))
      * power(sin(radians(lng2 - lng1) / 2), 2))));
$$;

CREATE OR REPLACE FUNCTION public.fraud_sev_rank(p TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'critical' THEN 4 WHEN 'high' THEN 3
                WHEN 'medium' THEN 2 ELSE 1 END;
$$;

-- APPRENTISSAGE : multiplicateur de poids bayésien. Précision estimée avec
-- prior Beta(2,1) (optimiste 2/3), normalisée pour qu'une règle jamais jugée
-- garde son poids de base, bornée par les réglages.
CREATE OR REPLACE FUNCTION public.fraud_rule_weight(p_confirmed INT, p_dismissed INT)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT GREATEST(public.fraud_setting_num('learning_weight_min', 0.2),
         LEAST(public.fraud_setting_num('learning_weight_max', 1.5),
           ((COALESCE(p_confirmed, 0) + 2.0)
             / (COALESCE(p_confirmed, 0) + COALESCE(p_dismissed, 0) + 3.0))
           / (2.0 / 3.0)));
$$;

-- Points d'une règle : 0 sous le seuil ; 50 % du poids au seuil, 100 % à 2×.
CREATE OR REPLACE FUNCTION public.fraud_points(w NUMERIC, mult NUMERIC, v NUMERIC, thr NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN v IS NULL OR thr IS NULL OR thr <= 0 OR v < thr THEN 0
    ELSE round(w * mult * (0.5 + 0.5 * LEAST(1.0, (v - thr) / GREATEST(thr, 0.001))), 2)
  END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Features par acteur — fenêtres 7/30/90 j sur l'HISTORIQUE EXISTANT
--    + les fraud_events (flags calculés à l'ingestion, cf. fraud_ingest_cancel)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fraud_compute_features(p_kind TEXT, p_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  f JSONB := '{}'::jsonb;
  v_user UUID;
  n1 NUMERIC; n2 NUMERIC; n3 NUMERIC; n4 NUMERIC;
BEGIN
  IF p_kind = 'customer' THEN
    SELECT c.user_id INTO v_user FROM public.customers c WHERE c.id = p_id;
    SELECT jsonb_build_object(
      'orders_30d',  (SELECT count(*) FROM public.orders o
                       WHERE o.customer_id = p_id AND o.created_at > now() - interval '30 days'),
      'orders_cancelled_30d', (SELECT count(DISTINCT o.id) FROM public.orders o
                       JOIN public.order_events oe ON oe.order_id = o.id
                        AND oe.to_status = 'cancelled' AND oe.note LIKE 'Annulée par le client%'
                       WHERE o.customer_id = p_id AND oe.created_at > now() - interval '30 days'),
      'rides_30d',   (SELECT count(*) FROM public.rides r
                       WHERE r.customer_id = p_id AND r.created_at > now() - interval '30 days'),
      'rides_cancelled_30d', (SELECT count(*) FROM public.rides r
                       WHERE r.customer_id = p_id AND r.cancelled_by = 'customer'
                         AND r.cancelled_at > now() - interval '30 days'),
      'cancel_after_accept_30d',
        (SELECT count(*) FROM public.rides r
          WHERE r.customer_id = p_id AND r.cancelled_by = 'customer'
            AND r.accepted_at IS NOT NULL AND r.cancelled_at > now() - interval '30 days')
        + (SELECT count(DISTINCT o.id) FROM public.orders o
            JOIN public.order_events oe ON oe.order_id = o.id
             AND oe.to_status = 'cancelled' AND oe.note LIKE 'Annulée par le client%'
             AND oe.from_status IN ('accepted','preparing','ready')
           WHERE o.customer_id = p_id AND oe.created_at > now() - interval '30 days'),
      'near_dest_cancels_90d', (SELECT count(*) FROM public.fraud_events e
          WHERE e.actor_kind = 'customer' AND e.actor_id = p_id AND e.event_type = 'cancel'
            AND e.created_at > now() - interval '90 days'
            AND (e.meta ->> 'near_dest') = 'true' AND (e.meta ->> 'by') = 'customer'),
      'contact_cancels_90d', (SELECT count(*) FROM public.fraud_events e
          WHERE e.actor_kind = 'customer' AND e.actor_id = p_id AND e.event_type = 'cancel'
            AND e.created_at > now() - interval '90 days'
            AND (e.meta ->> 'after_contact') = 'true' AND (e.meta ->> 'by') = 'customer'),
      'suspicious_90d', (SELECT count(*) FROM public.fraud_events e
          WHERE e.actor_kind = 'customer' AND e.actor_id = p_id AND e.event_type = 'cancel'
            AND e.created_at > now() - interval '90 days'
            AND (e.meta ->> 'by') = 'customer'
            AND ((e.meta ->> 'near_dest') = 'true' OR (e.meta ->> 'after_contact') = 'true')),
      'noshow_count', (SELECT COALESCE(c.noshow_count, 0) FROM public.customers c WHERE c.id = p_id),
      'refunds_90d', (SELECT count(*) FROM public.orders o
          WHERE o.customer_id = p_id AND COALESCE(o.admin_refunded_da, 0) > 0
            AND o.created_at > now() - interval '90 days'),
      'completed_lifetime',
        (SELECT count(*) FROM public.orders o WHERE o.customer_id = p_id AND o.status = 'completed')
        + (SELECT count(*) FROM public.rides r WHERE r.customer_id = p_id AND r.status = 'completed'),
      'tenure_days', (SELECT GREATEST(0, extract(day FROM now() - c.created_at))::int
                        FROM public.customers c WHERE c.id = p_id),
      'rating_avg',  (SELECT COALESCE(c.rating_avg, 0) FROM public.customers c WHERE c.id = p_id),
      'rating_count',(SELECT COALESCE(c.rating_count, 0) FROM public.customers c WHERE c.id = p_id),
      'verified', false,
      'complaints_90d', (SELECT count(*) FROM public.rides r
          JOIN public.ride_reports rr ON rr.ride_id = r.id
         WHERE r.customer_id = p_id AND rr.reporter = 'chauffeur'
           AND rr.created_at > now() - interval '90 days')
    ) INTO f;
    -- taux d'annulation combiné commandes + courses
    n1 := (f ->> 'orders_30d')::numeric + (f ->> 'rides_30d')::numeric;
    n2 := (f ->> 'orders_cancelled_30d')::numeric + (f ->> 'rides_cancelled_30d')::numeric;
    f := f || jsonb_build_object(
      'events_30d', n1,
      'cancel_rate_30d', round(n2 / GREATEST(n1, 1), 3));

  ELSIF p_kind = 'driver' THEN
    SELECT d.user_id INTO v_user FROM public.drivers d WHERE d.id = p_id;
    SELECT jsonb_build_object(
      'declines_7d', (SELECT count(*) FROM public.express_declines ed
          WHERE ed.driver_id = p_id AND ed.declined_at > now() - interval '7 days'),
      'accepts_7d', (SELECT count(*) FROM public.orders o
          WHERE o.delivery_driver_id = p_id
            AND o.delivery_picked_up_at > now() - interval '7 days'),
      'offers_seen_7d', (SELECT count(*) FROM public.fraud_events e
          WHERE e.actor_kind = 'driver' AND e.actor_id = p_id
            AND e.event_type = 'offer_seen' AND e.created_at > now() - interval '7 days'),
      'offers_ignored_7d', (SELECT count(*) FROM public.fraud_events e
          WHERE e.actor_kind = 'driver' AND e.actor_id = p_id
            AND e.event_type = 'offer_ignored' AND e.created_at > now() - interval '7 days'),
      'cancel_after_pickup_30d', (SELECT count(*) FROM public.fraud_events e
          WHERE e.actor_kind = 'driver' AND e.actor_id = p_id AND e.event_type = 'cancel'
            AND e.created_at > now() - interval '30 days'
            AND (e.meta ->> 'phase') = 'after_pickup' AND (e.meta ->> 'by') = 'driver'),
      'near_dest_cancels_90d', (SELECT count(*) FROM public.fraud_events e
          WHERE e.actor_kind = 'driver' AND e.actor_id = p_id AND e.event_type = 'cancel'
            AND e.created_at > now() - interval '90 days'
            AND (e.meta ->> 'near_dest') = 'true'),
      'contact_cancels_90d', (SELECT count(*) FROM public.fraud_events e
          WHERE e.actor_kind = 'driver' AND e.actor_id = p_id AND e.event_type = 'cancel'
            AND e.created_at > now() - interval '90 days'
            AND (e.meta ->> 'after_contact') = 'true' AND (e.meta ->> 'by') = 'customer'),
      'idle_hours_7d', (SELECT COALESCE(sum(NULLIF(e.meta ->> 'session_min', '')::numeric), 0) / 60.0
          FROM public.fraud_events e
         WHERE e.actor_kind = 'driver' AND e.actor_id = p_id
           AND e.event_type IN ('went_offline','forced_offline')
           AND e.created_at > now() - interval '7 days'
           AND (e.meta ->> 'idle') = 'true'),
      'complaints_90d', (SELECT count(*) FROM public.delivery_reports dr
          WHERE dr.driver_id = p_id AND dr.reporter_role = 'customer'
            AND dr.created_at > now() - interval '90 days'),
      'completed_lifetime', (SELECT count(*) FROM public.orders o
          WHERE o.delivery_driver_id = p_id AND o.delivery_delivered_at IS NOT NULL),
      'tenure_days', (SELECT GREATEST(0, extract(day FROM now() - d.created_at))::int
                        FROM public.drivers d WHERE d.id = p_id),
      'rating_avg',  (SELECT COALESCE(d.rating_avg, 0) FROM public.drivers d WHERE d.id = p_id),
      'rating_count',(SELECT COALESCE(d.rating_count, 0) FROM public.drivers d WHERE d.id = p_id),
      'verified', (SELECT COALESCE(d.is_verified, false) FROM public.drivers d WHERE d.id = p_id)
    ) INTO f;
    n1 := (f ->> 'declines_7d')::numeric;
    n2 := (f ->> 'accepts_7d')::numeric;
    f := f || jsonb_build_object(
      'decisions_7d', n1 + n2,
      'decline_rate_7d', round(n1 / GREATEST(n1 + n2, 1), 3));

  ELSIF p_kind = 'chauffeur' THEN
    SELECT c.user_id INTO v_user FROM public.chauffeurs c WHERE c.id = p_id;
    SELECT jsonb_build_object(
      'rides_30d', (SELECT count(*) FROM public.rides r
          WHERE r.chauffeur_id = p_id AND r.accepted_at > now() - interval '30 days'),
      'cancels_30d', (SELECT count(*) FROM public.rides r
          WHERE r.chauffeur_id = p_id AND r.cancelled_by = 'chauffeur'
            AND r.cancelled_at > now() - interval '30 days'),
      'cancel_after_move_30d', (SELECT count(*) FROM public.rides r
          WHERE r.chauffeur_id = p_id AND r.cancelled_by = 'chauffeur'
            AND r.cancelled_at > now() - interval '30 days'
            AND (r.arrived_at IS NOT NULL
                 OR (r.accepted_at IS NOT NULL AND r.cancelled_at - r.accepted_at > interval '4 minutes'))),
      'near_dest_cancels_90d', (SELECT count(*) FROM public.fraud_events e
          WHERE e.actor_kind = 'chauffeur' AND e.actor_id = p_id AND e.event_type = 'cancel'
            AND e.created_at > now() - interval '90 days'
            AND (e.meta ->> 'near_dest') = 'true'),
      'contact_cancels_90d', (SELECT count(*) FROM public.fraud_events e
          WHERE e.actor_kind = 'chauffeur' AND e.actor_id = p_id AND e.event_type = 'cancel'
            AND e.created_at > now() - interval '90 days'
            AND (e.meta ->> 'after_contact') = 'true' AND (e.meta ->> 'by') = 'customer'),
      'complaints_90d', (SELECT count(*) FROM public.rides r
          JOIN public.ride_reports rr ON rr.ride_id = r.id
         WHERE r.chauffeur_id = p_id AND rr.reporter <> 'chauffeur'
           AND rr.created_at > now() - interval '90 days'),
      'offers_7d', (SELECT count(*) FROM public.ride_offers ro
          WHERE ro.chauffeur_id = p_id AND ro.created_at > now() - interval '7 days'),
      'online_hours_7d', (SELECT COALESCE(sum(NULLIF(e.meta ->> 'session_min', '')::numeric), 0) / 60.0
          FROM public.fraud_events e
         WHERE e.actor_kind = 'chauffeur' AND e.actor_id = p_id
           AND e.event_type IN ('went_offline','forced_offline')
           AND e.created_at > now() - interval '7 days'),
      'completed_lifetime', (SELECT count(*) FROM public.rides r
          WHERE r.chauffeur_id = p_id AND r.status = 'completed'),
      'tenure_days', (SELECT GREATEST(0, extract(day FROM now() - c.created_at))::int
                        FROM public.chauffeurs c WHERE c.id = p_id),
      'rating_avg', (SELECT COALESCE(avg(r.chauffeur_rating), 0) FROM public.rides r
          WHERE r.chauffeur_id = p_id AND r.chauffeur_rating IS NOT NULL),
      'rating_count', (SELECT count(*) FROM public.rides r
          WHERE r.chauffeur_id = p_id AND r.chauffeur_rating IS NOT NULL),
      'verified', (SELECT COALESCE(c.is_verified, false) FROM public.chauffeurs c WHERE c.id = p_id)
    ) INTO f;
    n1 := (f ->> 'rides_30d')::numeric;
    n2 := (f ->> 'cancels_30d')::numeric;
    n3 := (f ->> 'online_hours_7d')::numeric;
    f := f || jsonb_build_object(
      'cancel_rate_30d', round(n2 / GREATEST(n1 + n2, 1), 3),
      'ghost_hours_7d', CASE WHEN (f ->> 'offers_7d')::numeric = 0 THEN round(n3, 1) ELSE 0 END);

  ELSIF p_kind = 'merchant' THEN
    SELECT m.user_id INTO v_user FROM public.merchants m WHERE m.id = p_id;
    SELECT jsonb_build_object(
      'orders_30d', (SELECT count(*) FROM public.orders o
          WHERE o.merchant_id = p_id AND o.created_at > now() - interval '30 days'),
      'cancels_30d', (SELECT count(DISTINCT oe.order_id) FROM public.orders o
          JOIN public.order_events oe ON oe.order_id = o.id
           AND oe.to_status = 'cancelled' AND oe.note LIKE 'Annulée par le commerçant%'
         WHERE o.merchant_id = p_id AND oe.created_at > now() - interval '30 days'),
      'cancel_after_accept_30d', (SELECT count(DISTINCT oe.order_id) FROM public.orders o
          JOIN public.order_events oe ON oe.order_id = o.id
           AND oe.to_status = 'cancelled' AND oe.note LIKE 'Annulée par le commerçant%'
           AND oe.from_status IN ('accepted','preparing','ready')
         WHERE o.merchant_id = p_id AND oe.created_at > now() - interval '30 days'),
      'contact_cancels_90d', (SELECT count(*) FROM public.fraud_events e
          WHERE e.actor_kind = 'merchant' AND e.actor_id = p_id AND e.event_type = 'cancel'
            AND e.created_at > now() - interval '90 days'
            AND (e.meta ->> 'after_contact') = 'true' AND (e.meta ->> 'by') = 'customer'),
      'avg_accept_min_30d', (SELECT COALESCE(round(avg(
            extract(epoch FROM oe.created_at - o.created_at) / 60.0)::numeric, 1), 0)
          FROM public.orders o
          JOIN public.order_events oe ON oe.order_id = o.id AND oe.to_status = 'accepted'
         WHERE o.merchant_id = p_id AND o.created_at > now() - interval '30 days'),
      'completed_lifetime', (SELECT count(*) FROM public.orders o
          WHERE o.merchant_id = p_id AND o.status = 'completed'),
      'tenure_days', (SELECT GREATEST(0, extract(day FROM now() - m.created_at))::int
                        FROM public.merchants m WHERE m.id = p_id),
      'rating_avg',  (SELECT COALESCE(m.rating_avg, 0) FROM public.merchants m WHERE m.id = p_id),
      'rating_count',(SELECT COALESCE(m.rating_count, 0) FROM public.merchants m WHERE m.id = p_id),
      'verified', (SELECT m.approval_status = 'approved' FROM public.merchants m WHERE m.id = p_id),
      'complaints_90d', 0
    ) INTO f;
    n1 := (f ->> 'orders_30d')::numeric;
    n2 := (f ->> 'cancels_30d')::numeric;
    f := f || jsonb_build_object(
      'reject_rate_30d', round(n2 / GREATEST(n1, 1), 3));
  ELSE
    RETURN NULL;
  END IF;

  -- Multi-comptes : nb max de comptes distincts partageant une de ses IP (30 j)
  f := f || jsonb_build_object('shared_accounts_30d', COALESCE((
    SELECT MAX(cnt) FROM (
      SELECT count(DISTINCT u2.user_id) AS cnt
        FROM public.user_device_log u1
        JOIN public.user_device_log u2
          ON u2.ip = u1.ip AND u2.last_seen_at > now() - interval '30 days'
       WHERE u1.user_id = v_user AND u1.last_seen_at > now() - interval '30 days'
       GROUP BY u1.ip) s), 0));

  -- Collusion : paire (acteur × contrepartie) la plus récidiviste (90 j)
  f := f || jsonb_build_object('pair_max_90d', COALESCE((
    SELECT MAX(cnt) FROM (
      SELECT count(*) AS cnt
        FROM public.fraud_events e
       WHERE e.actor_kind = p_kind AND e.actor_id = p_id AND e.event_type = 'cancel'
         AND e.created_at > now() - interval '90 days'
         AND e.counterparty_id IS NOT NULL
         AND ((e.meta ->> 'near_dest') = 'true' OR (e.meta ->> 'after_contact') = 'true')
       GROUP BY e.counterparty_kind, e.counterparty_id) s), 0));

  -- Anomalie vs pairs : z-score max sur la métrique clé de la population
  n4 := NULL;
  SELECT MAX((( (f ->> ps.metric)::numeric - ps.mean ) / ps.stddev)) INTO n4
    FROM public.fraud_population_stats ps
   WHERE ps.actor_kind = p_kind AND ps.stddev > 0 AND ps.n >= 8
     AND ps.metric IN ('cancel_rate_30d','decline_rate_7d','reject_rate_30d','avg_accept_min_30d')
     AND (f ->> ps.metric) IS NOT NULL;
  f := f || jsonb_build_object('peer_z_max', COALESCE(round(n4, 2), 0));

  RETURN f;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Évaluation d'un acteur : règles × poids appris → scores + alertes +
--    actions automatiques progressives. Cœur du moteur.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fraud_evaluate_actor(
  p_kind TEXT, p_id UUID, p_reason TEXT DEFAULT 'event')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  f JSONB;
  rl RECORD;
  old_row public.fraud_scores%ROWTYPE;
  comps JSONB := '[]'::jsonb;
  v NUMERIC; thr NUMERIC; pts NUMERIC; mult NUMERIC; total NUMERIC := 0;
  v_user UUID; v_name TEXT;
  v_trust INT; v_fraud INT; v_risk INT; v_level TEXT;
  v_susp INT := 0;
  v_ack_thr INT; v_warn INT; v_limit INT; v_suspend INT;
  side JSONB;
BEGIN
  IF p_kind NOT IN ('customer','driver','chauffeur','merchant') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_kind');
  END IF;

  f := public.fraud_compute_features(p_kind, p_id);
  IF f IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_features'); END IF;

  IF p_kind = 'customer' THEN
    SELECT c.user_id, c.full_name INTO v_user, v_name FROM public.customers c WHERE c.id = p_id;
  ELSIF p_kind = 'driver' THEN
    SELECT d.user_id, d.full_name INTO v_user, v_name FROM public.drivers d WHERE d.id = p_id;
  ELSIF p_kind = 'chauffeur' THEN
    SELECT c.user_id, c.full_name INTO v_user, v_name FROM public.chauffeurs c WHERE c.id = p_id;
  ELSE
    SELECT m.user_id, m.name INTO v_user, v_name FROM public.merchants m WHERE m.id = p_id;
  END IF;
  IF v_name IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'actor_not_found'); END IF;

  -- ── Règles ────────────────────────────────────────────────────────────────
  FOR rl IN
    SELECT * FROM public.fraud_rules
     WHERE enabled AND base_weight > 0 AND (actor_kind = p_kind OR actor_kind = 'all')
  LOOP
    v := NULL; thr := NULL;
    CASE rl.code
      WHEN 'CST_CANCEL_RATE' THEN
        IF (f ->> 'events_30d')::numeric >= COALESCE((rl.params ->> 'min_events')::numeric, 5) THEN
          v := (f ->> 'cancel_rate_30d')::numeric; thr := (rl.params ->> 'ratio')::numeric;
        END IF;
      WHEN 'CST_CANCEL_AFTER_ACCEPT' THEN
        v := (f ->> 'cancel_after_accept_30d')::numeric; thr := (rl.params ->> 'min_count')::numeric;
      WHEN 'CST_CANCEL_NEAR_DEST' THEN
        v := (f ->> 'near_dest_cancels_90d')::numeric; thr := (rl.params ->> 'min_count')::numeric;
      WHEN 'CST_CONTACT_THEN_CANCEL' THEN
        v := (f ->> 'contact_cancels_90d')::numeric; thr := (rl.params ->> 'min_count')::numeric;
      WHEN 'CST_NOSHOW' THEN
        v := (f ->> 'noshow_count')::numeric; thr := (rl.params ->> 'min_count')::numeric;
      WHEN 'CST_MULTI_ACCOUNT' THEN
        v := (f ->> 'shared_accounts_30d')::numeric; thr := (rl.params ->> 'min_accounts')::numeric;
      WHEN 'CST_REFUND_ABUSE' THEN
        v := (f ->> 'refunds_90d')::numeric; thr := (rl.params ->> 'min_count')::numeric;
      WHEN 'DRV_DECLINE_RATE' THEN
        IF (f ->> 'decisions_7d')::numeric >= COALESCE((rl.params ->> 'min_decisions')::numeric, 8) THEN
          v := (f ->> 'decline_rate_7d')::numeric; thr := (rl.params ->> 'ratio')::numeric;
        END IF;
      WHEN 'DRV_OFFER_IGNORED' THEN
        v := (f ->> 'offers_ignored_7d')::numeric; thr := (rl.params ->> 'min_count')::numeric;
      WHEN 'DRV_CANCEL_AFTER_PICKUP' THEN
        v := (f ->> 'cancel_after_pickup_30d')::numeric; thr := (rl.params ->> 'min_count')::numeric;
      WHEN 'DRV_CANCEL_NEAR_DEST' THEN
        v := (f ->> 'near_dest_cancels_90d')::numeric; thr := (rl.params ->> 'min_count')::numeric;
      WHEN 'DRV_CONTACT_THEN_CANCEL' THEN
        v := (f ->> 'contact_cancels_90d')::numeric; thr := (rl.params ->> 'min_count')::numeric;
      WHEN 'DRV_IDLE_ONLINE' THEN
        v := (f ->> 'idle_hours_7d')::numeric; thr := (rl.params ->> 'min_hours')::numeric;
      WHEN 'DRV_MULTI_ACCOUNT' THEN
        v := (f ->> 'shared_accounts_30d')::numeric; thr := (rl.params ->> 'min_accounts')::numeric;
      WHEN 'DRV_COMPLAINTS' THEN
        v := (f ->> 'complaints_90d')::numeric; thr := (rl.params ->> 'min_count')::numeric;
      WHEN 'CHF_CANCEL_AFTER_ACCEPT' THEN
        IF (f ->> 'rides_30d')::numeric >= COALESCE((rl.params ->> 'min_rides')::numeric, 5) THEN
          v := (f ->> 'cancel_rate_30d')::numeric; thr := (rl.params ->> 'ratio')::numeric;
        END IF;
      WHEN 'CHF_CANCEL_AFTER_MOVE' THEN
        v := (f ->> 'cancel_after_move_30d')::numeric; thr := (rl.params ->> 'min_count')::numeric;
      WHEN 'CHF_CANCEL_NEAR_DEST' THEN
        v := (f ->> 'near_dest_cancels_90d')::numeric; thr := (rl.params ->> 'min_count')::numeric;
      WHEN 'CHF_CONTACT_THEN_CANCEL' THEN
        v := (f ->> 'contact_cancels_90d')::numeric; thr := (rl.params ->> 'min_count')::numeric;
      WHEN 'CHF_COMPLAINTS' THEN
        v := (f ->> 'complaints_90d')::numeric; thr := (rl.params ->> 'min_count')::numeric;
      WHEN 'CHF_GHOST_ONLINE' THEN
        v := (f ->> 'ghost_hours_7d')::numeric; thr := (rl.params ->> 'min_hours')::numeric;
      WHEN 'CHF_MULTI_ACCOUNT' THEN
        v := (f ->> 'shared_accounts_30d')::numeric; thr := (rl.params ->> 'min_accounts')::numeric;
      WHEN 'MRC_REJECT_RATE' THEN
        IF (f ->> 'orders_30d')::numeric >= COALESCE((rl.params ->> 'min_orders')::numeric, 5) THEN
          v := (f ->> 'reject_rate_30d')::numeric; thr := (rl.params ->> 'ratio')::numeric;
        END IF;
      WHEN 'MRC_CANCEL_AFTER_ACCEPT' THEN
        v := (f ->> 'cancel_after_accept_30d')::numeric; thr := (rl.params ->> 'min_count')::numeric;
      WHEN 'MRC_CONTACT_THEN_CANCEL' THEN
        v := (f ->> 'contact_cancels_90d')::numeric; thr := (rl.params ->> 'min_count')::numeric;
      WHEN 'MRC_SLOW_RESPONSE' THEN
        IF (f ->> 'orders_30d')::numeric >= COALESCE((rl.params ->> 'min_orders')::numeric, 5) THEN
          v := (f ->> 'peer_z_max')::numeric; thr := COALESCE((rl.params ->> 'z')::numeric, 2.5);
        END IF;
      WHEN 'COL_REPEAT_PAIR' THEN
        v := (f ->> 'pair_max_90d')::numeric; thr := (rl.params ->> 'min_count')::numeric;
      WHEN 'ANO_PEER_OUTLIER' THEN
        v := (f ->> 'peer_z_max')::numeric; thr := COALESCE((rl.params ->> 'z')::numeric, 2.5);
      ELSE
        NULL;
    END CASE;

    IF v IS NULL OR thr IS NULL THEN CONTINUE; END IF;
    mult := public.fraud_rule_weight(rl.confirmed_hits, rl.dismissed_hits);
    pts := public.fraud_points(rl.base_weight, mult, v, thr);
    comps := comps || jsonb_build_array(jsonb_build_object(
      'rule', rl.code, 'label', rl.label, 'category', rl.category,
      'value', round(v, 3), 'threshold', thr, 'points', pts,
      'weight_mult', round(mult, 2), 'severity', rl.severity,
      'triggered', pts > 0));
    IF pts <= 0 THEN CONTINUE; END IF;
    total := total + pts;

    -- Alerte (dédupliquée tant qu'ouverte) pour les règles medium et plus
    IF public.fraud_sev_rank(rl.severity) >= 2 THEN
      UPDATE public.fraud_alerts fa
         SET occurrences = fa.occurrences + 1,
             last_seen_at = now(),
             display_name = v_name,
             severity = CASE WHEN public.fraud_sev_rank(rl.severity) > public.fraud_sev_rank(fa.severity)
                             THEN rl.severity ELSE fa.severity END,
             evidence = jsonb_build_object('value', round(v, 3), 'threshold', thr,
                                           'points', pts, 'features', f)
       WHERE fa.actor_kind = p_kind AND fa.actor_id = p_id AND fa.rule_code = rl.code
         AND fa.status IN ('open','investigating');
      IF NOT FOUND THEN
        INSERT INTO public.fraud_alerts
          (actor_kind, actor_id, user_id, display_name, rule_code, severity, title, evidence)
        VALUES (p_kind, p_id, v_user, v_name, rl.code, rl.severity, rl.label,
                jsonb_build_object('value', round(v, 3), 'threshold', thr,
                                   'points', pts, 'features', f));
        UPDATE public.fraud_rules SET hits = hits + 1 WHERE code = rl.code;
      END IF;
    END IF;
  END LOOP;

  -- ── Scores ────────────────────────────────────────────────────────────────
  v_fraud := LEAST(100, GREATEST(0, round(total)))::int;
  v_trust := LEAST(100, GREATEST(0, round(
      35
      + LEAST(20, ln(1 + COALESCE((f ->> 'completed_lifetime')::numeric, 0)) * 4.5)
      + LEAST(15, COALESCE((f ->> 'tenure_days')::numeric, 0) / 30.0)
      + CASE WHEN COALESCE((f ->> 'rating_count')::numeric, 0) >= 3
             THEN GREATEST(-10, LEAST(15, (COALESCE((f ->> 'rating_avg')::numeric, 0) - 3) * 7.5))
             ELSE 0 END
      + CASE WHEN (f ->> 'verified')::boolean THEN 10 ELSE 0 END
      - LEAST(15, COALESCE((f ->> 'complaints_90d')::numeric, 0) * 3)
      - v_fraud / 4.0)))::int;
  v_risk := LEAST(100, GREATEST(0, round(v_fraud * (1.35 - v_trust / 200.0))))::int;
  v_level := CASE WHEN v_risk >= 75 THEN 'critical' WHEN v_risk >= 50 THEN 'high'
                  WHEN v_risk >= 25 THEN 'medium' ELSE 'low' END;
  v_susp := COALESCE((f ->> 'suspicious_90d')::int, 0);

  SELECT * INTO old_row FROM public.fraud_scores
   WHERE actor_kind = p_kind AND actor_id = p_id;

  INSERT INTO public.fraud_scores AS fs
    (actor_kind, actor_id, user_id, display_name, trust_score, fraud_score,
     risk_score, risk_level, components, features, suspicious_count, evaluated_at)
  VALUES (p_kind, p_id, v_user, v_name, v_trust, v_fraud, v_risk, v_level,
          comps, f, v_susp, now())
  ON CONFLICT (actor_kind, actor_id) DO UPDATE SET
    user_id = EXCLUDED.user_id, display_name = EXCLUDED.display_name,
    trust_score = EXCLUDED.trust_score, fraud_score = EXCLUDED.fraud_score,
    risk_score = EXCLUDED.risk_score, risk_level = EXCLUDED.risk_level,
    components = EXCLUDED.components, features = EXCLUDED.features,
    suspicious_count = EXCLUDED.suspicious_count, evaluated_at = now();

  IF old_row.actor_id IS NULL
     OR abs(old_row.risk_score - v_risk) >= 2
     OR old_row.risk_level <> v_level THEN
    INSERT INTO public.fraud_score_history
      (actor_kind, actor_id, trust_score, fraud_score, risk_score, reason, components)
    VALUES (p_kind, p_id, v_trust, v_fraud, v_risk, p_reason, comps);
  END IF;

  -- ── Actions automatiques progressives ─────────────────────────────────────
  v_ack_thr := public.fraud_setting_num('customer_ack_threshold', 3)::int;
  v_warn    := public.fraud_setting_num('auto_warn_risk', 50)::int;
  v_limit   := public.fraud_setting_num('auto_limit_risk', 70)::int;
  v_suspend := public.fraud_setting_num('auto_suspend_risk', 90)::int;

  -- Popup client obligatoire (≥ N situations suspectes, re-déclenchée à chaque
  -- NOUVELLE situation après acquittement)
  IF p_kind = 'customer' AND v_susp >= v_ack_thr THEN
    IF NOT EXISTS (SELECT 1 FROM public.fraud_actions a
                    WHERE a.actor_kind = 'customer' AND a.actor_id = p_id
                      AND a.action = 'require_ack' AND a.revoked_at IS NULL)
       AND COALESCE((SELECT MAX(NULLIF(k.context ->> 'suspicious_count', '')::int)
                       FROM public.customer_fraud_acks k WHERE k.customer_id = p_id), -1) < v_susp
    THEN
      INSERT INTO public.fraud_actions
        (actor_kind, actor_id, user_id, action, source, reason, meta, notified_at)
      VALUES ('customer', p_id, v_user, 'require_ack', 'auto',
              v_susp || ' situations suspectes — avertissement anti-annulation obligatoire',
              jsonb_build_object('suspicious_count', v_susp), now());
      INSERT INTO public.fraud_events (actor_kind, actor_id, user_id, event_type, meta)
      VALUES ('customer', p_id, v_user, 'ack_required',
              jsonb_build_object('suspicious_count', v_susp));
    END IF;
  END IF;

  -- Avertissement (max 1 / 7 jours)
  IF v_risk >= v_warn AND NOT EXISTS (
       SELECT 1 FROM public.fraud_actions a
        WHERE a.actor_kind = p_kind AND a.actor_id = p_id AND a.action = 'warn'
          AND a.created_at > now() - interval '7 days') THEN
    INSERT INTO public.fraud_actions
      (actor_kind, actor_id, user_id, action, source, reason, meta)
    VALUES (p_kind, p_id, v_user, 'warn', 'auto',
            'Risk score ' || v_risk || '/100 — avertissement automatique',
            jsonb_build_object('risk', v_risk));
  END IF;

  -- Limitation
  IF v_risk >= v_limit AND NOT EXISTS (
       SELECT 1 FROM public.fraud_actions a
        WHERE a.actor_kind = p_kind AND a.actor_id = p_id AND a.action = 'limit'
          AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > now())) THEN
    side := '{}'::jsonb;
    IF p_kind = 'customer' THEN
      UPDATE public.customers SET cod_blocked = true
       WHERE id = p_id AND NOT COALESCE(cod_blocked, false);
      IF FOUND THEN side := jsonb_build_object('side_effect', 'cod_blocked'); END IF;
    END IF;
    INSERT INTO public.fraud_actions
      (actor_kind, actor_id, user_id, action, source, reason, meta)
    VALUES (p_kind, p_id, v_user, 'limit', 'auto',
            'Risk score ' || v_risk || '/100 — limitation automatique',
            jsonb_build_object('risk', v_risk) || side);
  END IF;

  -- Suspension : automatique SEULEMENT si activée, sinon recommandation critique
  IF v_risk >= v_suspend THEN
    IF public.fraud_setting_bool('auto_suspend_enabled', false) THEN
      IF NOT EXISTS (SELECT 1 FROM public.fraud_actions a
                      WHERE a.actor_kind = p_kind AND a.actor_id = p_id
                        AND a.action = 'suspend' AND a.revoked_at IS NULL) THEN
        side := '{}'::jsonb;
        IF p_kind = 'driver' THEN
          UPDATE public.drivers SET is_frozen = true, frozen_at = now(),
                 freeze_reason = 'Anti-fraude : risk score ' || v_risk
           WHERE id = p_id AND NOT is_frozen;
          IF FOUND THEN side := jsonb_build_object('side_effect', 'frozen'); END IF;
        ELSIF p_kind = 'chauffeur' THEN
          UPDATE public.chauffeurs SET is_frozen = true, frozen_at = now(),
                 frozen_reason = 'Anti-fraude : risk score ' || v_risk
           WHERE id = p_id AND NOT is_frozen;
          IF FOUND THEN side := jsonb_build_object('side_effect', 'frozen'); END IF;
        ELSIF p_kind = 'merchant' THEN
          UPDATE public.merchants SET is_frozen = true
           WHERE id = p_id AND NOT is_frozen;
          IF FOUND THEN side := jsonb_build_object('side_effect', 'frozen'); END IF;
        END IF;
        INSERT INTO public.fraud_actions
          (actor_kind, actor_id, user_id, action, source, reason, meta)
        VALUES (p_kind, p_id, v_user, 'suspend', 'auto',
                'Risk score ' || v_risk || '/100 — suspension automatique',
                jsonb_build_object('risk', v_risk) || side);
      END IF;
    ELSE
      UPDATE public.fraud_alerts fa
         SET occurrences = fa.occurrences + 1, last_seen_at = now(),
             display_name = v_name,
             evidence = jsonb_build_object('risk', v_risk, 'components', comps)
       WHERE fa.actor_kind = p_kind AND fa.actor_id = p_id
         AND fa.rule_code = 'SYS_RECOMMEND_SUSPEND' AND fa.status IN ('open','investigating');
      IF NOT FOUND THEN
        INSERT INTO public.fraud_alerts
          (actor_kind, actor_id, user_id, display_name, rule_code, severity, title, evidence)
        VALUES (p_kind, p_id, v_user, v_name, 'SYS_RECOMMEND_SUSPEND', 'critical',
                'Suspension recommandée — risk ' || v_risk || '/100',
                jsonb_build_object('risk', v_risk, 'components', comps));
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'trust', v_trust, 'fraud', v_fraud,
                            'risk', v_risk, 'level', v_level,
                            'suspicious', v_susp, 'components', comps);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Ingestion d'une ANNULATION : calcule les flags (phase, near_dest,
--    after_contact) UNE FOIS, écrit un événement par acteur impliqué, puis
--    ré-évalue chacun. Appelée par les server actions (service_role).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fraud_ingest_cancel(
  p_context TEXT, p_id UUID, p_by TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  near_m NUMERIC := public.fraud_setting_num('near_dest_default_m', 350);
  v_mins INT := 15;
  v_near BOOLEAN := false;
  v_phase TEXT := 'before_accept';
  v_contact_partner BOOLEAN := false;   -- le partenaire a contacté le client peu avant
  v_contact_mrc BOOLEAN := false;
  v_lat float8; v_lng float8;
  r RECORD; o RECORD;
  v_cancel_at TIMESTAMPTZ; v_from TEXT;
  res JSONB := '[]'::jsonb;
BEGIN
  IF p_context = 'ride' THEN
    SELECT rd.*, cp.lat AS plat, cp.lng AS plng, cp.updated_at AS pat,
           cu.user_id AS cust_user, ch.user_id AS chf_user
      INTO r
      FROM public.rides rd
      LEFT JOIN public.chauffeur_presence cp ON cp.chauffeur_id = rd.chauffeur_id
      LEFT JOIN public.customers cu ON cu.id = rd.customer_id
      LEFT JOIN public.chauffeurs ch ON ch.id = rd.chauffeur_id
     WHERE rd.id = p_id;
    IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'ride_not_found'); END IF;

    v_phase := CASE WHEN r.started_at IS NOT NULL THEN 'after_start'
                    WHEN r.arrived_at IS NOT NULL THEN 'after_arrive'
                    WHEN r.accepted_at IS NOT NULL THEN 'after_accept'
                    ELSE 'before_accept' END;
    IF r.plat IS NOT NULL AND r.pat > now() - interval '20 minutes' THEN
      v_lat := r.plat; v_lng := r.plng;
      v_near := public.fraud_distance_m(r.plat, r.plng, r.dest_lat, r.dest_lng) <= near_m;
    END IF;
    -- Contact du chauffeur vers le client juste avant l'annulation ?
    v_contact_partner := EXISTS (
        SELECT 1 FROM public.ride_messages rm
         WHERE rm.ride_id = p_id AND rm.sender = 'chauffeur'
           AND rm.created_at > now() - make_interval(mins => v_mins))
      OR EXISTS (
        SELECT 1 FROM public.fraud_events e
         WHERE e.ride_id = p_id AND e.event_type = 'call_initiated'
           AND (e.meta ->> 'from') = 'chauffeur'
           AND e.created_at > now() - make_interval(mins => v_mins));

    IF r.customer_id IS NOT NULL THEN
      INSERT INTO public.fraud_events
        (actor_kind, actor_id, user_id, event_type, ride_id,
         counterparty_kind, counterparty_id, lat, lng, meta)
      VALUES ('customer', r.customer_id, r.cust_user, 'cancel', p_id,
              'chauffeur', r.chauffeur_id, v_lat, v_lng,
              jsonb_build_object('by', p_by, 'phase', v_phase, 'context', 'ride',
                'near_dest', v_near,
                'after_contact', v_contact_partner AND p_by = 'customer',
                'contact_by', CASE WHEN v_contact_partner THEN 'chauffeur' END));
      res := res || public.fraud_evaluate_actor('customer', r.customer_id, 'ride_cancel');
    END IF;
    IF r.chauffeur_id IS NOT NULL THEN
      INSERT INTO public.fraud_events
        (actor_kind, actor_id, user_id, event_type, ride_id,
         counterparty_kind, counterparty_id, lat, lng, meta)
      VALUES ('chauffeur', r.chauffeur_id, r.chf_user, 'cancel', p_id,
              'customer', r.customer_id, v_lat, v_lng,
              jsonb_build_object('by', p_by, 'phase', v_phase, 'context', 'ride',
                'near_dest', v_near,
                'after_contact', v_contact_partner AND p_by = 'customer',
                'contact_by', CASE WHEN v_contact_partner THEN 'chauffeur' END));
      res := res || public.fraud_evaluate_actor('chauffeur', r.chauffeur_id, 'ride_cancel');
    END IF;

  ELSIF p_context = 'order' THEN
    SELECT od.*, cu.user_id AS cust_user, dr.user_id AS drv_user, me.user_id AS mrc_user
      INTO o
      FROM public.orders od
      LEFT JOIN public.customers cu ON cu.id = od.customer_id
      LEFT JOIN public.drivers dr ON dr.id = od.delivery_driver_id
      LEFT JOIN public.merchants me ON me.id = od.merchant_id
     WHERE od.id = p_id;
    IF o.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'order_not_found'); END IF;

    SELECT oe.created_at, oe.from_status INTO v_cancel_at, v_from
      FROM public.order_events oe
     WHERE oe.order_id = p_id AND oe.to_status = 'cancelled'
     ORDER BY oe.created_at DESC LIMIT 1;

    v_phase := CASE
      WHEN o.delivery_picked_up_at IS NOT NULL THEN 'after_pickup'
      WHEN COALESCE(v_from, o.status::text) IN ('accepted','preparing','ready') THEN 'after_accept'
      ELSE 'before_accept' END;
    IF o.driver_live_lat IS NOT NULL AND o.delivery_lat IS NOT NULL
       AND o.driver_live_at > now() - interval '20 minutes' THEN
      v_lat := o.driver_live_lat; v_lng := o.driver_live_lng;
      v_near := public.fraud_distance_m(o.driver_live_lat, o.driver_live_lng,
                                        o.delivery_lat, o.delivery_lng) <= near_m;
    END IF;
    v_contact_partner := EXISTS (
        SELECT 1 FROM public.order_messages om
         WHERE om.order_id = p_id AND om.sender_role = 'courier'
           AND om.created_at > now() - make_interval(mins => v_mins))
      OR EXISTS (
        SELECT 1 FROM public.fraud_events e
         WHERE e.order_id = p_id AND e.event_type IN ('call_initiated','contact_revealed')
           AND e.created_at > now() - make_interval(mins => v_mins));
    v_contact_mrc := EXISTS (
        SELECT 1 FROM public.order_messages om
         WHERE om.order_id = p_id AND om.sender_role = 'merchant'
           AND om.created_at > now() - make_interval(mins => v_mins));

    IF o.customer_id IS NOT NULL THEN
      INSERT INTO public.fraud_events
        (actor_kind, actor_id, user_id, event_type, order_id,
         counterparty_kind, counterparty_id, lat, lng, meta)
      VALUES ('customer', o.customer_id, o.cust_user, 'cancel', p_id,
              CASE WHEN o.delivery_driver_id IS NOT NULL THEN 'driver' ELSE 'merchant' END,
              COALESCE(o.delivery_driver_id, o.merchant_id), v_lat, v_lng,
              jsonb_build_object('by', p_by, 'phase', v_phase, 'context', 'order',
                'near_dest', v_near,
                'after_contact', (v_contact_partner OR v_contact_mrc) AND p_by = 'customer',
                'contact_by', CASE WHEN v_contact_partner THEN 'driver'
                                   WHEN v_contact_mrc THEN 'merchant' END));
      res := res || public.fraud_evaluate_actor('customer', o.customer_id, 'order_cancel');
    END IF;
    IF o.delivery_driver_id IS NOT NULL THEN
      INSERT INTO public.fraud_events
        (actor_kind, actor_id, user_id, event_type, order_id,
         counterparty_kind, counterparty_id, lat, lng, meta)
      VALUES ('driver', o.delivery_driver_id, o.drv_user, 'cancel', p_id,
              'customer', o.customer_id, v_lat, v_lng,
              jsonb_build_object('by', p_by, 'phase', v_phase, 'context', 'order',
                'near_dest', v_near,
                'after_contact', v_contact_partner AND p_by = 'customer',
                'contact_by', CASE WHEN v_contact_partner THEN 'driver' END));
      res := res || public.fraud_evaluate_actor('driver', o.delivery_driver_id, 'order_cancel');
    END IF;
    -- Le commerçant est évalué s'il a annulé lui-même OU contacté avant annulation
    IF p_by = 'merchant' OR v_contact_mrc THEN
      INSERT INTO public.fraud_events
        (actor_kind, actor_id, user_id, event_type, order_id,
         counterparty_kind, counterparty_id, meta)
      VALUES ('merchant', o.merchant_id, o.mrc_user, 'cancel', p_id,
              'customer', o.customer_id,
              jsonb_build_object('by', p_by, 'phase', v_phase, 'context', 'order',
                'after_contact', v_contact_mrc AND p_by = 'customer',
                'contact_by', CASE WHEN v_contact_mrc THEN 'merchant' END));
      res := res || public.fraud_evaluate_actor('merchant', o.merchant_id, 'order_cancel');
    END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'bad_context');
  END IF;

  RETURN jsonb_build_object('ok', true, 'results', res);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Présence livreur + détection des offres ignorées (appelée à chaque pull
--    Express par le livreur AUTHENTIFIÉ — scellée auth.uid()).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fraud_touch_driver_presence(
  p_lat float8, p_lng float8, p_offer UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  d RECORD;
  pr public.fraud_partner_presence%ROWTYPE;
  v_streak INT := 0;
  v_forced BOOLEAN := false;
  v_reason TEXT;
  v_moved BOOLEAN := true;
  v_streak_max INT := public.fraud_setting_num('partner_ignore_streak', 3)::int;
  v_cooldown INT := public.fraud_setting_num('force_offline_cooldown_min', 30)::int;
BEGIN
  SELECT dr.id, dr.user_id INTO d FROM public.drivers dr WHERE dr.user_id = auth.uid();
  IF d.id IS NULL THEN
    RAISE EXCEPTION 'Accès refusé' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO pr FROM public.fraud_partner_presence
   WHERE actor_kind = 'driver' AND actor_id = d.id
   FOR UPDATE;

  v_forced := EXISTS (
    SELECT 1 FROM public.fraud_actions a
     WHERE a.actor_kind = 'driver' AND a.actor_id = d.id AND a.action = 'force_offline'
       AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > now()));
  IF v_forced THEN v_reason := 'cooldown'; END IF;

  IF pr.actor_id IS NOT NULL THEN
    v_streak := pr.ignore_streak;
    -- L'offre précédente est-elle restée sans réponse ?
    IF pr.last_offer_id IS NOT NULL
       AND (p_offer IS DISTINCT FROM pr.last_offer_id)
       AND pr.last_offer_at < now() - interval '45 seconds' THEN
      IF NOT EXISTS (SELECT 1 FROM public.express_declines ed
                      WHERE ed.order_id = pr.last_offer_id AND ed.driver_id = d.id)
         AND NOT EXISTS (SELECT 1 FROM public.orders oo
                          WHERE oo.id = pr.last_offer_id AND oo.delivery_driver_id = d.id) THEN
        INSERT INTO public.fraud_events
          (actor_kind, actor_id, user_id, event_type, order_id, lat, lng)
        VALUES ('driver', d.id, d.user_id, 'offer_ignored', pr.last_offer_id, p_lat, p_lng);
        v_streak := v_streak + 1;
      END IF;
    END IF;
    v_moved := pr.lat IS NULL
      OR public.fraud_distance_m(pr.lat, pr.lng, p_lat, p_lng) > 30;
  END IF;

  IF p_offer IS NOT NULL AND (pr.actor_id IS NULL OR p_offer IS DISTINCT FROM pr.last_offer_id) THEN
    INSERT INTO public.fraud_events
      (actor_kind, actor_id, user_id, event_type, order_id, lat, lng)
    VALUES ('driver', d.id, d.user_id, 'offer_seen', p_offer, p_lat, p_lng);
  END IF;

  -- Seuil de non-réponses → hors ligne forcé temporaire
  IF NOT v_forced AND v_streak >= v_streak_max THEN
    INSERT INTO public.fraud_actions
      (actor_kind, actor_id, user_id, action, source, reason, meta, expires_at)
    VALUES ('driver', d.id, d.user_id, 'force_offline', 'auto',
            v_streak || ' offres ignorées d''affilée — mise hors ligne automatique',
            jsonb_build_object('cause', 'ignored_offers', 'streak', v_streak),
            now() + make_interval(mins => v_cooldown));
    INSERT INTO public.fraud_events
      (actor_kind, actor_id, user_id, event_type, lat, lng, meta)
    VALUES ('driver', d.id, d.user_id, 'forced_offline', p_lat, p_lng,
            jsonb_build_object('cause', 'ignored_offers', 'streak', v_streak));
    -- Alerte système (info) pour la traçabilité côté admin
    INSERT INTO public.fraud_alerts
      (actor_kind, actor_id, user_id, display_name, rule_code, severity, title, evidence)
    SELECT 'driver', d.id, d.user_id, dr.full_name, 'SYS_AUTO_OFFLINE', 'low',
           'Livreur mis hors ligne — offres ignorées',
           jsonb_build_object('streak', v_streak)
      FROM public.drivers dr WHERE dr.id = d.id
    ON CONFLICT (actor_kind, actor_id, rule_code) WHERE status IN ('open','investigating')
    DO UPDATE SET occurrences = fraud_alerts.occurrences + 1, last_seen_at = now();
    v_streak := 0;
    v_forced := true;
    v_reason := 'ignored_offers';
  END IF;

  INSERT INTO public.fraud_partner_presence AS fpp
    (actor_kind, actor_id, user_id, is_online, online_since, last_seen_at,
     last_moved_at, lat, lng, ignore_streak, last_offer_id, last_offer_at,
     forced_offline_at)
  VALUES ('driver', d.id, d.user_id, NOT v_forced, now(), now(),
          CASE WHEN v_moved THEN now() END, p_lat, p_lng, v_streak,
          CASE WHEN NOT v_forced THEN p_offer END,
          CASE WHEN NOT v_forced AND p_offer IS NOT NULL THEN now() END,
          CASE WHEN v_forced THEN now() END)
  ON CONFLICT (actor_kind, actor_id) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    is_online = NOT v_forced,
    online_since = CASE WHEN fpp.is_online THEN fpp.online_since ELSE now() END,
    last_seen_at = now(),
    last_moved_at = CASE WHEN v_moved THEN now() ELSE fpp.last_moved_at END,
    lat = EXCLUDED.lat, lng = EXCLUDED.lng,
    ignore_streak = v_streak,
    last_offer_id = CASE WHEN v_forced THEN NULL
                         WHEN p_offer IS NOT NULL THEN p_offer
                         ELSE NULL END,
    last_offer_at = CASE WHEN v_forced OR p_offer IS NULL THEN NULL
                         WHEN p_offer IS DISTINCT FROM fpp.last_offer_id THEN now()
                         ELSE fpp.last_offer_at END,
    forced_offline_at = CASE WHEN v_forced THEN COALESCE(fpp.forced_offline_at, now()) END;

  RETURN jsonb_build_object('forced_offline', v_forced, 'reason', v_reason);
END $$;

-- Décision explicite (accept/refus) : trace + remise à zéro de la série.
CREATE OR REPLACE FUNCTION public.fraud_note_offer_decision(
  p_driver UUID, p_order UUID, p_decision TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.fraud_events (actor_kind, actor_id, user_id, event_type, order_id)
  SELECT 'driver', p_driver, d.user_id,
         CASE WHEN p_decision = 'accept' THEN 'offer_accepted' ELSE 'offer_declined' END,
         p_order
    FROM public.drivers d WHERE d.id = p_driver;
  UPDATE public.fraud_partner_presence
     SET ignore_streak = 0, last_offer_id = NULL, last_offer_at = NULL
   WHERE actor_kind = 'driver' AND actor_id = p_driver;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) SWEEP « fraud_tick » : auto-déconnexions + file de notifications.
--    Throttlé (verrou advisory + intervalle minimal), appelé en piggyback des
--    chemins chauds et par le cron. service_role SEUL.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fraud_tick()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_last TIMESTAMPTZ;
  v_stale_chf INT := public.fraud_setting_num('chauffeur_stale_offline_min', 8)::int;
  v_stale_drv INT := public.fraud_setting_num('driver_stale_offline_min', 10)::int;
  ch RECORD; dr RECORD; a RECORD;
  pr public.fraud_partner_presence%ROWTYPE;
  n_chf INT := 0; n_drv INT := 0;
  sess NUMERIC; idle BOOLEAN;
  notifs JSONB := '[]'::jsonb;
  v_title TEXT; v_body TEXT;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('fraud_tick')) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'lock');
  END IF;
  SELECT NULLIF(value #>> '{}', '')::timestamptz INTO v_last
    FROM public.fraud_settings WHERE key = 'last_sweep_at';
  IF v_last IS NOT NULL AND v_last > now()
       - make_interval(secs => public.fraud_setting_num('sweep_min_interval_s', 60)) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'throttle');
  END IF;
  INSERT INTO public.fraud_settings (key, value, label)
  VALUES ('last_sweep_at', to_jsonb(now()::text), 'Dernière passe du sweep (interne)')
  ON CONFLICT (key) DO UPDATE SET value = to_jsonb(now()::text);

  -- 1) Chauffeurs « en ligne » à présence muette → hors ligne forcé + notif
  FOR ch IN
    SELECT cp.chauffeur_id, cp.updated_at, c.user_id, c.full_name
      FROM public.chauffeur_presence cp
      JOIN public.chauffeurs c ON c.id = cp.chauffeur_id
     WHERE cp.is_online AND cp.updated_at < now() - make_interval(mins => v_stale_chf)
  LOOP
    UPDATE public.chauffeur_presence SET is_online = false
     WHERE chauffeur_id = ch.chauffeur_id;
    SELECT * INTO pr FROM public.fraud_partner_presence
     WHERE actor_kind = 'chauffeur' AND actor_id = ch.chauffeur_id;
    sess := CASE WHEN pr.actor_id IS NOT NULL AND pr.is_online
                 THEN round(extract(epoch FROM now() - pr.online_since) / 60.0)
                 ELSE NULL END;
    idle := pr.actor_id IS NOT NULL
            AND (pr.last_moved_at IS NULL OR pr.last_moved_at < now() - interval '45 minutes');
    INSERT INTO public.fraud_partner_presence AS fpp
      (actor_kind, actor_id, user_id, is_online, online_since, last_seen_at, forced_offline_at)
    VALUES ('chauffeur', ch.chauffeur_id, ch.user_id, false, now(), ch.updated_at, now())
    ON CONFLICT (actor_kind, actor_id) DO UPDATE SET
      is_online = false, forced_offline_at = now(), user_id = EXCLUDED.user_id;
    INSERT INTO public.fraud_events
      (actor_kind, actor_id, user_id, event_type, meta)
    VALUES ('chauffeur', ch.chauffeur_id, ch.user_id, 'forced_offline',
            jsonb_build_object('cause', 'stale_presence',
                               'session_min', sess, 'idle', COALESCE(idle, false)));
    INSERT INTO public.fraud_actions
      (actor_kind, actor_id, user_id, action, source, reason, meta, expires_at)
    VALUES ('chauffeur', ch.chauffeur_id, ch.user_id, 'force_offline', 'auto',
            'Présence muette depuis plus de ' || v_stale_chf || ' min — mise hors ligne automatique',
            jsonb_build_object('cause', 'stale_presence'), now());
    n_chf := n_chf + 1;
  END LOOP;

  -- 2) Livreurs sans pull Express récent → présence close (bookkeeping silencieux)
  FOR dr IN
    SELECT * FROM public.fraud_partner_presence
     WHERE actor_kind = 'driver' AND is_online
       AND last_seen_at < now() - make_interval(mins => v_stale_drv)
  LOOP
    sess := round(extract(epoch FROM dr.last_seen_at - dr.online_since) / 60.0);
    idle := dr.last_moved_at IS NULL OR dr.last_moved_at < dr.last_seen_at - interval '45 minutes';
    UPDATE public.fraud_partner_presence
       SET is_online = false, last_offer_id = NULL, last_offer_at = NULL
     WHERE actor_kind = 'driver' AND actor_id = dr.actor_id;
    INSERT INTO public.fraud_events
      (actor_kind, actor_id, user_id, event_type, meta)
    VALUES ('driver', dr.actor_id, dr.user_id, 'went_offline',
            jsonb_build_object('cause', 'stale_pull',
                               'session_min', GREATEST(sess, 0), 'idle', idle));
    n_drv := n_drv + 1;
  END LOOP;

  -- 3) Notifications en attente (actions auto/admin) → retournées à l'appelant
  --    (le serveur Node envoie push + cloche via storeAndPushNotification).
  FOR a IN
    SELECT * FROM public.fraud_actions
     WHERE notified_at IS NULL
     ORDER BY created_at LIMIT 50
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.fraud_actions SET notified_at = now() WHERE id = a.id;
    IF a.user_id IS NULL OR a.action IN ('note', 'require_ack') THEN CONTINUE; END IF;
    v_title := CASE a.action
      WHEN 'warn' THEN 'Avertissement Coligo'
      WHEN 'limit' THEN 'Compte limité temporairement'
      WHEN 'force_offline' THEN 'Tu as été mis hors ligne'
      WHEN 'require_idv' THEN 'Vérification d''identité requise'
      WHEN 'suspend' THEN 'Compte suspendu'
      WHEN 'restore' THEN 'Compte rétabli'
      ELSE 'Information Coligo' END;
    v_body := CASE a.action
      WHEN 'warn' THEN 'Une activité inhabituelle a été détectée sur ton compte. Merci de respecter les règles d''utilisation.'
      WHEN 'limit' THEN 'Certaines fonctionnalités sont limitées. Contacte le support pour en savoir plus.'
      WHEN 'force_offline' THEN COALESCE(NULLIF(a.reason, ''), 'Inactivité détectée — repasse en ligne quand tu es disponible.')
      WHEN 'require_idv' THEN 'Vérifie ton identité pour continuer à utiliser Coligo.'
      WHEN 'suspend' THEN 'Ton compte est suspendu. Contacte le support Coligo.'
      WHEN 'restore' THEN 'Ton compte a été rétabli. Merci de ta patience.'
      ELSE a.reason END;
    notifs := notifs || jsonb_build_array(jsonb_build_object(
      'user_id', a.user_id, 'audience', a.actor_kind,
      'kind', 'fraud_' || a.action, 'title', v_title, 'body', v_body));
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'chauffeurs_offline', n_chf,
                            'drivers_closed', n_drv, 'notifications', notifs);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Population + tâches quotidiennes (cron)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fraud_refresh_population()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE n INT;
BEGIN
  DELETE FROM public.fraud_population_stats;
  INSERT INTO public.fraud_population_stats
    (actor_kind, metric, mean, stddev, p50, p95, n)
  SELECT s.actor_kind, e.key,
         avg(e.value::numeric), COALESCE(stddev_samp(e.value::numeric), 0),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY e.value::numeric),
         percentile_cont(0.95) WITHIN GROUP (ORDER BY e.value::numeric),
         count(*)::int
    FROM public.fraud_scores s,
         jsonb_each_text(s.features) e
   WHERE e.value ~ '^-?[0-9]+(\.[0-9]+)?$'
   GROUP BY s.actor_kind, e.key
  HAVING count(*) >= 5;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.fraud_daily()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  n_pop INT; n_eval INT := 0; n_purged INT;
  t RECORD;
BEGIN
  n_pop := public.fraud_refresh_population();

  -- Ré-évaluation périodique (décroissance + poids appris) de tous les acteurs
  -- connus du moteur OU actifs sur 30 j (plafonné pour rester serverless-safe).
  FOR t IN
    (SELECT DISTINCT actor_kind AS k, actor_id AS i FROM public.fraud_scores)
    UNION
    (SELECT 'customer', o.customer_id FROM public.orders o
      WHERE o.customer_id IS NOT NULL AND o.created_at > now() - interval '30 days')
    UNION
    (SELECT 'merchant', o.merchant_id FROM public.orders o
      WHERE o.created_at > now() - interval '30 days')
    UNION
    (SELECT 'driver', o.delivery_driver_id FROM public.orders o
      WHERE o.delivery_driver_id IS NOT NULL AND o.created_at > now() - interval '30 days')
    UNION
    (SELECT 'chauffeur', r.chauffeur_id FROM public.rides r
      WHERE r.chauffeur_id IS NOT NULL AND r.created_at > now() - interval '30 days')
    UNION
    (SELECT 'customer', r.customer_id FROM public.rides r
      WHERE r.created_at > now() - interval '30 days')
    LIMIT 2000
  LOOP
    PERFORM public.fraud_evaluate_actor(t.k, t.i, 'daily');
    n_eval := n_eval + 1;
  END LOOP;

  -- Rétention
  DELETE FROM public.fraud_events WHERE created_at < now() - interval '180 days';
  GET DIAGNOSTICS n_purged = ROW_COUNT;
  DELETE FROM public.fraud_score_history WHERE created_at < now() - interval '365 days';

  RETURN jsonb_build_object('ok', true, 'population_rows', n_pop,
                            'evaluated', n_eval, 'events_purged', n_purged);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) RPC CLIENT (authenticated, scellées auth.uid())
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.customer_fraud_gate()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE cid UUID;
BEGIN
  SELECT c.id INTO cid FROM public.customers c WHERE c.user_id = auth.uid();
  IF cid IS NULL THEN
    RETURN jsonb_build_object('require_ack', false, 'suspended', false, 'limited', false);
  END IF;
  RETURN jsonb_build_object(
    'require_ack', EXISTS (SELECT 1 FROM public.fraud_actions a
        WHERE a.actor_kind = 'customer' AND a.actor_id = cid
          AND a.action = 'require_ack' AND a.revoked_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > now())),
    'suspended', EXISTS (SELECT 1 FROM public.fraud_actions a
        WHERE a.actor_kind = 'customer' AND a.actor_id = cid
          AND a.action = 'suspend' AND a.revoked_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > now())),
    'limited', EXISTS (SELECT 1 FROM public.fraud_actions a
        WHERE a.actor_kind = 'customer' AND a.actor_id = cid
          AND a.action = 'limit' AND a.revoked_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > now())));
END $$;

CREATE OR REPLACE FUNCTION public.customer_fraud_acknowledge(
  p_ip TEXT DEFAULT NULL, p_device TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  c RECORD;
  act RECORD;
BEGIN
  SELECT cu.id, cu.user_id INTO c FROM public.customers cu WHERE cu.user_id = auth.uid();
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'Accès refusé' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO act FROM public.fraud_actions a
   WHERE a.actor_kind = 'customer' AND a.actor_id = c.id
     AND a.action = 'require_ack' AND a.revoked_at IS NULL
   ORDER BY a.created_at DESC LIMIT 1
   FOR UPDATE;
  IF act.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;
  INSERT INTO public.customer_fraud_acks
    (customer_id, user_id, kind, action_id, ip, device, context)
  VALUES (c.id, c.user_id, 'cancel_scam_warning', act.id,
          left(COALESCE(p_ip, ''), 64), left(COALESCE(p_device, ''), 256),
          jsonb_build_object('suspicious_count', act.meta ->> 'suspicious_count'));
  UPDATE public.fraud_actions
     SET revoked_at = now(), revoked_by_email = 'client',
         revoke_note = 'Avertissement lu et accepté par le client'
   WHERE id = act.id;
  INSERT INTO public.fraud_events (actor_kind, actor_id, user_id, event_type, ip, device)
  VALUES ('customer', c.id, c.user_id, 'ack_given',
          left(COALESCE(p_ip, ''), 64), left(COALESCE(p_device, ''), 256));
  RETURN jsonb_build_object('ok', true);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) RPC ADMIN — Centre Anti-Fraude (garde admin_can('confiance'))
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._fraud_require_admin()
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_email TEXT;
BEGIN
  IF NOT public.admin_can('confiance') THEN
    RAISE EXCEPTION 'Accès refusé' USING ERRCODE = '42501';
  END IF;
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = auth.uid();
  RETURN COALESCE(v_email, 'admin');
END $$;

-- Annule les effets de bord d'une action (limitation / suspension / hors-ligne)
CREATE OR REPLACE FUNCTION public._fraud_undo_side_effect(p_action public.fraud_actions)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF (p_action.meta ->> 'side_effect') = 'cod_blocked' AND p_action.actor_kind = 'customer' THEN
    UPDATE public.customers SET cod_blocked = false WHERE id = p_action.actor_id;
  ELSIF (p_action.meta ->> 'side_effect') = 'frozen' THEN
    IF p_action.actor_kind = 'driver' THEN
      UPDATE public.drivers SET is_frozen = false, freeze_reason = NULL, frozen_at = NULL
       WHERE id = p_action.actor_id;
    ELSIF p_action.actor_kind = 'chauffeur' THEN
      UPDATE public.chauffeurs SET is_frozen = false, frozen_reason = NULL, frozen_at = NULL
       WHERE id = p_action.actor_id;
    ELSIF p_action.actor_kind = 'merchant' THEN
      UPDATE public.merchants SET is_frozen = false WHERE id = p_action.actor_id;
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_fraud_overview()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._fraud_require_admin();
  RETURN jsonb_build_object(
    'kpis', jsonb_build_object(
      'alerts_open', (SELECT count(*) FROM public.fraud_alerts
                       WHERE status IN ('open','investigating')),
      'alerts_critical', (SELECT count(*) FROM public.fraud_alerts
                       WHERE status IN ('open','investigating') AND severity = 'critical'),
      'actions_7d', (SELECT count(*) FROM public.fraud_actions
                       WHERE created_at > now() - interval '7 days'),
      'auto_offline_24h', (SELECT count(*) FROM public.fraud_actions
                       WHERE action = 'force_offline' AND source = 'auto'
                         AND created_at > now() - interval '24 hours'),
      'acks_pending', (SELECT count(*) FROM public.fraud_actions
                       WHERE action = 'require_ack' AND revoked_at IS NULL),
      'high_risk', (SELECT count(*) FROM public.fraud_scores
                       WHERE risk_level IN ('high','critical')),
      'scored_actors', (SELECT count(*) FROM public.fraud_scores)),
    'alerts_by_day', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'd', to_char(t.d, 'YYYY-MM-DD'), 'low', t.l, 'medium', t.m,
        'high', t.h, 'critical', t.c) ORDER BY t.d)
      FROM (SELECT date_trunc('day', created_at) AS d,
                   count(*) FILTER (WHERE severity = 'low') AS l,
                   count(*) FILTER (WHERE severity = 'medium') AS m,
                   count(*) FILTER (WHERE severity = 'high') AS h,
                   count(*) FILTER (WHERE severity = 'critical') AS c
              FROM public.fraud_alerts
             WHERE created_at > now() - interval '14 days'
             GROUP BY 1) t), '[]'::jsonb),
    'actions_by_day', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'd', to_char(t.d, 'YYYY-MM-DD'), 'auto', t.a, 'admin', t.b) ORDER BY t.d)
      FROM (SELECT date_trunc('day', created_at) AS d,
                   count(*) FILTER (WHERE source = 'auto') AS a,
                   count(*) FILTER (WHERE source = 'admin') AS b
              FROM public.fraud_actions
             WHERE created_at > now() - interval '14 days'
             GROUP BY 1) t), '[]'::jsonb),
    'risk_distribution', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'kind', t.actor_kind, 'low', t.l, 'medium', t.m, 'high', t.h, 'critical', t.c))
      FROM (SELECT actor_kind,
                   count(*) FILTER (WHERE risk_level = 'low') AS l,
                   count(*) FILTER (WHERE risk_level = 'medium') AS m,
                   count(*) FILTER (WHERE risk_level = 'high') AS h,
                   count(*) FILTER (WHERE risk_level = 'critical') AS c
              FROM public.fraud_scores GROUP BY 1) t), '[]'::jsonb),
    'top_risk', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'actor_kind', s.actor_kind, 'actor_id', s.actor_id,
        'display_name', s.display_name, 'trust', s.trust_score,
        'fraud', s.fraud_score, 'risk', s.risk_score, 'level', s.risk_level,
        'suspicious', s.suspicious_count) ORDER BY s.risk_score DESC)
      FROM (SELECT * FROM public.fraud_scores
             ORDER BY risk_score DESC LIMIT 10) s), '[]'::jsonb),
    'rules_learning', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'code', r.code, 'label', r.label, 'hits', r.hits,
        'confirmed', r.confirmed_hits, 'dismissed', r.dismissed_hits,
        'weight_mult', round(public.fraud_rule_weight(r.confirmed_hits, r.dismissed_hits), 2))
        ORDER BY r.hits DESC)
      FROM public.fraud_rules r WHERE r.hits > 0), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.admin_fraud_alerts(
  p_status TEXT DEFAULT NULL, p_severity TEXT DEFAULT NULL,
  p_kind TEXT DEFAULT NULL, p_limit INT DEFAULT 100)
RETURNS SETOF public.fraud_alerts LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._fraud_require_admin();
  RETURN QUERY
  SELECT * FROM public.fraud_alerts fa
   WHERE (p_status IS NULL OR (p_status = 'open_all' AND fa.status IN ('open','investigating'))
          OR fa.status = p_status)
     AND (p_severity IS NULL OR fa.severity = p_severity)
     AND (p_kind IS NULL OR fa.actor_kind = p_kind)
   ORDER BY public.fraud_sev_rank(fa.severity) DESC, fa.last_seen_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
END $$;

CREATE OR REPLACE FUNCTION public.admin_fraud_review_alert(
  p_alert_id UUID, p_verdict TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_email TEXT;
  al public.fraud_alerts%ROWTYPE;
BEGIN
  v_email := public._fraud_require_admin();
  IF p_verdict NOT IN ('confirmed','dismissed','investigating') THEN
    RAISE EXCEPTION 'Verdict invalide';
  END IF;
  SELECT * INTO al FROM public.fraud_alerts WHERE id = p_alert_id FOR UPDATE;
  IF al.id IS NULL THEN RAISE EXCEPTION 'Alerte introuvable'; END IF;
  IF al.status IN ('confirmed','dismissed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Alerte déjà examinée');
  END IF;

  UPDATE public.fraud_alerts
     SET status = p_verdict, reviewed_by_email = v_email,
         reviewed_at = CASE WHEN p_verdict IN ('confirmed','dismissed') THEN now() END,
         review_note = COALESCE(p_note, review_note)
   WHERE id = p_alert_id;

  -- APPRENTISSAGE : le verdict ajuste le poids futur de la règle
  IF p_verdict = 'confirmed' THEN
    UPDATE public.fraud_rules SET confirmed_hits = confirmed_hits + 1 WHERE code = al.rule_code;
  ELSIF p_verdict = 'dismissed' THEN
    UPDATE public.fraud_rules SET dismissed_hits = dismissed_hits + 1 WHERE code = al.rule_code;
  END IF;

  INSERT INTO public.admin_audit_log (admin_email, action, target_kind, target_id, note)
  VALUES (v_email, 'fraud_alert_' || p_verdict, 'fraud_alert', al.id,
          left(al.rule_code || ' — ' || al.display_name || COALESCE(' — ' || p_note, ''), 500));

  -- Re-scorer l'acteur avec les nouveaux poids
  IF p_verdict IN ('confirmed','dismissed') THEN
    PERFORM public.fraud_evaluate_actor(al.actor_kind, al.actor_id, 'review_' || p_verdict);
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.admin_fraud_ranking(
  p_kind TEXT DEFAULT NULL, p_q TEXT DEFAULT NULL, p_limit INT DEFAULT 100)
RETURNS SETOF public.fraud_scores LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._fraud_require_admin();
  RETURN QUERY
  SELECT * FROM public.fraud_scores s
   WHERE (p_kind IS NULL OR s.actor_kind = p_kind)
     AND (p_q IS NULL OR s.display_name ILIKE '%' || p_q || '%')
   ORDER BY s.risk_score DESC, s.updated_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
END $$;

CREATE OR REPLACE FUNCTION public.admin_fraud_actor(p_kind TEXT, p_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_user UUID;
BEGIN
  PERFORM public._fraud_require_admin();
  SELECT s.user_id INTO v_user FROM public.fraud_scores s
   WHERE s.actor_kind = p_kind AND s.actor_id = p_id;
  RETURN jsonb_build_object(
    'score', (SELECT to_jsonb(s) FROM public.fraud_scores s
               WHERE s.actor_kind = p_kind AND s.actor_id = p_id),
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'at', h.created_at, 'trust', h.trust_score, 'fraud', h.fraud_score,
        'risk', h.risk_score, 'reason', h.reason) ORDER BY h.created_at)
      FROM (SELECT * FROM public.fraud_score_history
             WHERE actor_kind = p_kind AND actor_id = p_id
               AND created_at > now() - interval '90 days'
             ORDER BY created_at DESC LIMIT 200) h), '[]'::jsonb),
    'alerts', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC)
      FROM (SELECT * FROM public.fraud_alerts
             WHERE actor_kind = p_kind AND actor_id = p_id
             ORDER BY created_at DESC LIMIT 50) a), '[]'::jsonb),
    'actions', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC)
      FROM (SELECT * FROM public.fraud_actions
             WHERE actor_kind = p_kind AND actor_id = p_id
             ORDER BY created_at DESC LIMIT 50) a), '[]'::jsonb),
    'events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC)
      FROM (SELECT id, event_type, order_id, ride_id, counterparty_kind,
                   counterparty_id, lat, lng, meta, created_at
              FROM public.fraud_events
             WHERE actor_kind = p_kind AND actor_id = p_id
             ORDER BY created_at DESC LIMIT 100) e), '[]'::jsonb),
    'devices', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'ip', d.ip, 'platform', d.platform, 'city', d.city, 'country', d.country,
        'is_standalone', d.is_standalone, 'last_seen_at', d.last_seen_at, 'hits', d.hits)
        ORDER BY d.last_seen_at DESC)
      FROM (SELECT * FROM public.user_device_log
             WHERE user_id = v_user ORDER BY last_seen_at DESC LIMIT 20) d), '[]'::jsonb),
    'linked_accounts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'user_id', l.user_id, 'email', l.email, 'role', l.role, 'ip', l.ip,
        'last_seen_at', l.last_seen_at))
      FROM (SELECT DISTINCT u2.user_id, au.email, u2.role, u2.ip, max(u2.last_seen_at) AS last_seen_at
              FROM public.user_device_log u1
              JOIN public.user_device_log u2
                ON u2.ip = u1.ip AND u2.user_id <> u1.user_id
               AND u2.last_seen_at > now() - interval '30 days'
              LEFT JOIN auth.users au ON au.id = u2.user_id
             WHERE u1.user_id = v_user AND u1.last_seen_at > now() - interval '30 days'
             GROUP BY u2.user_id, au.email, u2.role, u2.ip
             LIMIT 20) l), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.admin_fraud_apply_action(
  p_kind TEXT, p_id UUID, p_action TEXT, p_reason TEXT, p_hours INT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_email TEXT;
  v_user UUID; v_name TEXT;
  side JSONB := '{}'::jsonb;
  act RECORD;
BEGIN
  v_email := public._fraud_require_admin();
  IF p_action NOT IN ('warn','require_ack','limit','force_offline','require_idv','suspend','restore','note') THEN
    RAISE EXCEPTION 'Action invalide';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Motif obligatoire';
  END IF;

  IF p_kind = 'customer' THEN
    SELECT c.user_id, c.full_name INTO v_user, v_name FROM public.customers c WHERE c.id = p_id;
  ELSIF p_kind = 'driver' THEN
    SELECT d.user_id, d.full_name INTO v_user, v_name FROM public.drivers d WHERE d.id = p_id;
  ELSIF p_kind = 'chauffeur' THEN
    SELECT c.user_id, c.full_name INTO v_user, v_name FROM public.chauffeurs c WHERE c.id = p_id;
  ELSIF p_kind = 'merchant' THEN
    SELECT m.user_id, m.name INTO v_user, v_name FROM public.merchants m WHERE m.id = p_id;
  ELSE
    RAISE EXCEPTION 'Population invalide';
  END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Compte introuvable'; END IF;

  IF p_action = 'restore' THEN
    -- Révoque TOUTES les mesures actives + annule leurs effets de bord
    FOR act IN
      SELECT * FROM public.fraud_actions a
       WHERE a.actor_kind = p_kind AND a.actor_id = p_id
         AND a.revoked_at IS NULL AND a.action <> 'note'
       FOR UPDATE
    LOOP
      UPDATE public.fraud_actions
         SET revoked_at = now(), revoked_by_email = v_email,
             revoke_note = 'Rétablissement : ' || p_reason
       WHERE id = act.id;
      PERFORM public._fraud_undo_side_effect(act);
    END LOOP;
  ELSIF p_action = 'force_offline' THEN
    IF p_kind = 'chauffeur' THEN
      UPDATE public.chauffeur_presence SET is_online = false WHERE chauffeur_id = p_id;
    END IF;
    UPDATE public.fraud_partner_presence
       SET is_online = false, forced_offline_at = now()
     WHERE actor_kind = p_kind AND actor_id = p_id;
  ELSIF p_action = 'limit' AND p_kind = 'customer' THEN
    UPDATE public.customers SET cod_blocked = true
     WHERE id = p_id AND NOT COALESCE(cod_blocked, false);
    IF FOUND THEN side := jsonb_build_object('side_effect', 'cod_blocked'); END IF;
  ELSIF p_action = 'suspend' THEN
    IF p_kind = 'driver' THEN
      UPDATE public.drivers SET is_frozen = true, frozen_at = now(),
             freeze_reason = 'Anti-fraude : ' || p_reason
       WHERE id = p_id AND NOT is_frozen;
      IF FOUND THEN side := jsonb_build_object('side_effect', 'frozen'); END IF;
    ELSIF p_kind = 'chauffeur' THEN
      UPDATE public.chauffeurs SET is_frozen = true, frozen_at = now(),
             frozen_reason = 'Anti-fraude : ' || p_reason
       WHERE id = p_id AND NOT is_frozen;
      IF FOUND THEN side := jsonb_build_object('side_effect', 'frozen'); END IF;
    ELSIF p_kind = 'merchant' THEN
      UPDATE public.merchants SET is_frozen = true WHERE id = p_id AND NOT is_frozen;
      IF FOUND THEN side := jsonb_build_object('side_effect', 'frozen'); END IF;
    END IF;
  END IF;

  INSERT INTO public.fraud_actions
    (actor_kind, actor_id, user_id, action, source, admin_email, reason, meta, expires_at)
  VALUES (p_kind, p_id, v_user, p_action, 'admin', v_email, p_reason,
          side, CASE WHEN p_hours IS NOT NULL THEN now() + make_interval(hours => p_hours) END);
  INSERT INTO public.fraud_events (actor_kind, actor_id, user_id, event_type, meta)
  VALUES (p_kind, p_id, v_user, 'action_applied',
          jsonb_build_object('action', p_action, 'source', 'admin', 'by', v_email));
  INSERT INTO public.admin_audit_log (admin_email, action, target_kind, target_id, note)
  VALUES (v_email, 'fraud_action_' || p_action, 'fraud_' || p_kind, p_id,
          left(v_name || ' — ' || p_reason, 500));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.admin_fraud_revoke_action(
  p_action_id UUID, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_email TEXT;
  act public.fraud_actions%ROWTYPE;
BEGIN
  v_email := public._fraud_require_admin();
  SELECT * INTO act FROM public.fraud_actions WHERE id = p_action_id FOR UPDATE;
  IF act.id IS NULL THEN RAISE EXCEPTION 'Action introuvable'; END IF;
  IF act.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;
  UPDATE public.fraud_actions
     SET revoked_at = now(), revoked_by_email = v_email,
         revoke_note = COALESCE(p_note, 'Révoquée par l''équipe Coligo')
   WHERE id = p_action_id;
  PERFORM public._fraud_undo_side_effect(act);
  INSERT INTO public.fraud_events (actor_kind, actor_id, user_id, event_type, meta)
  VALUES (act.actor_kind, act.actor_id, act.user_id, 'action_revoked',
          jsonb_build_object('action', act.action, 'by', v_email));
  INSERT INTO public.admin_audit_log (admin_email, action, target_kind, target_id, note)
  VALUES (v_email, 'fraud_action_revoke', 'fraud_action', act.id,
          left(act.action || COALESCE(' — ' || p_note, ''), 500));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.admin_fraud_rules()
RETURNS SETOF public.fraud_rules LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._fraud_require_admin();
  RETURN QUERY SELECT * FROM public.fraud_rules
   ORDER BY actor_kind, category, code;
END $$;

CREATE OR REPLACE FUNCTION public.admin_fraud_update_rule(
  p_code TEXT, p_enabled BOOLEAN DEFAULT NULL,
  p_base_weight NUMERIC DEFAULT NULL, p_params JSONB DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_email TEXT;
BEGIN
  v_email := public._fraud_require_admin();
  UPDATE public.fraud_rules
     SET enabled = COALESCE(p_enabled, enabled),
         base_weight = COALESCE(p_base_weight, base_weight),
         params = COALESCE(p_params, params)
   WHERE code = p_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'Règle inconnue'; END IF;
  INSERT INTO public.admin_audit_log (admin_email, action, target_kind, target_id, note)
  VALUES (v_email, 'fraud_rule_update', 'fraud_rule', NULL,
          left(p_code || ' enabled=' || COALESCE(p_enabled::text, '-')
               || ' w=' || COALESCE(p_base_weight::text, '-')
               || ' params=' || COALESCE(p_params::text, '-'), 500));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.admin_fraud_settings()
RETURNS SETOF public.fraud_settings LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._fraud_require_admin();
  RETURN QUERY SELECT * FROM public.fraud_settings
   WHERE key <> 'last_sweep_at' ORDER BY key;
END $$;

CREATE OR REPLACE FUNCTION public.admin_fraud_update_setting(p_key TEXT, p_value JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_email TEXT;
BEGIN
  v_email := public._fraud_require_admin();
  UPDATE public.fraud_settings SET value = p_value WHERE key = p_key AND key <> 'last_sweep_at';
  IF NOT FOUND THEN RAISE EXCEPTION 'Réglage inconnu'; END IF;
  INSERT INTO public.admin_audit_log (admin_email, action, target_kind, target_id, note)
  VALUES (v_email, 'fraud_setting_update', 'fraud_setting', NULL,
          left(p_key || ' = ' || p_value::text, 500));
  RETURN jsonb_build_object('ok', true);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10) Alertes globales super-admin (domaine Confiance) : + alertes anti-fraude
--     hautes/critiques. (Reprend le corps existant + 1 bloc UNION.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._admin_alert_rules_confiance()
RETURNS TABLE(code text, domain text, severity text, prio integer, count integer,
              since timestamp with time zone, label text, href text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- Anomalie d'intégrité → écran dédié /admin/integrity (détail actionnable).
  SELECT 'integrity_violation', 'confiance', 'critical', 3,
         COUNT(*)::int, MIN(al.created_at),
         'Anomalie d''intégrité détectée — vérifier', '/admin/integrity'
    FROM public.admin_audit_log al
   WHERE al.action = 'integrity_violation'
     AND al.created_at > now() - interval '2 days'
  HAVING COUNT(*) > 0

  UNION ALL
  -- Alertes ANTI-FRAUDE hautes/critiques à examiner → Centre Anti-Fraude.
  SELECT 'fraud_alerts_open', 'confiance',
         CASE WHEN COUNT(*) FILTER (WHERE fa.severity = 'critical') > 0
              THEN 'critical' ELSE 'warning' END,
         CASE WHEN COUNT(*) FILTER (WHERE fa.severity = 'critical') > 0 THEN 3 ELSE 2 END,
         COUNT(*)::int, MIN(fa.first_seen_at),
         'Alertes anti-fraude à examiner', '/admin/anti-fraude/alertes'
    FROM public.fraud_alerts fa
   WHERE fa.status IN ('open','investigating') AND fa.severity IN ('high','critical')
  HAVING COUNT(*) > 0;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11) GRANTS — Supabase grante EXECUTE à authenticated/anon par défaut :
--     on révoque TOUT puis on ré-ouvre au cas par cas.
-- ─────────────────────────────────────────────────────────────────────────────
-- Fonctions moteur : service_role uniquement
REVOKE ALL ON FUNCTION public.fraud_setting_num(TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fraud_setting_bool(TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fraud_rule_weight(INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fraud_compute_features(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fraud_evaluate_actor(TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fraud_ingest_cancel(TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fraud_note_offer_decision(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fraud_tick() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fraud_refresh_population() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fraud_daily() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._fraud_require_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._fraud_undo_side_effect(public.fraud_actions) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._admin_alert_rules_confiance() FROM PUBLIC, anon, authenticated;

-- Livreur authentifié (scellée auth.uid())
REVOKE ALL ON FUNCTION public.fraud_touch_driver_presence(float8, float8, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fraud_touch_driver_presence(float8, float8, UUID) TO authenticated;

-- Client authentifié (scellées auth.uid())
REVOKE ALL ON FUNCTION public.customer_fraud_gate() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_fraud_gate() TO authenticated;
REVOKE ALL ON FUNCTION public.customer_fraud_acknowledge(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_fraud_acknowledge(TEXT, TEXT) TO authenticated;

-- Admin (garde interne admin_can('confiance') — GRANT authenticated OBLIGATOIRE)
REVOKE ALL ON FUNCTION public.admin_fraud_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_fraud_overview() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_fraud_alerts(TEXT, TEXT, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_fraud_alerts(TEXT, TEXT, TEXT, INT) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_fraud_review_alert(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_fraud_review_alert(UUID, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_fraud_ranking(TEXT, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_fraud_ranking(TEXT, TEXT, INT) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_fraud_actor(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_fraud_actor(TEXT, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_fraud_apply_action(TEXT, UUID, TEXT, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_fraud_apply_action(TEXT, UUID, TEXT, TEXT, INT) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_fraud_revoke_action(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_fraud_revoke_action(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_fraud_rules() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_fraud_rules() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_fraud_update_rule(TEXT, BOOLEAN, NUMERIC, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_fraud_update_rule(TEXT, BOOLEAN, NUMERIC, JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_fraud_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_fraud_settings() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_fraud_update_setting(TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_fraud_update_setting(TEXT, JSONB) TO authenticated;
