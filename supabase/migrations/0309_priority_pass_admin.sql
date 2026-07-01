-- =============================================================================
-- 0309 — Pass Prioritaire piloté côté super-admin (« comme un abonnement »)
-- -----------------------------------------------------------------------------
-- Le Pass Prioritaire (mig 0210) est un abonnement commun livreur + chauffeur
-- dont le prix / la promo / la fenêtre dispatch vivaient dans platform_settings
-- sans surface de gestion dédiée. On le PROMEUT en abonnement de premier plan
-- géré depuis /admin/chauffeurs/abonnements (carte « Pass Prioritaire »), à côté
-- des plans Drive.
--
-- Ajout : un interrupteur `priority_pass_enabled` (comme le is_active d'un plan).
-- Tant qu'il est OFF, aucune NOUVELLE souscription n'est possible — garde serveur
-- BYPASS-PROOF dans priority_subscribe (un appel forgé est refusé). Les abos déjà
-- actifs courent jusqu'à leur échéance (on ne rembourse pas rétroactivement).
-- =============================================================================

-- 1. Interrupteur de disponibilité (par défaut ON : zéro régression).
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS priority_pass_enabled BOOLEAN NOT NULL DEFAULT true;

-- Inscrit au registre de config générique (cohérence avec /admin/config).
INSERT INTO public.platform_config_registry
  (key, value_type, group_key, label_fr, label_ar, help_fr, help_ar, sort_order, min_num, max_num, step_num, json_shape)
VALUES
  ('priority_pass_enabled', 'bool', 'abonnements',
   'Pass Prioritaire proposé aux partenaires', 'تفعيل الاشتراك المميّز للشركاء',
   'Quand c''est décoché, aucun livreur ni chauffeur ne peut souscrire un nouveau Pass Prioritaire (les abonnements en cours restent valables jusqu''à échéance).',
   'عند إلغاء التفعيل، لا يمكن لأي سائق الاشتراك في باقة مميّزة جديدة.',
   5, NULL, NULL, NULL, NULL)
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. priority_subscribe : refuse toute nouvelle souscription si le pass est OFF.
--    (Reprend intégralement 0210 §3 + garde `priority_pass_enabled`.)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.priority_subscribe(p_payment_method text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_type     TEXT;
  v_subject  UUID;
  v_amount   INTEGER;
  v_first    BOOLEAN;
  v_wallet   UUID;
  v_sub      UUID;
  v_monthly  INTEGER;
  v_promo    INTEGER;
  v_enabled  BOOLEAN;
BEGIN
  IF p_payment_method NOT IN ('wallet','ccp','card') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_method');
  END IF;

  -- Garde de disponibilité (bypass-proof : imposée serveur, jamais par le client).
  SELECT priority_pass_enabled, sub_priority_monthly_da, sub_priority_first_month_da
    INTO v_enabled, v_monthly, v_promo FROM public.platform_settings WHERE id = true;
  IF NOT COALESCE(v_enabled, true) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pass_disabled');
  END IF;

  -- Résolution de l'acteur (livreur ou chauffeur) depuis auth.uid().
  SELECT id INTO v_subject FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_subject IS NOT NULL THEN v_type := 'chauffeur';
  ELSE
    SELECT id INTO v_subject FROM public.drivers WHERE user_id = auth.uid();
    IF v_subject IS NOT NULL THEN v_type := 'driver'; END IF;
  END IF;
  IF v_subject IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_partner'); END IF;

  -- Déjà un abo actif/pending ?
  IF EXISTS (SELECT 1 FROM public.priority_subscriptions
             WHERE subject_type = v_type AND subject_id = v_subject
               AND status IN ('pending','active')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_subscribed');
  END IF;

  -- 1er mois promo si l'acteur n'a JAMAIS eu d'abo.
  v_first  := NOT EXISTS (SELECT 1 FROM public.priority_subscriptions
                          WHERE subject_type = v_type AND subject_id = v_subject);
  v_amount := CASE WHEN v_first THEN v_promo ELSE v_monthly END;

  IF p_payment_method = 'wallet' THEN
    -- Paiement immédiat depuis le float opérateur.
    SELECT id INTO v_wallet FROM public.operator_wallets
      WHERE owner_type = v_type AND owner_id = v_subject;
    IF v_wallet IS NULL THEN
      PERFORM public.ensure_operator_wallet(v_type, v_subject, now());
      SELECT id INTO v_wallet FROM public.operator_wallets
        WHERE owner_type = v_type AND owner_id = v_subject;
    END IF;
    IF public.operator_effective_balance(v_wallet) < v_amount THEN
      RETURN jsonb_build_object('ok', false, 'error', 'insufficient_wallet');
    END IF;

    INSERT INTO public.priority_subscriptions
      (subject_type, subject_id, status, period_start, period_end, amount_da, is_first_month, payment_method)
    VALUES (v_type, v_subject, 'active', now(), now() + interval '30 days', v_amount, v_first, 'wallet')
    RETURNING id INTO v_sub;

    INSERT INTO public.operator_wallet_entries (wallet_id, type, amount_da, note, client_operation_id)
    VALUES (v_wallet, 'fee_debit', -v_amount, 'Abonnement Prioritaire', 'prio_sub:' || v_sub::text);

    RETURN jsonb_build_object('ok', true, 'status', 'active', 'sub_id', v_sub,
                              'amount_da', v_amount, 'is_first_month', v_first);
  ELSE
    -- CCP / carte : créé en attente, activé par priority_sub_mark_paid (webhook/admin).
    INSERT INTO public.priority_subscriptions
      (subject_type, subject_id, status, amount_da, is_first_month, payment_method)
    VALUES (v_type, v_subject, 'pending', v_amount, v_first, p_payment_method)
    RETURNING id INTO v_sub;

    RETURN jsonb_build_object('ok', true, 'status', 'pending', 'sub_id', v_sub,
                              'amount_da', v_amount, 'is_first_month', v_first);
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.priority_subscribe(text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. my_priority_state : expose `enabled` (l'UI partenaire masque l'offre si OFF).
--    (Reprend 0308 — wallet_balance conservé — + `enabled`.)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_priority_state()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_type TEXT; v_subject UUID; v_sub public.priority_subscriptions%ROWTYPE;
  v_monthly INTEGER; v_promo INTEGER; v_ever BOOLEAN; v_wallet UUID; v_bal INTEGER;
  v_enabled BOOLEAN;
BEGIN
  SELECT id INTO v_subject FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_subject IS NOT NULL THEN v_type := 'chauffeur';
  ELSE
    SELECT id INTO v_subject FROM public.drivers WHERE user_id = auth.uid();
    IF v_subject IS NOT NULL THEN v_type := 'driver'; END IF;
  END IF;
  IF v_subject IS NULL THEN RETURN jsonb_build_object('partner', false); END IF;

  SELECT sub_priority_monthly_da, sub_priority_first_month_da, priority_pass_enabled
    INTO v_monthly, v_promo, v_enabled FROM public.platform_settings WHERE id = true;

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
    'enabled', COALESCE(v_enabled, true),
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
