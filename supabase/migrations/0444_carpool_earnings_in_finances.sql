-- =============================================================================
-- 0444 — GAINS COVOITURAGE dans les finances chauffeur (suite de 0443).
-- =============================================================================
-- Le covoiturage vivait dans son propre grand livre (carpool_ledger) mais
-- n'apparaissait ni dans « Gains et Relevés » ni dans le gain du jour de
-- l'accueil. Ici :
--   1. `carpool_ledger.settled_at` (règlement des dettes espèces, parité
--      ride_ledger) ;
--   2. `drive_my_finances` v2 : les agrégats EXISTANTS (today_net, month_*,
--      due_unsettled) INTÈGRENT le covoiturage + 3 colonnes de ventilation
--      (carpool_today_net_da, carpool_month_net_da, carpool_month_trips) pour
--      la ligne « dont covoiturage » de l'écran Gains. La sortie change →
--      DROP + recréation + re-GRANT.
-- L'app lit aussi les détails par période via getChauffeurReleve (TS, admin) —
-- étendu côté code dans le même commit.
-- =============================================================================

ALTER TABLE public.carpool_ledger
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

DROP FUNCTION IF EXISTS public.drive_my_finances();
CREATE OR REPLACE FUNCTION public.drive_my_finances()
RETURNS TABLE(
  today_net_da BIGINT, today_rides BIGINT, today_online_minutes INTEGER,
  month_gross_da BIGINT, month_rides BIGINT, month_commission_da BIGINT,
  month_net_da BIGINT, month_sub_fee_da INTEGER,
  due_unsettled_da BIGINT,
  plan TEXT, plan_rate NUMERIC, plan_period_end TIMESTAMPTZ,
  rating NUMERIC, rides_total BIGINT,
  carpool_today_net_da BIGINT, carpool_month_net_da BIGINT,
  carpool_month_trips BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ch UUID; v_tz_today DATE; v_month_start TIMESTAMPTZ; rp RECORD;
  v_cp_month_gross BIGINT := 0;
BEGIN
  SELECT id INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_ch IS NULL THEN RETURN; END IF;
  v_tz_today := (now() AT TIME ZONE 'Africa/Algiers')::DATE;
  v_month_start := date_trunc('month', now() AT TIME ZONE 'Africa/Algiers') AT TIME ZONE 'Africa/Algiers';
  SELECT * INTO rp FROM public.resolve_drive_plan(v_ch);

  SELECT
    COALESCE(sum(r.chauffeur_net_da + r.tip_da) FILTER (WHERE (r.completed_at AT TIME ZONE 'Africa/Algiers')::DATE = v_tz_today), 0),
    COALESCE(count(*) FILTER (WHERE (r.completed_at AT TIME ZONE 'Africa/Algiers')::DATE = v_tz_today), 0),
    COALESCE(sum(r.agreed_price_da) FILTER (WHERE r.completed_at >= v_month_start), 0),
    COALESCE(count(*) FILTER (WHERE r.completed_at >= v_month_start), 0),
    COALESCE(sum(r.commission_da) FILTER (WHERE r.completed_at >= v_month_start), 0),
    COALESCE(sum(r.chauffeur_net_da + r.tip_da) FILTER (WHERE r.completed_at >= v_month_start), 0)
  INTO today_net_da, today_rides, month_gross_da, month_rides, month_commission_da, month_net_da
  FROM public.rides r
  WHERE r.chauffeur_id = v_ch AND r.status = 'completed';

  -- COVOITURAGE (0443) : net = payouts du grand livre (par réservation
  -- embarquée puis clôturée), brut = montants des réservations, ventilé jour /
  -- mois sur la date de clôture du départ.
  SELECT
    COALESCE(sum(lp.amount_da) FILTER (WHERE (t.completed_at AT TIME ZONE 'Africa/Algiers')::DATE = v_tz_today), 0),
    COALESCE(sum(lp.amount_da) FILTER (WHERE t.completed_at >= v_month_start), 0),
    COALESCE(sum(b.amount_da)  FILTER (WHERE t.completed_at >= v_month_start), 0),
    COALESCE(count(DISTINCT t.id) FILTER (WHERE t.completed_at >= v_month_start), 0)
  INTO carpool_today_net_da, carpool_month_net_da, v_cp_month_gross, carpool_month_trips
  FROM public.carpool_bookings b
  JOIN public.carpool_trips t ON t.id = b.trip_id
  LEFT JOIN public.carpool_ledger lp
         ON lp.booking_id = b.id AND lp.type = 'chauffeur_payout'
  WHERE t.chauffeur_id = v_ch AND t.status = 'completed' AND b.status = 'completed';

  -- Totaux AFFICHÉS = courses + covoiturage (le chiffre en tête d'écran doit
  -- dire la vérité) ; la ventilation reste disponible dans les colonnes carpool_*.
  today_net_da         := today_net_da + carpool_today_net_da;
  month_net_da         := month_net_da + carpool_month_net_da;
  month_gross_da       := month_gross_da + v_cp_month_gross;
  month_commission_da  := month_commission_da + (v_cp_month_gross - carpool_month_net_da);

  SELECT COALESCE(p.online_minutes, 0) INTO today_online_minutes
  FROM public.chauffeur_presence p
  WHERE p.chauffeur_id = v_ch AND p.online_minutes_date = v_tz_today;
  today_online_minutes := COALESCE(today_online_minutes, 0);

  SELECT COALESCE(sum(l.amount_da), 0)
       + COALESCE((SELECT sum(cl.amount_da) FROM public.carpool_ledger cl
                    WHERE cl.chauffeur_id = v_ch
                      AND cl.type = 'chauffeur_owes_platform'
                      AND cl.settled_at IS NULL), 0)
    INTO due_unsettled_da
  FROM public.ride_ledger l
  WHERE l.chauffeur_id = v_ch AND l.type = 'chauffeur_owes_platform' AND l.settled_at IS NULL;

  SELECT round(avg(r2.chauffeur_rating)::NUMERIC, 1),
         count(*) FILTER (WHERE r2.status = 'completed')
    INTO rating, rides_total
  FROM public.rides r2 WHERE r2.chauffeur_id = v_ch;

  plan := rp.plan; plan_rate := rp.rate; plan_period_end := rp.period_end;
  month_sub_fee_da := CASE WHEN rp.plan = 'free' THEN 0 ELSE rp.fee_da END;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.drive_my_finances() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.drive_my_finances() TO authenticated, service_role;
