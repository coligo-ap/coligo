-- ============================================================
-- 0191 — Drive : abonnements à la DURÉE (1 sem / 2 sem / 1 mois) (LOT 7)
-- ============================================================
-- Le chauffeur choisit une durée à l'achat. Prix = tarif MENSUEL du plan ×
-- facteur de durée (configurable). Lancement (façon proposition proprio) :
--   facteur 1 sem = 0,35 · 2 sem = 0,60 · 1 mois = 1,0
-- Avec un Pro mensuel à 2000 DA → 700 / 1200 / 2000 (exactement la proposition).
-- On NE TOUCHE PAS au modèle Pro/Premium ni au prorata d'upgrade (0157) :
-- on ajoute juste la durée. L'upgrade reste prorata sur la date existante.
-- ============================================================

-- 1. Facteurs de durée + tarif mensuel Pro de lancement (2000).
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS drive_sub_week_factor   NUMERIC(4,3) NOT NULL DEFAULT 0.350,
  ADD COLUMN IF NOT EXISTS drive_sub_2week_factor  NUMERIC(4,3) NOT NULL DEFAULT 0.600;

-- Tarif mensuel Pro = 2000 (lancement) → 1 sem 700 / 2 sem 1200 / 1 mois 2000.
UPDATE public.platform_settings SET drive_plan_pro_fee_da = 2000 WHERE id = true;

-- 2. Durée portée par la souscription (jours). 30 = 1 mois (défaut, rétro-compat).
ALTER TABLE public.chauffeur_subscriptions
  ADD COLUMN IF NOT EXISTS duration_days SMALLINT NOT NULL DEFAULT 30;

-- 3. drive_subscribe v3 — accepte une durée (7 / 14 / 30 j) et tarife au prorata.
DROP FUNCTION IF EXISTS public.drive_subscribe(TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.drive_subscribe(
  p_plan TEXT,
  p_method TEXT,
  p_duration_days INTEGER DEFAULT 30,
  p_reference TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN, reason TEXT, subscription_id UUID, payment_id UUID, amount_da INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE; v_ch public.chauffeurs%ROWTYPE;
  v_monthly INTEGER; v_fee INTEGER; v_days INTEGER; v_sub UUID; v_pay UUID;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT * INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_ch.id IS NULL THEN ok:=false; reason:='not_a_chauffeur'; RETURN NEXT; RETURN; END IF;
  IF p_plan NOT IN ('pro','premium') THEN ok:=false; reason:='bad_plan'; RETURN NEXT; RETURN; END IF;
  IF p_method NOT IN ('ccp','card') THEN ok:=false; reason:='bad_method'; RETURN NEXT; RETURN; END IF;

  -- Durée valide uniquement parmi 7 / 14 / 30 (sinon 1 mois).
  v_days := CASE p_duration_days WHEN 7 THEN 7 WHEN 14 THEN 14 ELSE 30 END;

  v_monthly := CASE p_plan WHEN 'premium' THEN s.drive_plan_premium_fee_da ELSE s.drive_plan_pro_fee_da END;
  v_fee := CASE v_days
    WHEN 7  THEN GREATEST(100, ROUND(v_monthly * s.drive_sub_week_factor)::INTEGER)
    WHEN 14 THEN GREATEST(100, ROUND(v_monthly * s.drive_sub_2week_factor)::INTEGER)
    ELSE v_monthly
  END;

  -- Une seule tentative à la fois (idem 0157).
  UPDATE public.chauffeur_subscription_payments
     SET status='rejected', note='Remplacé par une nouvelle tentative', reviewed_at=now()
   WHERE chauffeur_id = v_ch.id AND status = 'pending';
  UPDATE public.chauffeur_subscriptions SET status='cancelled'
   WHERE chauffeur_id = v_ch.id AND status = 'pending_ccp';

  INSERT INTO public.chauffeur_subscriptions (chauffeur_id, plan, status, payment_method, duration_days)
  VALUES (v_ch.id, p_plan, 'pending_ccp', p_method, v_days)
  RETURNING id INTO v_sub;

  INSERT INTO public.chauffeur_subscription_payments
    (subscription_id, chauffeur_id, plan, amount_da, method, reference, status)
  VALUES (v_sub, v_ch.id, p_plan, v_fee, p_method,
          COALESCE(NULLIF(btrim(COALESCE(p_reference,'')),''), v_ch.phone), 'pending')
  RETURNING id INTO v_pay;

  ok:=true; reason:=NULL; subscription_id:=v_sub; payment_id:=v_pay; amount_da:=v_fee; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_subscribe(TEXT, TEXT, INTEGER, TEXT) TO authenticated;

-- 4. drive_sub_mark_paid v4 — la période activée suit la DURÉE choisie
--    (au lieu de +30 j fixe). Upgrade prorata inchangé (conserve la date).
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
    -- Renouvellement du même plan : prolonge la période en cours, selon la DURÉE.
    SELECT GREATEST(now(), COALESCE(max(cs.period_end), now())) INTO v_start
    FROM public.chauffeur_subscriptions cs
    WHERE cs.chauffeur_id = v_sub.chauffeur_id AND cs.status = 'active' AND cs.plan = v_sub.plan
      AND cs.period_end >= now();
    v_end := v_start + make_interval(days => COALESCE(v_sub.duration_days, 30));
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
