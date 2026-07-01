-- =============================================================================
-- 0304 — ABONNEMENTS DRIVE data-driven + SÉCURITÉ anti-altération de prix/taux
-- -----------------------------------------------------------------------------
-- Le super-admin peut créer/éditer librement des plans (nom, prix, commission,
-- cashback, avantages, badge, ordre d'affichage, période jour/semaine/mois).
-- Les taux et prix vivent UNIQUEMENT côté serveur (cette table). Un chauffeur /
-- client ne transmet JAMAIS qu'un CODE de plan ; le prix et les taux sont imposés
-- par le serveur → aucune altération possible ni depuis le frontend ni via
-- PostgREST direct.
--
-- Défense en profondeur (3 verrous) contre l'écriture par un utilisateur :
--   1. RLS : SELECT des plans actifs seulement (public) ; AUCUNE policy d'écriture.
--   2. GRANTS : REVOKE INSERT/UPDATE/DELETE à authenticated/anon (SELECT seul).
--   3. TRIGGER garde : refuse toute écriture hors service_role/postgres (même si
--      une policy était ajoutée par erreur ou via un chemin definer).
-- Écriture = exclusivement le service_role (Server Actions admin gardées adminCan).
--
-- Recâblage (lecture) : resolve_drive_plan lit la table ; le cashback Drive et
-- l'ordre de dispatch (chauffeurs_present_near) suivent le plan du chauffeur ;
-- drive_subscribe lit prix + durée depuis la table (jamais le client).
-- =============================================================================

-- 1. TABLE ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.drive_plans (
  code            TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  subtitle        TEXT,
  price_da        INTEGER NOT NULL DEFAULT 0 CHECK (price_da >= 0),
  billing_period  TEXT NOT NULL DEFAULT 'month' CHECK (billing_period IN ('day','week','month')),
  duration_days   INTEGER NOT NULL DEFAULT 30 CHECK (duration_days >= 1 AND duration_days <= 366),
  commission_rate NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (commission_rate >= 0 AND commission_rate <= 1),
  cashback_rate   NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (cashback_rate >= 0 AND cashback_rate <= 1),
  advantages      TEXT[] NOT NULL DEFAULT '{}',
  badge_label     TEXT,
  badge_color     TEXT,                    -- hex (#RRGGBB) pour l'UI
  display_rank    INTEGER NOT NULL DEFAULT 0,  -- plus haut = affiché en premier au dispatch
  is_priority     BOOLEAN NOT NULL DEFAULT false,  -- accès prioritaire au dispatch
  is_default      BOOLEAN NOT NULL DEFAULT false,  -- plan de base (aucun abonnement)
  is_active       BOOLEAN NOT NULL DEFAULT true,   -- proposable au chauffeur
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- INVARIANT FINANCIER DUR : le cashback est financé PAR la commission, jamais
  -- au-delà → un plan ne peut pas offrir plus de cashback qu'il ne prend de commission.
  CONSTRAINT drive_plans_cashback_le_commission CHECK (cashback_rate <= commission_rate)
);

-- Un seul plan par défaut.
CREATE UNIQUE INDEX IF NOT EXISTS uq_drive_plans_one_default
  ON public.drive_plans (is_default) WHERE is_default;

COMMENT ON TABLE public.drive_plans IS
  'Plans d''abonnement Drive (source de vérité prix/commission/cashback). Écriture service_role uniquement.';

-- 2. SÉCURITÉ -------------------------------------------------------------------
ALTER TABLE public.drive_plans ENABLE ROW LEVEL SECURITY;
-- Force la RLS même pour le propriétaire de la table (defense-in-depth).
ALTER TABLE public.drive_plans FORCE ROW LEVEL SECURITY;

-- Lecture : plans actifs pour tous ; tout pour le super-admin.
DROP POLICY IF EXISTS drive_plans_select_active ON public.drive_plans;
CREATE POLICY drive_plans_select_active ON public.drive_plans
  FOR SELECT USING (is_active OR public.is_super_admin());
-- (Aucune policy INSERT/UPDATE/DELETE → refus par défaut pour authenticated/anon.)

-- Verrou 2 : aucun privilège d'écriture au niveau table.
REVOKE ALL ON public.drive_plans FROM authenticated, anon;
GRANT SELECT ON public.drive_plans TO authenticated, anon;

-- Verrou 3 : trigger garde — refuse toute écriture hors rôles de service.
CREATE OR REPLACE FUNCTION public.drive_plans_guard_writes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user NOT IN ('service_role','postgres','supabase_admin') THEN
    RAISE EXCEPTION 'drive_plans : écriture interdite (rôle %). Plans gérés par le super-admin uniquement.', current_user
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS drive_plans_guard_trg ON public.drive_plans;
CREATE TRIGGER drive_plans_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.drive_plans
  FOR EACH ROW EXECUTE FUNCTION public.drive_plans_guard_writes();

-- 3. SEED depuis la configuration actuelle -------------------------------------
INSERT INTO public.drive_plans
  (code, title, subtitle, price_da, billing_period, duration_days, commission_rate, cashback_rate,
   advantages, badge_label, badge_color, display_rank, is_priority, is_default, is_active)
SELECT * FROM (
  SELECT
    'free'::text, 'Gratuit'::text, 'Formule de base'::text, 0,
    'month'::text, 30,
    s.vtc_commission_rate, s.drive_cashback_rate,
    ARRAY['Réception des courses standard']::text[],
    NULL::text, NULL::text, 0, false, true, true
  FROM public.platform_settings s WHERE s.id = true
) v
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.drive_plans
  (code, title, subtitle, price_da, billing_period, duration_days, commission_rate, cashback_rate,
   advantages, badge_label, badge_color, display_rank, is_priority, is_default, is_active)
SELECT
  'priority', 'Prioritaire', 'Passez devant à la distribution des courses',
  COALESCE(s.sub_priority_monthly_da, 300), 'month', 30,
  s.vtc_commission_rate, s.drive_cashback_rate,
  ARRAY['Priorité d''affichage au client','Reçoit les courses avant les non-abonnés']::text[],
  'Prioritaire', '#6C2BD9', 10, true, false, true
FROM public.platform_settings s WHERE s.id = true
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.drive_plans
  (code, title, subtitle, price_da, billing_period, duration_days, commission_rate, cashback_rate,
   advantages, badge_label, badge_color, display_rank, is_priority, is_default, is_active)
SELECT
  'pro', 'Pro', 'Commission réduite', s.drive_plan_pro_fee_da, 'month', 30,
  s.drive_plan_pro_rate, LEAST(s.drive_cashback_rate, s.drive_plan_pro_rate),
  ARRAY['Commission réduite','Priorité d''affichage']::text[],
  'Pro', '#5B2EFF', 20, true, false, COALESCE(s.drive_paid_plans_enabled, false)
FROM public.platform_settings s WHERE s.id = true
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.drive_plans
  (code, title, subtitle, price_da, billing_period, duration_days, commission_rate, cashback_rate,
   advantages, badge_label, badge_color, display_rank, is_priority, is_default, is_active)
SELECT
  'premium', 'Premium', 'Zéro commission', s.drive_plan_premium_fee_da, 'month', 30,
  s.drive_plan_premium_rate, LEAST(s.drive_cashback_rate, s.drive_plan_premium_rate),
  ARRAY['0 % de commission','Priorité maximale d''affichage','Badge Premium']::text[],
  'Premium', '#FF2D7A', 30, true, false, COALESCE(s.drive_paid_plans_enabled, false)
FROM public.platform_settings s WHERE s.id = true
ON CONFLICT (code) DO NOTHING;

-- 4. RÉSOLUTION (lecture) -------------------------------------------------------
-- Plan effectif du chauffeur : abonnement actif → sa ligne drive_plans, sinon le
-- plan par défaut. Signature INCHANGÉE (plan, rate, fee_da, period_end) pour ne
-- pas casser les appelants (resolve_vtc_commission, UI). rate = commission du plan.
CREATE OR REPLACE FUNCTION public.resolve_drive_plan(p_chauffeur_id UUID)
RETURNS TABLE(plan TEXT, rate NUMERIC, fee_da INTEGER, period_end TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_sub public.chauffeur_subscriptions%ROWTYPE; v_p public.drive_plans%ROWTYPE;
BEGIN
  SELECT * INTO v_sub FROM public.chauffeur_subscriptions cs
   WHERE cs.chauffeur_id = p_chauffeur_id AND cs.status = 'active' AND cs.period_end >= now()
   ORDER BY cs.period_end DESC LIMIT 1;
  IF v_sub.id IS NOT NULL THEN
    SELECT * INTO v_p FROM public.drive_plans WHERE code = v_sub.plan;
  END IF;
  IF v_p.code IS NULL THEN
    SELECT * INTO v_p FROM public.drive_plans WHERE is_default ORDER BY display_rank LIMIT 1;
  END IF;
  IF v_p.code IS NULL THEN
    -- Filet ultime si aucun plan par défaut : commission plateforme, 0 sinon.
    plan := 'free';
    SELECT vtc_commission_rate INTO rate FROM public.platform_settings WHERE id = true;
    fee_da := 0; period_end := NULL; RETURN NEXT; RETURN;
  END IF;
  plan := v_p.code; rate := v_p.commission_rate; fee_da := v_p.price_da;
  period_end := CASE WHEN v_sub.id IS NOT NULL AND v_p.code = v_sub.plan THEN v_sub.period_end ELSE NULL END;
  RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_drive_plan(UUID) TO authenticated;

-- Taux de cashback effectif du chauffeur (par plan).
CREATE OR REPLACE FUNCTION public.drive_plan_cashback_rate(p_chauffeur_id UUID)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_sub public.chauffeur_subscriptions%ROWTYPE; v_r NUMERIC;
BEGIN
  SELECT * INTO v_sub FROM public.chauffeur_subscriptions cs
   WHERE cs.chauffeur_id = p_chauffeur_id AND cs.status = 'active' AND cs.period_end >= now()
   ORDER BY cs.period_end DESC LIMIT 1;
  IF v_sub.id IS NOT NULL THEN
    SELECT cashback_rate INTO v_r FROM public.drive_plans WHERE code = v_sub.plan;
  END IF;
  IF v_r IS NULL THEN SELECT cashback_rate INTO v_r FROM public.drive_plans WHERE is_default ORDER BY display_rank LIMIT 1; END IF;
  RETURN COALESCE(v_r, 0);
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_plan_cashback_rate(UUID) TO authenticated;

-- Rang d'affichage effectif du chauffeur (par plan) — pour l'ordre de dispatch.
CREATE OR REPLACE FUNCTION public.drive_plan_rank(p_chauffeur_id UUID)
RETURNS INTEGER LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_sub public.chauffeur_subscriptions%ROWTYPE; v_rk INTEGER;
BEGIN
  SELECT * INTO v_sub FROM public.chauffeur_subscriptions cs
   WHERE cs.chauffeur_id = p_chauffeur_id AND cs.status = 'active' AND cs.period_end >= now()
   ORDER BY cs.period_end DESC LIMIT 1;
  IF v_sub.id IS NOT NULL THEN
    SELECT display_rank INTO v_rk FROM public.drive_plans WHERE code = v_sub.plan;
  END IF;
  IF v_rk IS NULL THEN SELECT display_rank INTO v_rk FROM public.drive_plans WHERE is_default ORDER BY display_rank LIMIT 1; END IF;
  RETURN COALESCE(v_rk, 0);
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_plan_rank(UUID) TO authenticated;

-- 5. DISPATCH — ordre d'affichage piloté par le rang du plan --------------------
-- (Reprend 0256 : PostGIS + favoris + gamme + femme. Seul changement : is_premium
-- et ORDER BY suivent le RANG DU PLAN du chauffeur, plus le littéral 'premium'.)
CREATE OR REPLACE FUNCTION public.chauffeurs_present_near(
  p_lat        DOUBLE PRECISION,
  p_lng        DOUBLE PRECISION,
  p_radius_km  NUMERIC DEFAULT 6,
  p_within_min INTEGER DEFAULT 3,
  p_gamme      TEXT DEFAULT NULL,
  p_female_only BOOLEAN DEFAULT false,
  p_customer_id UUID DEFAULT NULL
)
RETURNS TABLE(
  user_id UUID, chauffeur_id UUID, dist_km NUMERIC,
  is_premium BOOLEAN, is_favorite BOOLEAN, is_female BOOLEAN
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_female_online BOOLEAN := false;
  v_origin extensions.geography;
  v_radius_m DOUBLE PRECISION := GREATEST(0.5, LEAST(COALESCE(p_radius_km, 6), 30)) * 1000;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN; END IF;
  IF COALESCE(p_female_only, false) THEN
    v_female_online := public.drive_female_online();
  END IF;
  v_origin := extensions.ST_SetSRID(
                extensions.ST_MakePoint(p_lng, p_lat), 4326
              )::extensions.geography;

  RETURN QUERY
  SELECT ch.user_id, ch.id,
    (extensions.ST_Distance(p.geog, v_origin) / 1000.0)::NUMERIC AS dist_km,
    (COALESCE(dp.display_rank, 0) > 0) AS is_premium,
    (p_customer_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.customer_favorite_chauffeurs f
       WHERE f.customer_id = p_customer_id AND f.chauffeur_id = ch.id)) AS is_favorite,
    ch.is_female_verified AS is_female
  FROM public.chauffeur_presence p
  JOIN public.chauffeurs ch ON ch.id = p.chauffeur_id
  CROSS JOIN LATERAL public.resolve_drive_plan(ch.id) rp
  LEFT JOIN public.drive_plans dp ON dp.code = rp.plan
  WHERE p.is_online = true
    AND (p.updated_at > now() - make_interval(mins => GREATEST(1, p_within_min)) OR ch.is_demo)
    AND ch.user_id IS NOT NULL
    AND COALESCE(ch.is_verified, false) = true
    AND COALESCE(ch.is_frozen, false) = false
    AND COALESCE(ch.is_blocked, false) = false
    AND (p_gamme IS NULL OR (CASE ch.gamme
          WHEN 'confort' THEN p_gamme IN ('classic','confort')
          WHEN 'classic' THEN p_gamme = 'classic'
          ELSE p_gamme = 'moto' END))
    AND (NOT COALESCE(p_female_only,false) OR ch.is_female_verified OR NOT v_female_online)
    AND extensions.ST_DWithin(p.geog, v_origin, v_radius_m)
  ORDER BY COALESCE(dp.display_rank, 0) DESC, 5 DESC, 3 ASC;
END;
$function$;

-- 6. complete_ride — cashback PAR PLAN (seule ligne changée vs 0163) ------------
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE;
  v_ch UUID; v_ride public.rides%ROWTYPE;
  v_rate NUMERIC(5,4); v_cbrate NUMERIC(5,4); v_F INTEGER; v_boost INTEGER; v_base INTEGER;
  v_c INTEGER; v_cb INTEGER; v_net INTEGER;
  v_E INTEGER; v_cash INTEGER; v_cov INTEGER;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT id INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_ch IS NULL THEN ok:=false; reason:='not_a_chauffeur'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL OR v_ride.chauffeur_id <> v_ch THEN ok:=false; reason:='not_your_ride'; RETURN NEXT; RETURN; END IF;
  IF v_ride.status = 'completed' THEN ok:=true; reason:='already_completed'; RETURN NEXT; RETURN; END IF;
  IF v_ride.status <> 'in_progress' THEN ok:=false; reason:='not_in_progress'; RETURN NEXT; RETURN; END IF;

  v_F     := GREATEST(0, COALESCE(v_ride.agreed_price_da, v_ride.proposed_price_da + v_ride.boost_amount_da, 0));
  v_boost := LEAST(GREATEST(0, v_ride.boost_amount_da), v_F);
  v_base  := v_F - v_boost;
  v_rate  := public.resolve_vtc_commission(v_ch);
  v_cbrate := public.drive_plan_cashback_rate(v_ch);       -- cashback PAR PLAN (0304)
  v_c     := round(v_base * v_rate)::INTEGER;
  v_cb    := LEAST(round(v_F * v_cbrate)::INTEGER, v_c);
  v_net   := v_F - v_c;

  IF v_ride.payment_method = 'card' AND v_ride.escrow_da < v_F THEN
    ok:=false; reason:='escrow_missing'; RETURN NEXT; RETURN;
  END IF;

  v_E    := CASE WHEN v_ride.payment_method = 'cash' THEN 0 ELSE LEAST(GREATEST(v_ride.escrow_da, 0), v_F) END;
  v_cash := v_F - v_E;
  v_cov  := LEAST(v_c, v_E);

  UPDATE public.rides
     SET status='completed', completed_at=now(),
         commission_rate_applied=v_rate, commission_da=v_c,
         chauffeur_net_da=v_net, cashback_da=v_cb, escrow_da=0,
         cash_due_da = v_cash
   WHERE id = p_ride_id;

  INSERT INTO public.ride_ledger (chauffeur_id, ride_id, type, amount_da)
  VALUES (v_ch, p_ride_id, 'chauffeur_payout', v_net)
  ON CONFLICT (ride_id, type) DO NOTHING;
  IF v_cash > 0 THEN
    INSERT INTO public.ride_ledger (chauffeur_id, ride_id, type, amount_da)
    VALUES (v_ch, p_ride_id, 'chauffeur_cash_collected', v_cash)
    ON CONFLICT (ride_id, type) DO NOTHING;
  END IF;
  IF v_c - v_cov > 0 THEN
    INSERT INTO public.ride_ledger (chauffeur_id, ride_id, type, amount_da)
    VALUES (v_ch, p_ride_id, 'chauffeur_owes_platform', v_c - v_cov)
    ON CONFLICT (ride_id, type) DO NOTHING;
  END IF;
  IF v_cov > 0 THEN
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NULL, 'vtc_commission_income', v_cov);
  END IF;
  IF v_cash > 0 AND v_E - v_c > 0 THEN
    INSERT INTO public.ride_ledger (chauffeur_id, ride_id, type, amount_da, note)
    VALUES (v_ch, p_ride_id, 'adjustment', v_E - v_c,
            'Part Coligo Pay à verser au chauffeur (course mixte espèces + séquestre)')
    ON CONFLICT (ride_id, type) DO NOTHING;
  END IF;

  IF v_cb > 0 THEN
    INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
    VALUES (v_ride.customer_id, NULL, 'cashback_earned', 'cashback', v_cb, 'Cashback course Drive');
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NULL, 'cashback_expense', -v_cb);
  END IF;

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (p_ride_id, 'in_progress', 'completed',
    'Course terminée'
    || CASE WHEN v_E > 0 THEN ' · séquestre libéré (' || v_E || ' DA)' ELSE '' END
    || CASE WHEN v_E > 0 AND v_cash > 0 THEN ' + ' || v_cash || ' DA encaissés en espèces' ELSE '' END);
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_ride(UUID) TO authenticated;

-- 7. drive_subscribe — prix + durée LUS DEPUIS LE PLAN (jamais le client) -------
-- Le chauffeur ne transmet qu'un CODE de plan + un mode de paiement. Le prix et
-- la durée (jour/semaine/mois) sont imposés par la table → anti-altération.
-- Gate = plan actif (is_active), non défaut. p_duration_days conservé pour compat
-- mais IGNORÉ (la période appartient au plan).
CREATE OR REPLACE FUNCTION public.drive_subscribe(
  p_plan TEXT,
  p_method TEXT,
  p_duration_days INTEGER DEFAULT 30,
  p_reference TEXT DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN, reason TEXT, subscription_id UUID, payment_id UUID, amount_da INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_ch public.chauffeurs%ROWTYPE; v_p public.drive_plans%ROWTYPE; v_sub UUID; v_pay UUID;
BEGIN
  SELECT * INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_ch.id IS NULL THEN ok:=false; reason:='not_a_chauffeur'; RETURN NEXT; RETURN; END IF;
  IF p_method NOT IN ('ccp','card') THEN ok:=false; reason:='bad_method'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_p FROM public.drive_plans WHERE code = p_plan;
  IF v_p.code IS NULL OR v_p.is_default THEN ok:=false; reason:='bad_plan'; RETURN NEXT; RETURN; END IF;
  IF NOT v_p.is_active THEN ok:=false; reason:='plan_inactive'; RETURN NEXT; RETURN; END IF;
  IF v_p.price_da <= 0 THEN ok:=false; reason:='plan_free'; RETURN NEXT; RETURN; END IF;

  -- Une seule tentative à la fois (idem 0157/0191).
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

  ok:=true; reason:=NULL; subscription_id:=v_sub; payment_id:=v_pay; amount_da:=v_p.price_da; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_subscribe(TEXT, TEXT, INTEGER, TEXT) TO authenticated;
