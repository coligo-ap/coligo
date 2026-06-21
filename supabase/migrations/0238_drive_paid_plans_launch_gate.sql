-- =============================================================================
-- 0238 — Lancement chauffeur : MASQUER les abonnements payants (Pro/Premium)
-- =============================================================================
-- Décision produit : au LANCEMENT, le chauffeur n'a qu'un seul plan — Gratuit —
-- avec 0 % de commission (vtc_commission_rate déjà = 0.00 depuis mig 0207 :
-- « tout est à toi »). Les abonnements PAYANTS Pro/Premium (commission réduite
-- contre abonnement mensuel) sont MASQUÉS tant que la plateforme n'a pas de
-- volume. L'abonnement PRIORITAIRE (mig 0210, achat de visibilité, commun
-- livreur+chauffeur) reste DISPONIBLE — il n'est pas concerné par ce flag.
--
-- Implémentation « bypass-proof » (façon moteur de zones / feature_flags) :
--   1. Flag platform_settings.drive_paid_plans_enabled (DEFAULT false).
--   2. La SOURCE DE VÉRITÉ est le serveur : `drive_subscribe` et
--      `drive_sub_upgrade` REFUSENT toute souscription payante tant que le flag
--      est faux — masquer les boutons côté UI ne suffit pas (un appel RPC forgé
--      doit échouer aussi). 0 tolérance.
--   3. Le super-admin réactive Pro/Premium en cochant la case dans /admin/drive
--      (aucune valeur en dur dans le code).
--
-- Aucun impact sur l'argent : à 0 % de commission, complete_ride pose déjà
-- commission_da = 0 et chauffeur_net = prix total (mig 0141), donc rien n'est
-- prélevé sur la Coligo Pay (portefeuille opérateur) du chauffeur.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Flag de lancement
-- ----------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS drive_paid_plans_enabled BOOLEAN NOT NULL DEFAULT false;

-- Au lancement : explicitement désactivé (idempotent si la colonne préexiste).
UPDATE public.platform_settings SET drive_paid_plans_enabled = false WHERE id = true;

-- ----------------------------------------------------------------------------
-- 2. drive_subscribe (reprend mig 0191) + garde « plans payants désactivés »
-- ----------------------------------------------------------------------------
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

  -- GARDE LANCEMENT : aucun abonnement payant tant que le flag est faux.
  IF NOT COALESCE(s.drive_paid_plans_enabled, false) THEN
    ok:=false; reason:='paid_plans_disabled'; RETURN NEXT; RETURN;
  END IF;

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

-- ----------------------------------------------------------------------------
-- 3. drive_sub_upgrade (reprend mig 0157) + même garde
-- ----------------------------------------------------------------------------
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

  -- GARDE LANCEMENT : aucun upgrade payant tant que le flag est faux.
  IF NOT COALESCE(s.drive_paid_plans_enabled, false) THEN
    ok:=false; reason:='paid_plans_disabled'; RETURN NEXT; RETURN;
  END IF;

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
