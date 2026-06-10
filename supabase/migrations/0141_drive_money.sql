-- ============================================================
-- 0141 — Coligo Drive : ARGENT (réconcilié SUM=0)
-- • Commission selon plan : Gratuit 8 % · Pro 3,5 % · Premium 0 %
--   (taux en config admin, snapshot à la complétion)
-- • BOOST : 100 % chauffeur, AUCUNE commission dessus (décision ROU)
-- • CASHBACK Drive : % du prix, FINANCÉ PAR LA COMMISSION
--   (cb = LEAST(round(F × taux), commission)) → jamais de perte
-- • Carte bancaire : course prépayée en ligne (Chargily) — la complétion
--   exige online_paid_at (le webhook seul fait foi, comme mig 0068)
-- • Abonnements : CCP (vérif admin 24 h) ou carte (activation immédiate),
--   recette drive_subscription_income ; échéance impayée → retour Gratuit ;
--   dette > seuil → GEL (jobs)
-- ============================================================

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS online_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS chargily_checkout_id TEXT;

-- ---------------------------------------------------------------------------
-- complete_ride v2 — argent par plan + boost + cashback.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE;
  v_ch UUID; v_ride public.rides%ROWTYPE;
  v_rate NUMERIC(5,4); v_F INTEGER; v_boost INTEGER; v_base INTEGER;
  v_c INTEGER; v_cb INTEGER; v_net INTEGER; v_bal INTEGER;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT id INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_ch IS NULL THEN ok:=false; reason:='not_a_chauffeur'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL OR v_ride.chauffeur_id <> v_ch THEN ok:=false; reason:='not_your_ride'; RETURN NEXT; RETURN; END IF;
  IF v_ride.status = 'completed' THEN ok:=true; reason:='already_completed'; RETURN NEXT; RETURN; END IF;
  IF v_ride.status <> 'in_progress' THEN ok:=false; reason:='not_in_progress'; RETURN NEXT; RETURN; END IF;

  -- F = prix convenu TOTAL (boost inclus). Le boost est 100 % chauffeur :
  -- la commission ne porte que sur la base (F − boost).
  v_F     := GREATEST(0, COALESCE(v_ride.agreed_price_da, v_ride.proposed_price_da + v_ride.boost_amount_da, 0));
  v_boost := LEAST(GREATEST(0, v_ride.boost_amount_da), v_F);
  v_base  := v_F - v_boost;
  v_rate  := public.resolve_vtc_commission(v_ch);
  v_c     := round(v_base * v_rate)::INTEGER;
  -- Cashback : % du prix total, PLAFONNÉ PAR LA COMMISSION (financement
  -- garanti — Premium 0 % ⇒ pas de cashback sur ces courses).
  v_cb    := LEAST(round(v_F * s.drive_cashback_rate)::INTEGER, v_c);
  v_net   := v_F - v_c;

  -- COLIGO PAY : débiter le client (solde requis).
  IF v_ride.payment_method = 'coligo_pay' THEN
    SELECT public.customer_topup_balance(v_ride.customer_id) INTO v_bal;
    IF COALESCE(v_bal,0) < v_F THEN ok:=false; reason:='insufficient_coligo_pay'; RETURN NEXT; RETURN; END IF;
    INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
    VALUES (v_ride.customer_id, NULL, 'topup_spent', 'topup', -v_F,
            'Course Drive — paiement Coligo Pay');
  -- CARTE : le webhook Chargily seul fait foi (course prépayée).
  ELSIF v_ride.payment_method = 'card' AND v_ride.online_paid_at IS NULL THEN
    ok:=false; reason:='card_not_paid'; RETURN NEXT; RETURN;
  END IF;

  UPDATE public.rides
     SET status='completed', completed_at=now(),
         commission_rate_applied=v_rate, commission_da=v_c,
         chauffeur_net_da=v_net, cashback_da=v_cb
   WHERE id = p_ride_id;

  IF v_ride.payment_method = 'cash' THEN
    -- Chauffeur custodian : encaisse F, garde net (boost compris), doit c.
    INSERT INTO public.ride_ledger (chauffeur_id, ride_id, type, amount_da)
    VALUES (v_ch, p_ride_id, 'chauffeur_cash_collected', v_F),
           (v_ch, p_ride_id, 'chauffeur_owes_platform', v_c),
           (v_ch, p_ride_id, 'chauffeur_payout', v_net)
    ON CONFLICT (ride_id, type) DO NOTHING;
  ELSE
    -- En ligne (Coligo Pay / carte) : plateforme détient F, doit net, garde c.
    INSERT INTO public.ride_ledger (chauffeur_id, ride_id, type, amount_da)
    VALUES (v_ch, p_ride_id, 'chauffeur_payout', v_net)
    ON CONFLICT (ride_id, type) DO NOTHING;
    IF v_c > 0 THEN
      INSERT INTO public.platform_ledger (order_id, type, amount_da)
      VALUES (NULL, 'vtc_commission_income', v_c);
    END IF;
  END IF;

  -- Cashback croisé (Drive ET livraison) : crédit client + charge plateforme
  -- (sortie de la commission déjà prélevée — convention mig 0017/0125).
  IF v_cb > 0 THEN
    INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
    VALUES (v_ride.customer_id, NULL, 'cashback_earned', 'cashback', v_cb, 'Cashback course Drive');
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NULL, 'cashback_expense', -v_cb);
  END IF;

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (p_ride_id, 'in_progress', 'completed', 'Course terminée');
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- Abonnements — souscription (CCP → vérification 24 h · carte → immédiat
-- après webhook). Le paiement validé active le plan pour 30 jours.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_subscribe(p_plan TEXT, p_method TEXT, p_reference TEXT DEFAULT NULL)
RETURNS TABLE(ok BOOLEAN, reason TEXT, subscription_id UUID, payment_id UUID, amount_da INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE; v_ch public.chauffeurs%ROWTYPE;
  v_fee INTEGER; v_sub UUID; v_pay UUID;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT * INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_ch.id IS NULL THEN ok:=false; reason:='not_a_chauffeur'; RETURN NEXT; RETURN; END IF;
  IF p_plan NOT IN ('pro','premium') THEN ok:=false; reason:='bad_plan'; RETURN NEXT; RETURN; END IF;
  IF p_method NOT IN ('ccp','card') THEN ok:=false; reason:='bad_method'; RETURN NEXT; RETURN; END IF;
  v_fee := CASE p_plan WHEN 'premium' THEN s.drive_plan_premium_fee_da ELSE s.drive_plan_pro_fee_da END;

  -- Une seule souscription en attente à la fois.
  UPDATE public.chauffeur_subscriptions SET status='cancelled'
   WHERE chauffeur_id = v_ch.id AND status = 'pending_ccp';

  INSERT INTO public.chauffeur_subscriptions (chauffeur_id, plan, status, payment_method)
  VALUES (v_ch.id, p_plan, 'pending_ccp', p_method)
  RETURNING id INTO v_sub;

  INSERT INTO public.chauffeur_subscription_payments
    (subscription_id, chauffeur_id, plan, amount_da, method, reference, status)
  VALUES (v_sub, v_ch.id, p_plan, v_fee, p_method,
          COALESCE(NULLIF(btrim(COALESCE(p_reference,'')),''), v_ch.phone), 'pending')
  RETURNING id INTO v_pay;

  ok:=true; reason:=NULL; subscription_id:=v_sub; payment_id:=v_pay; amount_da:=v_fee; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_subscribe(TEXT, TEXT, TEXT) TO authenticated;

-- Validation d'un paiement (admin pour CCP, webhook Chargily pour carte).
-- Active le plan : period = 30 jours à partir de max(now, fin de période en cours).
CREATE OR REPLACE FUNCTION public.drive_sub_mark_paid(p_payment_id UUID, p_reviewer TEXT DEFAULT NULL)
RETURNS TABLE(ok BOOLEAN, reason TEXT, chauffeur_user_id UUID, plan TEXT, period_end TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_pay public.chauffeur_subscription_payments%ROWTYPE;
  v_sub public.chauffeur_subscriptions%ROWTYPE;
  v_start TIMESTAMPTZ; v_uid UUID;
BEGIN
  SELECT * INTO v_pay FROM public.chauffeur_subscription_payments WHERE id = p_payment_id FOR UPDATE;
  IF v_pay.id IS NULL THEN ok:=false; reason:='payment_not_found'; RETURN NEXT; RETURN; END IF;
  IF v_pay.status = 'approved' THEN ok:=true; reason:='already_approved'; RETURN NEXT; RETURN; END IF;
  SELECT * INTO v_sub FROM public.chauffeur_subscriptions WHERE id = v_pay.subscription_id FOR UPDATE;
  IF v_sub.id IS NULL THEN ok:=false; reason:='subscription_not_found'; RETURN NEXT; RETURN; END IF;

  -- Prolonge la période active existante du même plan le cas échéant.
  SELECT GREATEST(now(), COALESCE(max(cs.period_end), now())) INTO v_start
  FROM public.chauffeur_subscriptions cs
  WHERE cs.chauffeur_id = v_sub.chauffeur_id AND cs.status = 'active' AND cs.plan = v_sub.plan
    AND cs.period_end >= now();

  UPDATE public.chauffeur_subscription_payments
     SET status='approved', reviewed_by=p_reviewer, reviewed_at=now()
   WHERE id = p_payment_id;
  UPDATE public.chauffeur_subscriptions
     SET status='active', period_start=v_start, period_end=v_start + INTERVAL '30 days'
   WHERE id = v_sub.id;

  -- Recette plateforme (l'abonnement est de l'argent à toi, pas du float).
  INSERT INTO public.platform_ledger (order_id, type, amount_da)
  VALUES (NULL, 'drive_subscription_income', v_pay.amount_da);

  SELECT c.user_id INTO v_uid FROM public.chauffeurs c WHERE c.id = v_sub.chauffeur_id;
  ok:=true; reason:=NULL; chauffeur_user_id:=v_uid; plan:=v_sub.plan;
  period_end:=v_start + INTERVAL '30 days'; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_sub_mark_paid(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.drive_sub_reject(p_payment_id UUID, p_note TEXT DEFAULT NULL, p_reviewer TEXT DEFAULT NULL)
RETURNS TABLE(ok BOOLEAN, reason TEXT, chauffeur_user_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_pay public.chauffeur_subscription_payments%ROWTYPE; v_uid UUID;
BEGIN
  SELECT * INTO v_pay FROM public.chauffeur_subscription_payments WHERE id = p_payment_id FOR UPDATE;
  IF v_pay.id IS NULL THEN ok:=false; reason:='payment_not_found'; RETURN NEXT; RETURN; END IF;
  IF v_pay.status <> 'pending' THEN ok:=false; reason:='not_pending'; RETURN NEXT; RETURN; END IF;
  UPDATE public.chauffeur_subscription_payments
     SET status='rejected', note=p_note, reviewed_by=p_reviewer, reviewed_at=now()
   WHERE id = p_payment_id;
  UPDATE public.chauffeur_subscriptions SET status='cancelled'
   WHERE id = v_pay.subscription_id AND status = 'pending_ccp';
  SELECT c.user_id INTO v_uid FROM public.chauffeurs c WHERE c.id = v_pay.chauffeur_id;
  ok:=true; reason:=NULL; chauffeur_user_id:=v_uid; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_sub_reject(UUID, TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- Gains / « À reverser à Coligo » (écran Gains + relevé).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_my_finances()
RETURNS TABLE(
  today_net_da BIGINT, today_rides BIGINT,
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

-- ---------------------------------------------------------------------------
-- JOBS (cron, service_role)
-- ---------------------------------------------------------------------------
-- 1) Échéance impayée (period_end + grâce dépassés) → retour plan Gratuit.
CREATE OR REPLACE FUNCTION public.drive_sub_expire_job()
RETURNS TABLE(chauffeur_id UUID, chauffeur_user_id UUID, plan TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE s public.platform_settings%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  RETURN QUERY
  WITH expired AS (
    UPDATE public.chauffeur_subscriptions cs
       SET status = 'expired'
     WHERE cs.status = 'active'
       AND cs.period_end + make_interval(days => s.drive_sub_grace_days) < now()
    RETURNING cs.chauffeur_id, cs.plan
  )
  SELECT e.chauffeur_id, c.user_id, e.plan
  FROM expired e JOIN public.chauffeurs c ON c.id = e.chauffeur_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_sub_expire_job() TO service_role;

-- 2) Gel automatique : dette > seuil · annulations répétées · note trop basse.
--    Tous les seuils en config admin. Retourne les gels pour notification FCM.
CREATE OR REPLACE FUNCTION public.drive_freeze_job()
RETURNS TABLE(chauffeur_id UUID, chauffeur_user_id UUID, freeze_reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE s public.platform_settings%ROWTYPE; rec RECORD; v_reason TEXT;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  FOR rec IN
    SELECT c.id, c.user_id,
      (SELECT COALESCE(sum(l.amount_da),0) FROM public.ride_ledger l
        WHERE l.chauffeur_id = c.id AND l.type='chauffeur_owes_platform' AND l.settled_at IS NULL) AS debt,
      (SELECT count(*) FILTER (WHERE r.status='cancelled' AND r.cancelled_by='chauffeur')::NUMERIC
              / NULLIF(count(*), 0)
         FROM (SELECT r2.status, r2.cancelled_by FROM public.rides r2
                WHERE r2.chauffeur_id = c.id AND r2.status IN ('completed','cancelled')
                ORDER BY r2.created_at DESC LIMIT s.drive_freeze_cancel_window) r) AS cancel_rate,
      (SELECT count(*) FROM (SELECT 1 FROM public.rides r3
         WHERE r3.chauffeur_id = c.id AND r3.status IN ('completed','cancelled')
         ORDER BY r3.created_at DESC LIMIT s.drive_freeze_cancel_window) t) AS cancel_n,
      (SELECT avg(r4.chauffeur_rating) FROM (SELECT r5.chauffeur_rating FROM public.rides r5
         WHERE r5.chauffeur_id = c.id AND r5.chauffeur_rating IS NOT NULL
         ORDER BY r5.completed_at DESC LIMIT s.drive_freeze_rating_window) r4) AS avg_rating,
      (SELECT count(*) FROM (SELECT 1 FROM public.rides r6
         WHERE r6.chauffeur_id = c.id AND r6.chauffeur_rating IS NOT NULL
         ORDER BY r6.completed_at DESC LIMIT s.drive_freeze_rating_window) t2) AS rating_n
    FROM public.chauffeurs c
    WHERE c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked
  LOOP
    v_reason := NULL;
    IF rec.debt >= s.drive_freeze_debt_da THEN
      v_reason := 'Impayé envers la plateforme (' || rec.debt || ' DA non reversés)';
    ELSIF rec.cancel_n >= s.drive_freeze_cancel_window
          AND COALESCE(rec.cancel_rate, 0) > s.drive_freeze_cancel_rate THEN
      v_reason := 'Annulations répétées au-dessus du seuil autorisé';
    ELSIF rec.rating_n >= s.drive_freeze_rating_window
          AND COALESCE(rec.avg_rating, 5) < s.drive_freeze_min_rating THEN
      v_reason := 'Note moyenne durablement sous le seuil minimal';
    END IF;
    IF v_reason IS NOT NULL THEN
      UPDATE public.chauffeurs
         SET is_frozen = true, frozen_reason = v_reason, frozen_at = now()
       WHERE id = rec.id;
      chauffeur_id := rec.id; chauffeur_user_id := rec.user_id; freeze_reason := v_reason;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_freeze_job() TO service_role;
