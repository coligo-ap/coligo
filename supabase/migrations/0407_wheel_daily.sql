-- =============================================================================
-- 0407 — ROUE COLIGO quotidienne (gamification / rétention)
-- =============================================================================
-- Un tour par client et par jour. Le TIRAGE est SERVEUR (pondéré par poids,
-- jamais côté client) ; un lot « bon d'achat » crée un customer_vouchers
-- (reason loyalty) → le trigger 0293 crédite Coligo Pay + équilibre le
-- platform_ledger (SUM=0) : AUCUNE nouvelle plomberie d'argent.
-- Série (streak) : jours consécutifs joués ; au jour cible (défaut 7), le lot
-- gagné est MULTIPLIÉ (défaut ×2) — la raison d'ouvrir l'app chaque jour.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Kill-switch + réglages + lots
-- ---------------------------------------------------------------------------
INSERT INTO public.feature_flags (key, status, title_fr, title_ar, message_fr, message_ar)
VALUES (
  'wheel', 'hidden',
  'Roue Coligo', 'عجلة كوليقو',
  'La Roue Coligo arrive bientôt.',
  'عجلة كوليقو قادمة قريباً.'
)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.wheel_settings (
  id                SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  streak_target     INTEGER NOT NULL DEFAULT 7 CHECK (streak_target >= 2),
  streak_multiplier INTEGER NOT NULL DEFAULT 2 CHECK (streak_multiplier >= 1),
  updated_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.wheel_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.wheel_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wheel_settings_select ON public.wheel_settings;
CREATE POLICY wheel_settings_select ON public.wheel_settings
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS wheel_settings_admin ON public.wheel_settings;
CREATE POLICY wheel_settings_admin ON public.wheel_settings
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE TABLE IF NOT EXISTS public.wheel_prizes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       TEXT NOT NULL CHECK (kind IN ('voucher', 'nothing')),
  amount_da  INTEGER NOT NULL DEFAULT 0 CHECK (amount_da >= 0),
  weight     INTEGER NOT NULL CHECK (weight > 0),
  label_fr   TEXT NOT NULL,
  label_ar   TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'voucher') = (amount_da > 0))
);

ALTER TABLE public.wheel_prizes ENABLE ROW LEVEL SECURITY;
-- Les clients voient les lots ACTIFS (ce sont les segments de la roue).
DROP POLICY IF EXISTS wheel_prizes_select ON public.wheel_prizes;
CREATE POLICY wheel_prizes_select ON public.wheel_prizes
  FOR SELECT TO authenticated USING (active);
DROP POLICY IF EXISTS wheel_prizes_admin ON public.wheel_prizes;
CREATE POLICY wheel_prizes_admin ON public.wheel_prizes
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- Lots de départ (modifiables dans Marketing → Roue).
INSERT INTO public.wheel_prizes (kind, amount_da, weight, label_fr, label_ar, position)
SELECT * FROM (VALUES
  ('voucher', 50,  30, '50 DA offerts',  '50 دج هدية',  1),
  ('voucher', 100, 14, '100 DA offerts', '100 دج هدية', 2),
  ('voucher', 200, 5,  '200 DA offerts', '200 دج هدية', 3),
  ('voucher', 500, 1,  '500 DA offerts', '500 دج هدية', 4),
  ('nothing', 0,   50, 'Retente demain', 'أعد المحاولة غداً', 5)
) AS seed(kind, amount_da, weight, label_fr, label_ar, position)
WHERE NOT EXISTS (SELECT 1 FROM public.wheel_prizes);

-- ---------------------------------------------------------------------------
-- 2. Tours joués — UN par client et par jour (l'index unique EST la règle).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wheel_spins (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  day         DATE NOT NULL DEFAULT CURRENT_DATE,
  prize_id    UUID REFERENCES public.wheel_prizes(id) ON DELETE SET NULL,
  -- Montant réellement crédité (bonus série inclus) — 0 pour « rien ».
  amount_da   INTEGER NOT NULL DEFAULT 0,
  streak      INTEGER NOT NULL DEFAULT 1,
  voucher_id  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, day)
);

CREATE INDEX IF NOT EXISTS idx_wheel_spins_customer
  ON public.wheel_spins (customer_id, day DESC);

ALTER TABLE public.wheel_spins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wheel_spins_select_own ON public.wheel_spins;
CREATE POLICY wheel_spins_select_own ON public.wheel_spins
  FOR SELECT USING (
    customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );
-- Aucune policy d'écriture : SEULE la RPC wheel_spin (SECURITY DEFINER) écrit.

-- ---------------------------------------------------------------------------
-- 3. RPC my_wheel_state() — tout ce que voit la page /roue.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_wheel_state()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer uuid;
  v_settings public.wheel_settings%ROWTYPE;
  v_today    public.wheel_spins%ROWTYPE;
  v_streak   integer := 0;
  v_d        date;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'not_a_customer' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_settings FROM public.wheel_settings WHERE id = 1;
  SELECT * INTO v_today FROM public.wheel_spins
   WHERE customer_id = v_customer AND day = CURRENT_DATE;

  -- Série : jours consécutifs joués en remontant (aujourd'hui inclus s'il est
  -- joué, sinon depuis hier — la série n'est pas cassée tant que le jour n'est
  -- pas fini).
  v_d := CASE WHEN v_today.id IS NOT NULL THEN CURRENT_DATE
              ELSE CURRENT_DATE - 1 END;
  WHILE EXISTS (SELECT 1 FROM public.wheel_spins
                 WHERE customer_id = v_customer AND day = v_d)
        AND v_streak < 60
  LOOP
    v_streak := v_streak + 1;
    v_d := v_d - 1;
  END LOOP;

  RETURN jsonb_build_object(
    'enabled', (v_settings.enabled AND NOT public.feature_blocked('wheel')),
    'can_spin', (v_settings.enabled AND NOT public.feature_blocked('wheel')
                 AND v_today.id IS NULL),
    'streak', v_streak,
    'streak_target', v_settings.streak_target,
    'streak_multiplier', v_settings.streak_multiplier,
    'today', CASE WHEN v_today.id IS NULL THEN NULL ELSE jsonb_build_object(
      'prize_id', v_today.prize_id,
      'amount_da', v_today.amount_da
    ) END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.my_wheel_state() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_wheel_state() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. RPC wheel_spin() — LE tirage (serveur, pondéré, une fois par jour).
--    Concurrence : on INSÈRE le tour D'ABORD (unique customer+day) ; le bon
--    n'est créé que si l'insert a réellement eu lieu.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wheel_spin()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
            ELSE 'عجلة كوليقو — ' || v_prize.label_ar END,
       'loyalty')
    RETURNING id INTO v_voucher;
    UPDATE public.wheel_spins SET voucher_id = v_voucher WHERE id = v_spin_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'prize_id', v_prize.id,
    'kind', v_prize.kind,
    'amount_da', v_amount,
    'label_fr', v_prize.label_fr,
    'label_ar', v_prize.label_ar,
    'streak', v_streak,
    'bonus', v_bonus
  );
END;
$$;

REVOKE ALL ON FUNCTION public.wheel_spin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wheel_spin() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. KPIs admin (Marketing → Roue).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_wheel_stats()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.admin_can('marketing') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'spins_today',  count(*) FILTER (WHERE day = CURRENT_DATE),
      'spins_7d',     count(*) FILTER (WHERE day > CURRENT_DATE - 7),
      'players_7d',   count(DISTINCT customer_id) FILTER (WHERE day > CURRENT_DATE - 7),
      'cost_7d',      COALESCE(SUM(amount_da) FILTER (WHERE day > CURRENT_DATE - 7), 0),
      'cost_total',   COALESCE(SUM(amount_da), 0),
      'best_streak',  COALESCE(MAX(streak), 0)
    )
    FROM public.wheel_spins
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_wheel_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_wheel_stats() TO authenticated;

-- =============================================================================
-- VÉRIFICATION :
--   SELECT count(*) FROM wheel_prizes;               -- 5 lots seedés
--   SELECT enabled FROM wheel_settings;              -- false
--   SELECT status FROM feature_flags WHERE key='wheel'; -- hidden
-- =============================================================================
