-- ============================================================
-- 0144 — Drive : écarts checklist (G2, B9)
-- • G2 : « heures en ligne » — compteur quotidien de minutes en ligne
--   alimenté par le heartbeat (delta plafonné à 3 min, fuseau Algiers).
-- • B9 : « pour un proche » — my_active_ride expose proxy_phone pour
--   l'envoi du lien de suivi SMS/WhatsApp au proche (sans compte).
-- ============================================================

ALTER TABLE public.chauffeur_presence
  ADD COLUMN IF NOT EXISTS online_minutes_date DATE,
  ADD COLUMN IF NOT EXISTS online_minutes INTEGER NOT NULL DEFAULT 0;

-- Heartbeat v2 : accumule le temps en ligne (delta ≤ 3 min entre 2 battements).
CREATE OR REPLACE FUNCTION public.chauffeur_heartbeat(
  p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION, p_online BOOLEAN DEFAULT true
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ch UUID; v_prev public.chauffeur_presence%ROWTYPE;
  v_today DATE; v_delta INTEGER := 0;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN
    RETURN;
  END IF;
  SELECT id INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_ch IS NULL THEN RETURN; END IF;

  v_today := (now() AT TIME ZONE 'Africa/Algiers')::DATE;
  SELECT * INTO v_prev FROM public.chauffeur_presence WHERE chauffeur_id = v_ch;
  IF v_prev.chauffeur_id IS NOT NULL AND v_prev.is_online AND p_online THEN
    -- Temps écoulé depuis le dernier battement, plafonné (poll ~15-20 s).
    v_delta := LEAST(3, GREATEST(0,
      floor(EXTRACT(EPOCH FROM (now() - v_prev.updated_at)) / 60)))::INTEGER;
  END IF;

  INSERT INTO public.chauffeur_presence
    (chauffeur_id, lat, lng, is_online, updated_at, online_minutes_date, online_minutes)
  VALUES (v_ch, p_lat, p_lng, COALESCE(p_online, true), now(), v_today, 0)
  ON CONFLICT (chauffeur_id) DO UPDATE SET
    lat = EXCLUDED.lat,
    lng = EXCLUDED.lng,
    is_online = EXCLUDED.is_online,
    updated_at = now(),
    online_minutes = CASE
      WHEN public.chauffeur_presence.online_minutes_date IS DISTINCT FROM v_today THEN v_delta
      ELSE public.chauffeur_presence.online_minutes + v_delta END,
    online_minutes_date = v_today;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chauffeur_heartbeat(DOUBLE PRECISION, DOUBLE PRECISION, BOOLEAN) TO authenticated;

-- drive_my_finances v2 : + minutes en ligne aujourd'hui (écran accueil/gains).
DROP FUNCTION IF EXISTS public.drive_my_finances();
CREATE OR REPLACE FUNCTION public.drive_my_finances()
RETURNS TABLE(
  today_net_da BIGINT, today_rides BIGINT, today_online_minutes INTEGER,
  month_gross_da BIGINT, month_rides BIGINT, month_commission_da BIGINT,
  month_net_da BIGINT, month_sub_fee_da INTEGER,
  due_unsettled_da BIGINT,
  plan TEXT, plan_rate NUMERIC, plan_period_end TIMESTAMPTZ,
  rating NUMERIC, rides_total BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ch UUID; v_tz_today DATE; v_month_start TIMESTAMPTZ; rp RECORD;
BEGIN
  SELECT id INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_ch IS NULL THEN RETURN; END IF;
  v_tz_today := (now() AT TIME ZONE 'Africa/Algiers')::DATE;
  v_month_start := date_trunc('month', now() AT TIME ZONE 'Africa/Algiers') AT TIME ZONE 'Africa/Algiers';
  SELECT * INTO rp FROM public.resolve_drive_plan(v_ch);

  SELECT
    COALESCE(sum(r.chauffeur_net_da) FILTER (WHERE (r.completed_at AT TIME ZONE 'Africa/Algiers')::DATE = v_tz_today), 0),
    COALESCE(count(*) FILTER (WHERE (r.completed_at AT TIME ZONE 'Africa/Algiers')::DATE = v_tz_today), 0),
    COALESCE(sum(r.agreed_price_da) FILTER (WHERE r.completed_at >= v_month_start), 0),
    COALESCE(count(*) FILTER (WHERE r.completed_at >= v_month_start), 0),
    COALESCE(sum(r.commission_da) FILTER (WHERE r.completed_at >= v_month_start), 0),
    COALESCE(sum(r.chauffeur_net_da) FILTER (WHERE r.completed_at >= v_month_start), 0)
  INTO today_net_da, today_rides, month_gross_da, month_rides, month_commission_da, month_net_da
  FROM public.rides r
  WHERE r.chauffeur_id = v_ch AND r.status = 'completed';

  SELECT COALESCE(p.online_minutes, 0) INTO today_online_minutes
  FROM public.chauffeur_presence p
  WHERE p.chauffeur_id = v_ch AND p.online_minutes_date = v_tz_today;
  today_online_minutes := COALESCE(today_online_minutes, 0);

  SELECT COALESCE(sum(l.amount_da), 0) INTO due_unsettled_da
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
GRANT EXECUTE ON FUNCTION public.drive_my_finances() TO authenticated;

-- my_active_ride v3 : + proxy_phone (envoi du suivi au proche).
DROP FUNCTION IF EXISTS public.my_active_ride();
CREATE OR REPLACE FUNCTION public.my_active_ride()
RETURNS TABLE(
  id UUID, status TEXT, pickup_text TEXT, dest_text TEXT,
  pickup_lat DOUBLE PRECISION, pickup_lng DOUBLE PRECISION,
  dest_lat DOUBLE PRECISION, dest_lng DOUBLE PRECISION,
  distance_km NUMERIC, proposed_price_da INTEGER, agreed_price_da INTEGER,
  boost_amount_da INTEGER, gamme TEXT, payment_method TEXT,
  female_only BOOLEAN, proxy_name TEXT, proxy_phone TEXT,
  share_token TEXT, end_code TEXT, online_paid_at TIMESTAMPTZ,
  chauffeur_id UUID, ch_name TEXT, ch_vehicle TEXT, ch_plate TEXT, ch_phone TEXT,
  ch_rating NUMERIC, ch_rides BIGINT, ch_is_female BOOLEAN, ch_is_premium BOOLEAN,
  ch_is_favorite BOOLEAN, ch_lat DOUBLE PRECISION, ch_lng DOUBLE PRECISION,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_customer UUID;
BEGIN
  SELECT cu.id INTO v_customer FROM public.customers cu WHERE cu.user_id = auth.uid();
  IF v_customer IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT r.id, r.status::TEXT, r.pickup_text, r.dest_text,
         r.pickup_lat, r.pickup_lng, r.dest_lat, r.dest_lng,
         r.distance_km, r.proposed_price_da, r.agreed_price_da,
         r.boost_amount_da, r.gamme, r.payment_method,
         r.female_only, r.proxy_name, r.proxy_phone,
         r.share_token, r.end_code, r.online_paid_at,
         c.id,
         COALESCE(NULLIF(c.first_name,''), split_part(c.full_name,' ',1)),
         NULLIF(btrim(COALESCE(c.vehicle_make,'') || ' ' || COALESCE(c.vehicle_model,'')
           || CASE WHEN COALESCE(c.vehicle_color,'') <> '' THEN ' · ' || c.vehicle_color ELSE '' END), ''),
         c.vehicle_plate, c.phone,
         (SELECT round(avg(r2.chauffeur_rating)::NUMERIC, 1) FROM public.rides r2
           WHERE r2.chauffeur_id = c.id AND r2.chauffeur_rating IS NOT NULL),
         (SELECT count(*) FROM public.rides r3 WHERE r3.chauffeur_id = c.id AND r3.status = 'completed'),
         c.is_female_verified,
         (c.id IS NOT NULL AND (SELECT rp.plan FROM public.resolve_drive_plan(c.id) rp) = 'premium'),
         (c.id IS NOT NULL AND EXISTS (SELECT 1 FROM public.customer_favorite_chauffeurs f
            WHERE f.customer_id = v_customer AND f.chauffeur_id = c.id)),
         p.lat, p.lng,
         r.created_at
  FROM public.rides r
  LEFT JOIN public.chauffeurs c ON c.id = r.chauffeur_id
  LEFT JOIN public.chauffeur_presence p ON p.chauffeur_id = c.id
  WHERE r.customer_id = v_customer
    AND r.status IN ('searching','accepted','arriving','arrived','in_progress')
  ORDER BY r.created_at DESC
  LIMIT 1;
END;
$$;
GRANT EXECUTE ON FUNCTION public.my_active_ride() TO authenticated;
