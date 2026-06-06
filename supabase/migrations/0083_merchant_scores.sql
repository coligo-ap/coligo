-- =============================================================================
-- 0083 — Classement intelligent : scores commerçant PRÉ-CALCULÉS (volet 3)
-- =============================================================================
-- Données MESURÉES (vraies commandes), pas déclaratives → anti-triche. On stocke
-- sur chaque commerçant des métriques de qualité/fiabilité/rapidité, rafraîchies
-- en arrière-plan (trigger sur changement de statut terminal) + backfill. À la
-- requête, le tri s'appuie sur ces scores pré-calculés (réponse instantanée).
--
-- Définitions (équitables) :
--   - accepted        = commandes acceptées (statut accepted/preparing/ready/completed)
--   - refused         = commandes annulées NON par le client (NULL/merchant/system)
--                       → une annulation CLIENT ne pénalise jamais le commerçant
--   - accept_rate     = accepted / (accepted + refused)
--   - completion_rate = completed / (completed + refused)
--   - cancel_rate     = refused / received
--   - avg_prep_min    = moyenne MESURÉE (marked_ready_at − prep_started_at), outliers exclus
--   - score_quality   = mélange (note ★ + accept + completion + faible annulation),
--                       rétréci vers 0.5 tant qu'il y a peu de commandes (Bayésien)
--   - score_speed     = dérivé du temps de prépa mesuré (5 min → 1.0, 40 min → 0.0)
-- Pondérations dans la fonction (ajustables sans toucher au schéma).
-- =============================================================================

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS orders_count    INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accept_rate     NUMERIC(4, 3),
  ADD COLUMN IF NOT EXISTS completion_rate NUMERIC(4, 3),
  ADD COLUMN IF NOT EXISTS cancel_rate     NUMERIC(4, 3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_prep_min    NUMERIC(5, 1),
  ADD COLUMN IF NOT EXISTS score_quality   NUMERIC(4, 3) NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS score_speed     NUMERIC(4, 3) NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS scores_updated_at TIMESTAMPTZ;

-- Recalcule les scores d'UN commerçant (ou de TOUS si p_merchant IS NULL).
CREATE OR REPLACE FUNCTION public.refresh_merchant_scores(p_merchant uuid DEFAULT NULL)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  WITH agg AS (
    SELECT
      o.merchant_id,
      count(*) AS received,
      count(*) FILTER (
        WHERE o.status IN ('accepted', 'preparing', 'ready', 'completed')
      ) AS accepted,
      count(*) FILTER (WHERE o.status = 'completed') AS completed,
      count(*) FILTER (
        WHERE o.status = 'cancelled' AND o.cancelled_by IS DISTINCT FROM 'customer'
      ) AS refused,
      avg(extract(epoch FROM (o.marked_ready_at - o.prep_started_at)) / 60.0)
        FILTER (
          WHERE o.marked_ready_at IS NOT NULL
            AND o.prep_started_at IS NOT NULL
            AND o.marked_ready_at > o.prep_started_at
            AND extract(epoch FROM (o.marked_ready_at - o.prep_started_at)) / 60.0 < 180
        ) AS avg_prep
    FROM public.orders o
    WHERE p_merchant IS NULL OR o.merchant_id = p_merchant
    GROUP BY o.merchant_id
  )
  UPDATE public.merchants m SET
    orders_count = a.received,
    accept_rate = CASE WHEN (a.accepted + a.refused) > 0
      THEN round(a.accepted::numeric / (a.accepted + a.refused), 3) END,
    completion_rate = CASE WHEN (a.completed + a.refused) > 0
      THEN round(a.completed::numeric / (a.completed + a.refused), 3) END,
    cancel_rate = CASE WHEN a.received > 0
      THEN round(a.refused::numeric / a.received, 3) ELSE 0 END,
    avg_prep_min = CASE WHEN a.avg_prep IS NOT NULL
      THEN round(a.avg_prep::numeric, 1) END,
    score_quality = round((
      (
        0.45 * (least(m.rating_avg, 5) / 5.0)
        + 0.30 * coalesce(
            CASE WHEN (a.accepted + a.refused) > 0
              THEN a.accepted::numeric / (a.accepted + a.refused) END, 0.5)
        + 0.20 * coalesce(
            CASE WHEN (a.completed + a.refused) > 0
              THEN a.completed::numeric / (a.completed + a.refused) END, 0.5)
        + 0.05 * (1 - coalesce(
            CASE WHEN a.received > 0
              THEN a.refused::numeric / a.received END, 0))
      ) * least(a.received / 20.0, 1.0)
      + 0.5 * (1 - least(a.received / 20.0, 1.0))
    )::numeric, 3),
    score_speed = round(
      greatest(0, least(1,
        1 - ((coalesce(a.avg_prep, m.prep_time_min, 20) - 5.0) / 35.0)
      ))::numeric, 3),
    scores_updated_at = now()
  FROM agg a
  WHERE m.id = a.merchant_id;
END;
$$;

-- Rafraîchissement incrémental : à chaque passage en statut terminal, on
-- recalcule (léger : agrégats sur les commandes d'UN commerçant).
CREATE OR REPLACE FUNCTION public.trg_refresh_merchant_scores()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_merchant_scores(NEW.merchant_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_refresh_scores ON public.orders;
CREATE TRIGGER orders_refresh_scores
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status
        AND NEW.status IN ('completed', 'cancelled'))
  EXECUTE FUNCTION public.trg_refresh_merchant_scores();

-- Backfill initial (tous les commerçants).
SELECT public.refresh_merchant_scores(NULL);

-- Ré-expose la vue publique avec les scores (appendus après `tags`).
CREATE OR REPLACE VIEW public.merchants_public AS
  SELECT id, slug, name, category, description_fr, description_ar, logo_url,
    cover_url, phone_public, city, commune, wilaya_code, address, latitude,
    longitude, opening_hours, min_order_da, prep_time_min, accepts_cash,
    accepts_online, pickup_slot_minutes, max_orders_per_slot, is_active,
    created_at, max_days_ahead, rating_avg, rating_count, delivery_enabled,
    express_enabled, tours_enabled, delivery_radius_km, shop_public_id,
    orders_paused, paused_until, closure_start, closure_end, tags,
    score_quality, score_speed, avg_prep_min, orders_count
   FROM public.merchants
  WHERE is_active = true;
