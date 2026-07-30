-- ============================================================================
-- 0421 — Roue Coligo : lot « LIVRAISON GRATUITE » (paramétrable super-admin).
--
-- Principes financiers (audit 0103/0121/0166/0292 respecté) :
--  • delivery_fee_da reste TOUJOURS le vrai prix (l'Express paie son livreur —
--    mig 0103 : fee=0 ⇒ driver_payout=0, interdit). La gratuité est une
--    REMISE CLIENT financée par Coligo : orders.delivery_credit_da vient en
--    déduction du total payé, et part au ledger en 'promo_expense' au paiement
--    (même poste que les codes promo → états financiers inchangés, SUM = 0).
--  • NON CUMULABLE avec un code promo plateforme (règle appliquée au checkout
--    ET filet dans le trigger) : garantit une seule ligne promo_expense/ordre.
--  • Le crédit est consommé À LA CRÉATION de la commande (anti-abus).
-- ============================================================================

-- 1) wheel_prizes : autoriser le kind 'free_delivery' (amount_da reste 0 —
--    la contrainte (kind='voucher') = (amount_da>0) est déjà satisfaite).
ALTER TABLE public.wheel_prizes DROP CONSTRAINT wheel_prizes_kind_check;
ALTER TABLE public.wheel_prizes
  ADD CONSTRAINT wheel_prizes_kind_check
  CHECK (kind IN ('voucher', 'nothing', 'free_delivery'));

-- 2) Réglages super-admin : validité (jours) + plafond de frais couverts.
ALTER TABLE public.wheel_settings
  ADD COLUMN IF NOT EXISTS free_delivery_valid_days INTEGER NOT NULL DEFAULT 7
    CHECK (free_delivery_valid_days BETWEEN 1 AND 60),
  ADD COLUMN IF NOT EXISTS free_delivery_max_fee_da INTEGER NOT NULL DEFAULT 250
    CHECK (free_delivery_max_fee_da >= 50);

-- 3) Crédits de livraison gagnés (un par victoire, consommé à la 1re commande
--    livrée avant expiration).
CREATE TABLE public.customer_delivery_credits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  source            TEXT NOT NULL DEFAULT 'wheel',
  max_fee_da        INTEGER NOT NULL CHECK (max_fee_da > 0),
  granted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'consumed', 'revoked')),
  consumed_order_id UUID REFERENCES public.orders(id),
  consumed_at       TIMESTAMPTZ
);
CREATE INDEX idx_cdc_customer_active
  ON public.customer_delivery_credits (customer_id, status, expires_at);

ALTER TABLE public.customer_delivery_credits ENABLE ROW LEVEL SECURITY;
-- Lecture : le client voit SES crédits (affichage checkout/roue). Écritures :
-- AUCUNE policy → uniquement wheel_spin (DEFINER) et service_role (checkout).
CREATE POLICY cdc_select_own ON public.customer_delivery_credits
  FOR SELECT TO authenticated
  USING (customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid()));

-- 4) Trace sur la commande (remise financée Coligo).
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_credit_id UUID REFERENCES public.customer_delivery_credits(id),
  ADD COLUMN IF NOT EXISTS delivery_credit_da INTEGER NOT NULL DEFAULT 0
    CHECK (delivery_credit_da >= 0);

-- 5) Garde financière (0166) : geler AUSSI les nouvelles colonnes côté rôles
--    client. Redéfinition COMPLÈTE depuis la définition LIVE (jamais depuis le
--    texte d'une vieille migration).
CREATE OR REPLACE FUNCTION public.protect_order_financial_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- current_user = 'postgres' à l'intérieur des fonctions SECURITY DEFINER, et
  -- 'service_role' pour les webhooks/admin → on ne bride QUE les écritures
  -- directes via PostgREST sous un rôle de connexion utilisateur.
  IF current_user IN ('authenticated', 'anon') THEN
    -- Montants
    NEW.subtotal_da            := OLD.subtotal_da;
    NEW.discount_da            := OLD.discount_da;
    NEW.gross_total_da         := OLD.gross_total_da;
    NEW.net_total_da           := OLD.net_total_da;
    NEW.total_da               := OLD.total_da;
    NEW.service_fee_da         := OLD.service_fee_da;
    NEW.delivery_fee_da        := OLD.delivery_fee_da;
    NEW.delivery_credit_da     := OLD.delivery_credit_da;
    NEW.delivery_credit_id     := OLD.delivery_credit_id;
    NEW.commission_da          := OLD.commission_da;
    NEW.cashback_da            := OLD.cashback_da;
    NEW.cashback_estimate_da   := OLD.cashback_estimate_da;
    NEW.cashback_used_da       := OLD.cashback_used_da;
    NEW.topup_used_da          := OLD.topup_used_da;
    -- Snapshots de taux + commission tournée
    NEW.commission_rate_applied             := OLD.commission_rate_applied;
    NEW.cashback_rate_applied               := OLD.cashback_rate_applied;
    NEW.chargily_fee_rate_applied           := OLD.chargily_fee_rate_applied;
    NEW.tour_delivery_commission_da         := OLD.tour_delivery_commission_da;
    NEW.tour_delivery_commission_rate_applied := OLD.tour_delivery_commission_rate_applied;
    -- Snapshots livreur (custodian express)
    NEW.driver_fee_da          := OLD.driver_fee_da;
    NEW.driver_net_da          := OLD.driver_net_da;
    NEW.driver_fee_rate_applied := OLD.driver_fee_rate_applied;
    NEW.driver_cash_collected_da := OLD.driver_cash_collected_da;
    NEW.driver_owes_merchant_da  := OLD.driver_owes_merchant_da;
    NEW.driver_owes_platform_da  := OLD.driver_owes_platform_da;
    -- Paiement / intégrité
    NEW.payment_method         := OLD.payment_method;
    NEW.payment_status         := OLD.payment_status;
    NEW.pickup_code            := OLD.pickup_code;
    NEW.order_number           := OLD.order_number;
    NEW.delivery_driver_id     := OLD.delivery_driver_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- 6) wheel_spin v2 : branche free_delivery (crédit N jours) + retour free_days.
--    Redéfini depuis la définition LIVE. Corrige au passage la graphie arabe
--    de la marque dans le libellé voucher (كوليغو, jamais كوليقو).
CREATE OR REPLACE FUNCTION public.wheel_spin()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer uuid;
  v_settings public.wheel_settings%ROWTYPE;
  v_total    integer;
  v_roll     integer;
  v_prize    public.wheel_prizes%ROWTYPE;
  v_streak   integer := 1;
  v_amount   integer;
  v_bonus    boolean := false;
  v_spin_id  uuid;
  v_voucher  uuid;
  v_days     integer := 0;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_customer');
  END IF;
  SELECT * INTO v_settings FROM public.wheel_settings WHERE id = 1;
  IF v_settings.enabled IS DISTINCT FROM TRUE
     OR public.feature_blocked('wheel') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;

  -- Tirage pondéré serveur sur les lots ACTIFS.
  SELECT COALESCE(SUM(weight), 0) INTO v_total
    FROM public.wheel_prizes WHERE active;
  IF v_total <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_prizes');
  END IF;
  v_roll := floor(random() * v_total)::int;
  FOR v_prize IN SELECT * FROM public.wheel_prizes WHERE active ORDER BY position, id
  LOOP
    v_roll := v_roll - v_prize.weight;
    EXIT WHEN v_roll < 0;
  END LOOP;

  -- Série : hier joué → streak d'hier + 1, sinon 1.
  SELECT COALESCE(streak, 0) + 1 INTO v_streak
    FROM public.wheel_spins
   WHERE customer_id = v_customer AND day = CURRENT_DATE - 1;
  v_streak := COALESCE(v_streak, 1);

  v_amount := v_prize.amount_da;
  IF v_prize.kind = 'voucher'
     AND v_settings.streak_target > 0
     AND v_streak % v_settings.streak_target = 0 THEN
    v_amount := v_amount * v_settings.streak_multiplier;
    v_bonus := true;
  END IF;

  -- UN par jour : l'insert conditionnel EST le verrou.
  INSERT INTO public.wheel_spins (customer_id, day, prize_id, amount_da, streak)
  VALUES (v_customer, CURRENT_DATE, v_prize.id, v_amount, v_streak)
  ON CONFLICT (customer_id, day) DO NOTHING
  RETURNING id INTO v_spin_id;
  IF v_spin_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_spun');
  END IF;

  -- Lot réel → bon d'achat (le trigger 0293 crédite Coligo Pay + ledger).
  IF v_prize.kind = 'voucher' AND v_amount > 0 THEN
    INSERT INTO public.customer_vouchers
      (customer_id, amount_da, label_fr, label_ar, reason)
    VALUES
      (v_customer, v_amount,
       'Roue Coligo — ' || v_prize.label_fr,
       CASE WHEN v_prize.label_ar IS NULL THEN NULL
            ELSE 'عجلة كوليغو — ' || v_prize.label_ar END,
       'loyalty')
    RETURNING id INTO v_voucher;
    UPDATE public.wheel_spins SET voucher_id = v_voucher WHERE id = v_spin_id;
  ELSIF v_prize.kind = 'free_delivery' THEN
    -- Livraison OFFERTE : crédit à durée limitée, consommé automatiquement à
    -- la prochaine commande livrée (checkout, non cumulable avec un code).
    v_days := GREATEST(1, COALESCE(v_settings.free_delivery_valid_days, 7));
    INSERT INTO public.customer_delivery_credits
      (customer_id, source, max_fee_da, expires_at)
    VALUES
      (v_customer, 'wheel',
       GREATEST(50, COALESCE(v_settings.free_delivery_max_fee_da, 250)),
       now() + make_interval(days => v_days));
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'prize_id', v_prize.id,
    'kind', v_prize.kind,
    'amount_da', v_amount,
    'label_fr', v_prize.label_fr,
    'label_ar', v_prize.label_ar,
    'streak', v_streak,
    'bonus', v_bonus,
    'free_days', v_days
  );
END;
$function$;

-- 7) Financement Coligo au PAIEMENT : même poste ledger que les codes promo
--    (promo_expense, SUM=0 conservé, états financiers inchangés). Filet
--    non-cumul : rien si un code plateforme est déjà sur la commande.
CREATE OR REPLACE FUNCTION public.apply_delivery_credit_on_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.payment_status = 'paid'
     AND OLD.payment_status IS DISTINCT FROM 'paid'
     AND COALESCE(NEW.delivery_credit_da, 0) > 0
     AND NEW.platform_promo_id IS NULL THEN
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NEW.id, 'promo_expense', -NEW.delivery_credit_da)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_delivery_credit_on_paid ON public.orders;
CREATE TRIGGER trigger_delivery_credit_on_paid
  AFTER UPDATE OF payment_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.apply_delivery_credit_on_paid();
