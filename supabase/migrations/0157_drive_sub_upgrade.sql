-- ============================================================
-- 0157 — Drive : upgrade prorata Pro → Premium + hygiène des
-- paiements d'abonnement en attente.
--
-- 1. `drive_subscribe` v2 : toute NOUVELLE tentative rejette les
--    paiements 'pending' précédents du chauffeur (sinon une carte
--    abandonnée restait « en vérification » pour toujours, dans
--    l'app ET dans la file admin).
-- 2. `drive_sub_upgrade(method)` : passage Pro → Premium en cours
--    de période, style Claude/Anthropic : on paie LA DIFFÉRENCE
--    (premium − pro) au prorata des jours restants, la date de
--    renouvellement NE CHANGE PAS (period_end du Pro conservé).
-- 3. `drive_sub_mark_paid` v3 : si la souscription porte
--    `upgrade_until`, l'activation court de now() à cette date
--    (au lieu de +30 j) ; l'ancien plan actif est annulé (0142).
-- 4. `drive_sub_cancel_my_pending()` : le chauffeur annule
--    lui-même sa tentative de paiement non finalisée.
-- ============================================================

ALTER TABLE public.chauffeur_subscriptions
  ADD COLUMN IF NOT EXISTS upgrade_until TIMESTAMPTZ;

-- ------------------------------------------------------------------
-- 1. drive_subscribe v2 — nettoie les tentatives précédentes.
-- ------------------------------------------------------------------
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

  -- Une seule tentative à la fois : on rejette les paiements en attente
  -- précédents (carte abandonnée, reçu CCP remplacé…) et leurs souscriptions.
  UPDATE public.chauffeur_subscription_payments
     SET status='rejected', note='Remplacé par une nouvelle tentative', reviewed_at=now()
   WHERE chauffeur_id = v_ch.id AND status = 'pending';
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

-- ------------------------------------------------------------------
-- 2. drive_sub_upgrade — Pro → Premium au prorata des jours restants.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_sub_upgrade(p_method TEXT, p_reference TEXT DEFAULT NULL)
RETURNS TABLE(ok BOOLEAN, reason TEXT, subscription_id UUID, payment_id UUID,
              amount_da INTEGER, days_left INTEGER, keeps_end TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE; v_ch public.chauffeurs%ROWTYPE;
  v_pro public.chauffeur_subscriptions%ROWTYPE;
  v_days INTEGER; v_amount INTEGER; v_sub UUID; v_pay UUID;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT * INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_ch.id IS NULL THEN ok:=false; reason:='not_a_chauffeur'; RETURN NEXT; RETURN; END IF;
  IF p_method NOT IN ('ccp','card') THEN ok:=false; reason:='bad_method'; RETURN NEXT; RETURN; END IF;

  -- Premium déjà actif → rien à upgrader.
  PERFORM 1 FROM public.chauffeur_subscriptions
   WHERE chauffeur_id = v_ch.id AND status='active' AND plan='premium' AND period_end > now();
  IF FOUND THEN ok:=false; reason:='already_premium'; RETURN NEXT; RETURN; END IF;

  -- Pro actif requis (sinon souscription Premium normale via drive_subscribe).
  SELECT * INTO v_pro FROM public.chauffeur_subscriptions
   WHERE chauffeur_id = v_ch.id AND status='active' AND plan='pro' AND period_end > now()
   ORDER BY period_end DESC LIMIT 1;
  IF v_pro.id IS NULL THEN ok:=false; reason:='no_active_pro'; RETURN NEXT; RETURN; END IF;

  -- Prorata « façon Claude » : différence de tarif × jours restants / 30,
  -- même date de renouvellement. Plancher 100 DA (minimum encaissable).
  v_days := LEAST(30, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_pro.period_end - now())) / 86400.0)::INTEGER));
  v_amount := GREATEST(100, ROUND((s.drive_plan_premium_fee_da - s.drive_plan_pro_fee_da) * v_days / 30.0)::INTEGER);

  -- Une seule tentative à la fois (même nettoyage que drive_subscribe).
  UPDATE public.chauffeur_subscription_payments
     SET status='rejected', note='Remplacé par une nouvelle tentative', reviewed_at=now()
   WHERE chauffeur_id = v_ch.id AND status = 'pending';
  UPDATE public.chauffeur_subscriptions SET status='cancelled'
   WHERE chauffeur_id = v_ch.id AND status = 'pending_ccp';

  INSERT INTO public.chauffeur_subscriptions (chauffeur_id, plan, status, payment_method, upgrade_until)
  VALUES (v_ch.id, 'premium', 'pending_ccp', p_method, v_pro.period_end)
  RETURNING id INTO v_sub;

  -- (note informative pour la file admin CCP)
  INSERT INTO public.chauffeur_subscription_payments
    (subscription_id, chauffeur_id, plan, amount_da, method, reference, status, note)
  VALUES (v_sub, v_ch.id, 'premium', v_amount, p_method,
          COALESCE(NULLIF(btrim(COALESCE(p_reference,'')),''), v_ch.phone), 'pending',
          'Upgrade Pro vers Premium · prorata ' || v_days || ' j')
  RETURNING id INTO v_pay;

  ok:=true; reason:=NULL; subscription_id:=v_sub; payment_id:=v_pay;
  amount_da:=v_amount; days_left:=v_days; keeps_end:=v_pro.period_end; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_sub_upgrade(TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------------
-- 3. drive_sub_mark_paid v3 — gère les upgrades (period_end conservé).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_sub_mark_paid(p_payment_id UUID, p_reviewer TEXT DEFAULT NULL)
RETURNS TABLE(ok BOOLEAN, reason TEXT, chauffeur_user_id UUID, plan TEXT, period_end TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_pay public.chauffeur_subscription_payments%ROWTYPE;
  v_sub public.chauffeur_subscriptions%ROWTYPE;
  v_start TIMESTAMPTZ; v_end TIMESTAMPTZ; v_uid UUID;
BEGIN
  SELECT * INTO v_pay FROM public.chauffeur_subscription_payments WHERE id = p_payment_id FOR UPDATE;
  IF v_pay.id IS NULL THEN ok:=false; reason:='payment_not_found'; RETURN NEXT; RETURN; END IF;
  IF v_pay.status = 'approved' THEN ok:=true; reason:='already_approved'; RETURN NEXT; RETURN; END IF;
  -- Un paiement rejeté/remplacé ne doit JAMAIS activer un plan (ex. webhook
  -- carte arrivant après que la tentative a été remplacée ou annulée).
  IF v_pay.status <> 'pending' THEN ok:=false; reason:='not_pending'; RETURN NEXT; RETURN; END IF;
  SELECT * INTO v_sub FROM public.chauffeur_subscriptions WHERE id = v_pay.subscription_id FOR UPDATE;
  IF v_sub.id IS NULL THEN ok:=false; reason:='subscription_not_found'; RETURN NEXT; RETURN; END IF;

  -- Changement de plan : l'ancien plan actif est remplacé immédiatement.
  UPDATE public.chauffeur_subscriptions cs SET status='cancelled'
   WHERE cs.chauffeur_id = v_sub.chauffeur_id AND cs.status='active'
     AND cs.id <> v_sub.id AND cs.plan <> v_sub.plan;

  IF v_sub.upgrade_until IS NOT NULL THEN
    -- Upgrade prorata : on conserve la date de renouvellement d'origine.
    v_start := now();
    v_end := GREATEST(v_sub.upgrade_until, now() + INTERVAL '1 day');
  ELSE
    -- Renouvellement du même plan : prolonge la période en cours.
    SELECT GREATEST(now(), COALESCE(max(cs.period_end), now())) INTO v_start
    FROM public.chauffeur_subscriptions cs
    WHERE cs.chauffeur_id = v_sub.chauffeur_id AND cs.status = 'active' AND cs.plan = v_sub.plan
      AND cs.period_end >= now();
    v_end := v_start + INTERVAL '30 days';
  END IF;

  UPDATE public.chauffeur_subscription_payments
     SET status='approved', reviewed_by=p_reviewer, reviewed_at=now()
   WHERE id = p_payment_id;
  UPDATE public.chauffeur_subscriptions
     SET status='active', period_start=v_start, period_end=v_end
   WHERE id = v_sub.id;

  INSERT INTO public.platform_ledger (order_id, type, amount_da)
  VALUES (NULL, 'drive_subscription_income', v_pay.amount_da);

  SELECT c.user_id INTO v_uid FROM public.chauffeurs c WHERE c.id = v_sub.chauffeur_id;
  ok:=true; reason:=NULL; chauffeur_user_id:=v_uid; plan:=v_sub.plan;
  period_end:=v_end; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_sub_mark_paid(UUID, TEXT) TO service_role;

-- ------------------------------------------------------------------
-- 4. Le chauffeur annule SA tentative en attente (carte abandonnée…).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_sub_cancel_my_pending()
RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_ch public.chauffeurs%ROWTYPE;
BEGIN
  SELECT * INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_ch.id IS NULL THEN ok:=false; reason:='not_a_chauffeur'; RETURN NEXT; RETURN; END IF;
  UPDATE public.chauffeur_subscription_payments
     SET status='rejected', note='Annulé par le chauffeur', reviewed_at=now()
   WHERE chauffeur_id = v_ch.id AND status = 'pending';
  UPDATE public.chauffeur_subscriptions SET status='cancelled'
   WHERE chauffeur_id = v_ch.id AND status = 'pending_ccp';
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_sub_cancel_my_pending() TO authenticated;
