-- ============================================================
-- 0142 — Drive : changer de plan remplace l'ancien abonnement
-- « Changez quand vous voulez » (maquette) : à l'activation d'un
-- paiement, les abonnements actifs d'un AUTRE plan sont annulés
-- (sinon resolve_drive_plan pouvait garder l'ancien plan dont la
-- période courait encore). Les renouvellements du MÊME plan
-- continuent de s'empiler (period_end prolongé).
-- ============================================================
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

  -- Changement de plan : l'ancien plan actif est remplacé immédiatement.
  UPDATE public.chauffeur_subscriptions cs SET status='cancelled'
   WHERE cs.chauffeur_id = v_sub.chauffeur_id AND cs.status='active'
     AND cs.id <> v_sub.id AND cs.plan <> v_sub.plan;

  -- Renouvellement du même plan : prolonge la période en cours.
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

  INSERT INTO public.platform_ledger (order_id, type, amount_da)
  VALUES (NULL, 'drive_subscription_income', v_pay.amount_da);

  SELECT c.user_id INTO v_uid FROM public.chauffeurs c WHERE c.id = v_sub.chauffeur_id;
  ok:=true; reason:=NULL; chauffeur_user_id:=v_uid; plan:=v_sub.plan;
  period_end:=v_start + INTERVAL '30 days'; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_sub_mark_paid(UUID, TEXT) TO service_role;
