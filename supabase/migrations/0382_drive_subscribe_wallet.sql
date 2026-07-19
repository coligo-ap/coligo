-- =============================================================================
-- 0382 — Abonnements Drive payables avec Coligo Pay (portefeuille opérateur)
-- -----------------------------------------------------------------------------
-- Refonte de la page Abonnement (chauffeur) : chaque offre porte UN bouton
-- « S'abonner » ; quand le solde Coligo Pay couvre le prix, le paiement est
-- instantané au portefeuille — même modèle que le Pass Prioritaire (0210/0309).
-- drive_subscribe apprend donc p_method = 'wallet' :
--   solde vérifié (operator_effective_balance) AVANT toute écriture →
--   débit 'fee_debit' idempotent (client_operation_id) →
--   activation par drive_sub_mark_paid (MÊME chemin que le webhook carte :
--   période selon la durée du plan, remplacement d'un plan actif, ledger).
-- TOUT-OU-RIEN : un échec d'activation lève une exception → le débit et la
-- souscription sont annulés dans la même transaction.
-- =============================================================================

-- 1. Les CHECK figés à ('ccp','card') depuis 0139 apprennent 'wallet'.
ALTER TABLE public.chauffeur_subscriptions
  DROP CONSTRAINT IF EXISTS chauffeur_subscriptions_payment_method_check;
ALTER TABLE public.chauffeur_subscriptions
  ADD CONSTRAINT chauffeur_subscriptions_payment_method_check
  CHECK (payment_method IN ('ccp', 'card', 'wallet'));

ALTER TABLE public.chauffeur_subscription_payments
  DROP CONSTRAINT IF EXISTS chauffeur_subscription_payments_method_check;
ALTER TABLE public.chauffeur_subscription_payments
  ADD CONSTRAINT chauffeur_subscription_payments_method_check
  CHECK (method IN ('ccp', 'card', 'wallet'));

-- 2. drive_subscribe v5 — reprend intégralement 0304 §7 + méthode 'wallet'.
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
  v_ch public.chauffeurs%ROWTYPE; v_p public.drive_plans%ROWTYPE;
  v_sub UUID; v_pay UUID; v_wallet UUID; v_ok BOOLEAN; v_reason TEXT;
BEGIN
  SELECT * INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_ch.id IS NULL THEN ok:=false; reason:='not_a_chauffeur'; RETURN NEXT; RETURN; END IF;
  IF p_method NOT IN ('ccp','card','wallet') THEN ok:=false; reason:='bad_method'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_p FROM public.drive_plans WHERE code = p_plan;
  IF v_p.code IS NULL OR v_p.is_default THEN ok:=false; reason:='bad_plan'; RETURN NEXT; RETURN; END IF;
  IF NOT v_p.is_active THEN ok:=false; reason:='plan_inactive'; RETURN NEXT; RETURN; END IF;
  IF v_p.price_da <= 0 THEN ok:=false; reason:='plan_free'; RETURN NEXT; RETURN; END IF;

  -- Portefeuille : solde vérifié AVANT toute écriture (verdict clair côté UI).
  IF p_method = 'wallet' THEN
    v_wallet := public.ensure_operator_wallet('chauffeur', v_ch.id);
    IF v_wallet IS NULL OR public.operator_effective_balance(v_wallet) < v_p.price_da THEN
      ok:=false; reason:='insufficient_wallet'; RETURN NEXT; RETURN;
    END IF;
  END IF;

  -- Une seule tentative à la fois (idem 0157/0191/0304).
  UPDATE public.chauffeur_subscription_payments
     SET status='rejected', note='Remplacé par une nouvelle tentative', reviewed_at=now()
   WHERE chauffeur_id = v_ch.id AND status = 'pending';
  UPDATE public.chauffeur_subscriptions SET status='cancelled'
   WHERE chauffeur_id = v_ch.id AND status = 'pending_ccp';

  INSERT INTO public.chauffeur_subscriptions (chauffeur_id, plan, status, payment_method, duration_days)
  VALUES (v_ch.id, v_p.code, 'pending_ccp', p_method, v_p.duration_days)
  RETURNING id INTO v_sub;

  INSERT INTO public.chauffeur_subscription_payments
    (subscription_id, chauffeur_id, plan, amount_da, method, reference, status)
  VALUES (v_sub, v_ch.id, v_p.code, v_p.price_da, p_method,
          COALESCE(NULLIF(btrim(COALESCE(p_reference,'')),''), v_ch.phone), 'pending')
  RETURNING id INTO v_pay;

  IF p_method = 'wallet' THEN
    -- Débit instantané, puis activation par le même chemin que le webhook.
    INSERT INTO public.operator_wallet_entries (wallet_id, type, amount_da, note, client_operation_id)
    VALUES (v_wallet, 'fee_debit', -v_p.price_da,
            'Abonnement Drive ' || v_p.title, 'drive_sub:' || v_pay::text);

    SELECT m.ok, m.reason INTO v_ok, v_reason
      FROM public.drive_sub_mark_paid(v_pay, 'wallet') m;
    IF NOT COALESCE(v_ok, false) THEN
      RAISE EXCEPTION 'drive_subscribe wallet: activation refusée (%)', COALESCE(v_reason, '?');
    END IF;
  END IF;

  ok:=true; reason:=NULL; subscription_id:=v_sub; payment_id:=v_pay; amount_da:=v_p.price_da; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_subscribe(TEXT, TEXT, INTEGER, TEXT) TO authenticated;
