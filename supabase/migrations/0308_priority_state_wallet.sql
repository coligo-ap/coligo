-- =============================================================================
-- 0308 — my_priority_state expose le SOLDE Coligo Pay (paiement adaptatif)
-- -----------------------------------------------------------------------------
-- La carte « Pass Prioritaire » doit décider AVANT le clic quel moyen de paiement
-- mettre en avant : si le solde du portefeuille couvre l'abonnement → bouton
-- « Payer avec mon solde Coligo Pay » ; sinon → autres moyens (carte) + recharge.
-- On ajoute wallet_balance (solde effectif du portefeuille opérateur du partenaire).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.my_priority_state()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_type TEXT; v_subject UUID; v_sub public.priority_subscriptions%ROWTYPE;
  v_monthly INTEGER; v_promo INTEGER; v_ever BOOLEAN; v_wallet UUID; v_bal INTEGER;
BEGIN
  SELECT id INTO v_subject FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_subject IS NOT NULL THEN v_type := 'chauffeur';
  ELSE
    SELECT id INTO v_subject FROM public.drivers WHERE user_id = auth.uid();
    IF v_subject IS NOT NULL THEN v_type := 'driver'; END IF;
  END IF;
  IF v_subject IS NULL THEN RETURN jsonb_build_object('partner', false); END IF;

  SELECT sub_priority_monthly_da, sub_priority_first_month_da
    INTO v_monthly, v_promo FROM public.platform_settings WHERE id = true;

  SELECT * INTO v_sub FROM public.priority_subscriptions
   WHERE subject_type = v_type AND subject_id = v_subject
     AND status IN ('pending','active')
   ORDER BY created_at DESC LIMIT 1;

  v_ever := EXISTS (SELECT 1 FROM public.priority_subscriptions
                    WHERE subject_type = v_type AND subject_id = v_subject);

  -- Solde effectif du portefeuille opérateur (0 si pas encore de portefeuille).
  SELECT id INTO v_wallet FROM public.operator_wallets
   WHERE owner_type = v_type AND owner_id = v_subject;
  v_bal := CASE WHEN v_wallet IS NULL THEN 0
                ELSE public.operator_effective_balance(v_wallet) END;

  RETURN jsonb_build_object(
    'partner', true,
    'subject_type', v_type,
    'is_priority', public.is_priority(v_type, v_subject),
    'status', COALESCE(v_sub.status, 'none'),
    'period_end', v_sub.period_end,
    'price_da', CASE WHEN v_ever THEN v_monthly ELSE v_promo END,
    'monthly_da', v_monthly,
    'first_month_da', v_promo,
    'eligible_first_month', NOT v_ever,
    'wallet_balance', v_bal
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.my_priority_state() TO authenticated;
