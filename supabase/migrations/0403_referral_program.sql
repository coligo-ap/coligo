-- =============================================================================
-- 0403 — Parrainage client (« Invite un ami ») → crédit Coligo Pay double
-- =============================================================================
-- Le parrain partage son code (lien /r/CODE, WhatsApp). Le filleul s'inscrit
-- avec le code → attribution `pending`. À la PREMIÈRE commande `completed` du
-- filleul qui atteint le minimum : les DEUX portefeuilles (source 'topup')
-- sont crédités — sauf signal de fraude (même appareil parrain/filleul,
-- plafond mensuel) où l'attribution passe `held` pour revue super-admin.
--
-- ⚠️ ARGENT RÉEL — invariant grand livre SUM=0 (calque du bon d'achat 0293) :
--   +A  customer_wallet_entries (referral_credit, parrain)
--   +B  customer_wallet_entries (referral_credit, filleul)
--   −A −B  platform_ledger (referral_expense)
--
-- Deux triggers SÉPARÉS (décision ≠ argent) :
--   T1 orders→completed        : DÉCIDE  (pending → rewarded | held)
--   T2 referrals→rewarded      : CRÉDITE (idempotent via (referral_id, customer_id))
-- L'approbation admin d'un `held` (held→rewarded) réutilise T2 telle quelle.
--
-- Montants SNAPSHOTÉS à l'attribution : la promesse faite au filleul est
-- honorée même si l'admin change les réglages ensuite.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ENUMS + type d'écriture wallet/ledger
-- ---------------------------------------------------------------------------
-- Compte dans le SOLDE topup (source='topup') MAIS hors du plafond de recharge
-- glissant (qui filtre 'topup_credit') → la récompense ne rogne pas le droit
-- de recharge du client (même choix que voucher_credit, 0293).
ALTER TYPE public.customer_wallet_entry_type ADD VALUE IF NOT EXISTS 'referral_credit';
ALTER TYPE public.platform_ledger_type       ADD VALUE IF NOT EXISTS 'referral_expense';

DO $$ BEGIN
  CREATE TYPE public.referral_status AS ENUM
    ('pending', 'held', 'rewarded', 'rejected', 'revoked', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2. Idempotence du crédit : 2 écritures par parrainage (parrain + filleul)
--    → unicité sur (referral_id, customer_id). NULLs multiples autorisés
--    (toutes les autres écritures wallet).
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_wallet_entries
  ADD COLUMN IF NOT EXISTS referral_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cwe_referral
  ON public.customer_wallet_entries (referral_id, customer_id);

-- ---------------------------------------------------------------------------
-- 3. TABLE: referral_settings — réglages du programme (singleton, admin)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_settings (
  id                      SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled                 BOOLEAN NOT NULL DEFAULT FALSE,
  reward_referrer_da      INTEGER NOT NULL DEFAULT 300 CHECK (reward_referrer_da >= 0),
  reward_referee_da       INTEGER NOT NULL DEFAULT 300 CHECK (reward_referee_da >= 0),
  min_order_da            INTEGER NOT NULL DEFAULT 500 CHECK (min_order_da >= 0),
  max_referrals_month     INTEGER NOT NULL DEFAULT 20 CHECK (max_referrals_month > 0),
  attribution_expiry_days INTEGER NOT NULL DEFAULT 30 CHECK (attribution_expiry_days > 0),
  updated_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.referral_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.referral_settings ENABLE ROW LEVEL SECURITY;

-- Lecture pour les clients connectés (page /parrainage : montants affichés).
DROP POLICY IF EXISTS referral_settings_select ON public.referral_settings;
CREATE POLICY referral_settings_select ON public.referral_settings
  FOR SELECT TO authenticated USING (true);
-- Aucune policy d'écriture → admin via RPC / service_role uniquement.

-- ---------------------------------------------------------------------------
-- 4. TABLE: customer_referral_codes — le code stable de chaque parrain
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_referral_codes (
  customer_id UUID PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
  code        TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_referral_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS referral_codes_select_own ON public.customer_referral_codes;
CREATE POLICY referral_codes_select_own ON public.customer_referral_codes
  FOR SELECT USING (
    customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 5. TABLE: customer_referrals — une attribution parrain → filleul
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_referrals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_customer_id  UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  -- UN filleul ne peut être parrainé qu'UNE fois, à vie.
  referee_customer_id   UUID NOT NULL UNIQUE REFERENCES public.customers(id) ON DELETE CASCADE,
  code                  TEXT NOT NULL,
  status                public.referral_status NOT NULL DEFAULT 'pending',
  qualifying_order_id   UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  -- Snapshots à l'attribution (promesse honorée malgré un changement admin).
  reward_referrer_da    INTEGER NOT NULL CHECK (reward_referrer_da >= 0),
  reward_referee_da     INTEGER NOT NULL CHECK (reward_referee_da >= 0),
  min_order_da_snapshot INTEGER NOT NULL CHECK (min_order_da_snapshot >= 0),
  expires_at            TIMESTAMPTZ NOT NULL,
  credited_at           TIMESTAMPTZ,
  fraud_note            TEXT,
  decided_at            TIMESTAMPTZ,
  decided_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (referrer_customer_id <> referee_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_referrals_referrer
  ON public.customer_referrals (referrer_customer_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_referrals_status
  ON public.customer_referrals (status, created_at DESC);

ALTER TABLE public.customer_referrals ENABLE ROW LEVEL SECURITY;

-- AUCUNE policy client : la lecture passe par my_referral_overview() (masquage
-- serveur des noms + jamais révéler une suspicion de fraude). Admin : service.
DROP POLICY IF EXISTS customer_referrals_admin_all ON public.customer_referrals;
CREATE POLICY customer_referrals_admin_all ON public.customer_referrals
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 6. RPC my_referral_code() — get-or-create du code du client connecté.
--    Alphabet lisible sans ambiguïté (pas de O/I/0/1).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_referral_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer uuid;
  v_code     text;
  v_alphabet CONSTANT text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'not_a_customer' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT code INTO v_code FROM public.customer_referral_codes
   WHERE customer_id = v_customer;
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;

  -- Génération avec reprise sur collision (32^8 ≈ 1.1e12 : quasi jamais).
  LOOP
    v_code := (
      SELECT string_agg(substr(v_alphabet, 1 + floor(random() * 32)::int, 1), '')
      FROM generate_series(1, 8)
    );
    BEGIN
      INSERT INTO public.customer_referral_codes (customer_id, code)
      VALUES (v_customer, v_code);
      RETURN v_code;
    EXCEPTION
      WHEN unique_violation THEN
        -- Code déjà pris (ou course sur le même client) : relire puis retenter.
        SELECT code INTO v_code FROM public.customer_referral_codes
         WHERE customer_id = v_customer;
        IF v_code IS NOT NULL THEN RETURN v_code; END IF;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.my_referral_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_referral_code() TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. RPC referral_code_valid(code) — validation inline à l'inscription (ANON).
--    Ne renvoie que le strict nécessaire (prénom masqué du parrain).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.referral_code_valid(p_code text)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text;
  v_settings public.referral_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_settings FROM public.referral_settings WHERE id = 1;
  IF v_settings.enabled IS DISTINCT FROM TRUE
     OR public.feature_blocked('referral') THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  SELECT c.full_name INTO v_name
  FROM public.customer_referral_codes rc
  JOIN public.customers c ON c.id = rc.customer_id
  WHERE rc.code = upper(btrim(p_code));
  IF v_name IS NULL THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    -- « Ahmed B. » : prénom + initiale, jamais le nom complet.
    'referrer_name',
      split_part(btrim(v_name), ' ', 1)
        || CASE WHEN split_part(btrim(v_name), ' ', 2) <> ''
                THEN ' ' || left(split_part(btrim(v_name), ' ', 2), 1) || '.'
                ELSE '' END,
    'reward_referee_da', v_settings.reward_referee_da,
    'min_order_da', v_settings.min_order_da
  );
END;
$$;

REVOKE ALL ON FUNCTION public.referral_code_valid(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_code_valid(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. RPC attach_referral(referee, code) — SERVICE UNIQUEMENT (appelée par
--    customerSignup côté serveur, best-effort). Crée l'attribution `pending`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attach_referral(
  p_referee_customer_id uuid,
  p_code                text
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settings public.referral_settings%ROWTYPE;
  v_referrer uuid;
  v_month_count integer;
BEGIN
  SELECT * INTO v_settings FROM public.referral_settings WHERE id = 1;
  IF v_settings.enabled IS DISTINCT FROM TRUE
     OR public.feature_blocked('referral') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;

  SELECT customer_id INTO v_referrer FROM public.customer_referral_codes
   WHERE code = upper(btrim(p_code));
  IF v_referrer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_code');
  END IF;
  IF v_referrer = p_referee_customer_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'self_referral');
  END IF;

  -- Réservé aux NOUVEAUX clients (aucune commande honorée).
  IF EXISTS (SELECT 1 FROM public.orders
              WHERE customer_id = p_referee_customer_id AND status = 'completed') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_new_customer');
  END IF;

  -- Plafond mensuel d'ATTRIBUTIONS du parrain (le plafond de récompenses est
  -- re-vérifié à la qualification).
  SELECT count(*) INTO v_month_count FROM public.customer_referrals
   WHERE referrer_customer_id = v_referrer
     AND created_at >= date_trunc('month', now());
  IF v_month_count >= v_settings.max_referrals_month THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'referrer_capped');
  END IF;

  INSERT INTO public.customer_referrals
    (referrer_customer_id, referee_customer_id, code,
     reward_referrer_da, reward_referee_da, min_order_da_snapshot, expires_at)
  VALUES
    (v_referrer, p_referee_customer_id, upper(btrim(p_code)),
     v_settings.reward_referrer_da, v_settings.reward_referee_da,
     v_settings.min_order_da,
     now() + make_interval(days => v_settings.attribution_expiry_days))
  ON CONFLICT (referee_customer_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_referred');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.attach_referral(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_referral(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 9. RPC my_referral_overview() — tout ce que voit la page /parrainage.
--    `held` est présenté comme « en attente » (jamais révéler une suspicion).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_referral_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer uuid;
  v_settings public.referral_settings%ROWTYPE;
  v_code     text;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'not_a_customer' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_settings FROM public.referral_settings WHERE id = 1;
  v_code := public.my_referral_code();

  RETURN jsonb_build_object(
    'code', v_code,
    'enabled', (v_settings.enabled AND NOT public.feature_blocked('referral')),
    'reward_referrer_da', v_settings.reward_referrer_da,
    'reward_referee_da',  v_settings.reward_referee_da,
    'min_order_da',       v_settings.min_order_da,
    'stats', (
      SELECT jsonb_build_object(
        'invited',   count(*),
        'rewarded',  count(*) FILTER (WHERE status = 'rewarded'),
        'waiting',   count(*) FILTER (WHERE status IN ('pending', 'held')),
        'earned_da', COALESCE(SUM(reward_referrer_da)
                       FILTER (WHERE status = 'rewarded'), 0)
      )
      FROM public.customer_referrals
      WHERE referrer_customer_id = v_customer
    ),
    'referees', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name',
          split_part(btrim(COALESCE(c.full_name, '')), ' ', 1)
            || CASE WHEN split_part(btrim(COALESCE(c.full_name, '')), ' ', 2) <> ''
                    THEN ' ' || left(split_part(btrim(COALESCE(c.full_name, '')), ' ', 2), 1) || '.'
                    ELSE '' END,
        -- Statut PUBLIC : pending|held → waiting ; rewarded → rewarded ;
        -- rejected|revoked|expired → expired.
        'status', CASE
          WHEN r.status IN ('pending', 'held') THEN 'waiting'
          WHEN r.status = 'rewarded' THEN 'rewarded'
          ELSE 'expired' END,
        'amount_da', r.reward_referrer_da,
        'created_at', r.created_at
      ) ORDER BY r.created_at DESC)
      FROM public.customer_referrals r
      JOIN public.customers c ON c.id = r.referee_customer_id
      WHERE r.referrer_customer_id = v_customer
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.my_referral_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_referral_overview() TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. T1 — qualification à la commande `completed` (DÉCISION uniquement).
--     Trigger SÉPARÉ du cashback (0118) : mêmes gardes d'entrée, zéro argent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.qualify_referral_on_order_completed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ref       public.customer_referrals%ROWTYPE;
  v_settings  public.referral_settings%ROWTYPE;
  v_referrer_uid uuid;
  v_referee_uid  uuid;
  v_shared_device boolean := false;
  v_month_rewarded integer;
  v_note text := NULL;
BEGIN
  IF NOT (NEW.status = 'completed'
          AND OLD.status IS DISTINCT FROM 'completed'
          AND NEW.customer_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  -- Attribution en attente du filleul (verrouillée contre une double course).
  SELECT * INTO v_ref FROM public.customer_referrals
   WHERE referee_customer_id = NEW.customer_id AND status = 'pending'
   FOR UPDATE SKIP LOCKED;
  IF v_ref.id IS NULL THEN RETURN NEW; END IF;

  IF now() > v_ref.expires_at THEN
    UPDATE public.customer_referrals
       SET status = 'expired', decided_at = now()
     WHERE id = v_ref.id AND status = 'pending';
    RETURN NEW;
  END IF;

  -- Programme coupé (réglage OU kill-switch) : on n'attribue plus, l'attribution
  -- reste `pending` jusqu'à expiration (réactivable sans perte).
  SELECT * INTO v_settings FROM public.referral_settings WHERE id = 1;
  IF v_settings.enabled IS DISTINCT FROM TRUE
     OR public.feature_blocked('referral') THEN
    RETURN NEW;
  END IF;

  -- Minimum de commande (snapshot) : une commande trop petite ne consomme pas
  -- l'attribution — une commande suivante pourra qualifier.
  IF COALESCE(NEW.total_da, 0) < v_ref.min_order_da_snapshot THEN
    RETURN NEW;
  END IF;

  -- --- Signaux de fraude -----------------------------------------------------
  SELECT user_id INTO v_referrer_uid FROM public.customers WHERE id = v_ref.referrer_customer_id;
  SELECT user_id INTO v_referee_uid  FROM public.customers WHERE id = v_ref.referee_customer_id;

  -- Même APPAREIL (ip + user-agent identiques) entre parrain et filleul.
  -- (IP seule = même foyer/wifi : légitime en famille, on ne bloque pas.)
  SELECT EXISTS (
    SELECT 1
    FROM public.user_device_log a
    JOIN public.user_device_log b ON b.ip = a.ip AND b.ua = a.ua
    WHERE a.user_id = v_referrer_uid AND b.user_id = v_referee_uid
  ) INTO v_shared_device;
  IF v_shared_device THEN
    v_note := 'auto: même appareil (IP+UA) parrain/filleul';
  END IF;

  -- Plafond mensuel de RÉCOMPENSES du parrain.
  SELECT count(*) INTO v_month_rewarded FROM public.customer_referrals
   WHERE referrer_customer_id = v_ref.referrer_customer_id
     AND status = 'rewarded'
     AND decided_at >= date_trunc('month', now());
  IF v_month_rewarded >= v_settings.max_referrals_month THEN
    v_note := COALESCE(v_note || ' · ', 'auto: ') || 'plafond mensuel parrain atteint';
  END IF;

  IF v_note IS NOT NULL THEN
    UPDATE public.customer_referrals
       SET status = 'held', qualifying_order_id = NEW.id, fraud_note = v_note
     WHERE id = v_ref.id AND status = 'pending';
  ELSE
    -- rewarded → T2 crédite les deux portefeuilles.
    UPDATE public.customer_referrals
       SET status = 'rewarded', qualifying_order_id = NEW.id, decided_at = now()
     WHERE id = v_ref.id AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_qualify_referral ON public.orders;
CREATE TRIGGER trigger_qualify_referral
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.qualify_referral_on_order_completed();

-- ---------------------------------------------------------------------------
-- 11. T2 — crédit des deux portefeuilles au passage `rewarded` (ARGENT).
--     Idempotent : ON CONFLICT (referral_id, customer_id) + garde credited_at.
--     Le ledger n'est débité QUE si le crédit correspondant a été inséré.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_referral_on_reward()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NEW.credited_at IS NOT NULL THEN RETURN NEW; END IF;

  IF NEW.reward_referrer_da > 0 THEN
    INSERT INTO public.customer_wallet_entries
      (customer_id, order_id, type, source, amount_da, note, referral_id)
    VALUES
      (NEW.referrer_customer_id, NULL, 'referral_credit', 'topup',
       NEW.reward_referrer_da, 'Récompense parrainage — merci !', NEW.id)
    ON CONFLICT (referral_id, customer_id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      INSERT INTO public.platform_ledger (order_id, type, amount_da)
      VALUES (NULL, 'referral_expense', -NEW.reward_referrer_da);
    END IF;
  END IF;

  IF NEW.reward_referee_da > 0 THEN
    INSERT INTO public.customer_wallet_entries
      (customer_id, order_id, type, source, amount_da, note, referral_id)
    VALUES
      (NEW.referee_customer_id, NULL, 'referral_credit', 'topup',
       NEW.reward_referee_da, 'Cadeau de bienvenue parrainage', NEW.id)
    ON CONFLICT (referral_id, customer_id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      INSERT INTO public.platform_ledger (order_id, type, amount_da)
      VALUES (NULL, 'referral_expense', -NEW.reward_referee_da);
    END IF;
  END IF;

  -- Marque le crédit SANS re-déclencher T2 (status inchangé → WHEN false).
  UPDATE public.customer_referrals SET credited_at = now() WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_credit_referral ON public.customer_referrals;
CREATE TRIGGER trigger_credit_referral
  AFTER UPDATE OF status ON public.customer_referrals
  FOR EACH ROW
  WHEN (NEW.status = 'rewarded' AND OLD.status IN ('pending', 'held'))
  EXECUTE FUNCTION public.credit_referral_on_reward();

-- ---------------------------------------------------------------------------
-- 12. RPC admin — décider un `held`, révoquer un `rewarded`, statistiques.
--     Garde : admin_can('marketing') (RBAC par domaine, 0301).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_referral_decide(
  p_id     uuid,
  p_action text,            -- 'approve' | 'reject'
  p_note   text DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v public.customer_referrals%ROWTYPE;
BEGIN
  IF NOT public.admin_can('marketing') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_action');
  END IF;

  SELECT * INTO v FROM public.customer_referrals WHERE id = p_id FOR UPDATE;
  IF v.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF v.status <> 'held' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_held');
  END IF;

  UPDATE public.customer_referrals
     SET status     = CASE WHEN p_action = 'approve' THEN 'rewarded' ELSE 'rejected' END::public.referral_status,
         decided_at = now(),
         decided_by = auth.uid(),
         fraud_note = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), fraud_note)
   WHERE id = v.id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_referral_decide(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_referral_decide(uuid, text, text) TO authenticated;

-- Révocation d'un parrainage DÉJÀ crédité : contre-passation (append-only),
-- refusée si l'un des deux soldes ne couvre plus la reprise.
CREATE OR REPLACE FUNCTION public.admin_revoke_referral(
  p_id   uuid,
  p_note text DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v public.customer_referrals%ROWTYPE;
BEGIN
  IF NOT public.admin_can('marketing') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v FROM public.customer_referrals WHERE id = p_id FOR UPDATE;
  IF v.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF v.status <> 'rewarded' OR v.credited_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_rewarded');
  END IF;

  IF v.reward_referrer_da > 0
     AND public.customer_topup_balance(v.referrer_customer_id) < v.reward_referrer_da THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'referrer_spent');
  END IF;
  IF v.reward_referee_da > 0
     AND public.customer_topup_balance(v.referee_customer_id) < v.reward_referee_da THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'referee_spent');
  END IF;

  UPDATE public.customer_referrals
     SET status = 'revoked', decided_at = now(), decided_by = auth.uid(),
         fraud_note = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), fraud_note)
   WHERE id = v.id;

  IF v.reward_referrer_da > 0 THEN
    INSERT INTO public.customer_wallet_entries
      (customer_id, order_id, type, source, amount_da, note)
    VALUES (v.referrer_customer_id, NULL, 'adjustment', 'topup',
            -v.reward_referrer_da, 'Annulation récompense parrainage (revue Coligo).');
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NULL, 'referral_expense', v.reward_referrer_da);
  END IF;
  IF v.reward_referee_da > 0 THEN
    INSERT INTO public.customer_wallet_entries
      (customer_id, order_id, type, source, amount_da, note)
    VALUES (v.referee_customer_id, NULL, 'adjustment', 'topup',
            -v.reward_referee_da, 'Annulation récompense parrainage (revue Coligo).');
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NULL, 'referral_expense', v.reward_referee_da);
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revoke_referral(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_referral(uuid, text) TO authenticated;

-- KPIs de la page admin (période optionnelle).
CREATE OR REPLACE FUNCTION public.admin_referral_stats(
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
)
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
      'total',     count(*),
      'pending',   count(*) FILTER (WHERE status = 'pending'),
      'held',      count(*) FILTER (WHERE status = 'held'),
      'rewarded',  count(*) FILTER (WHERE status = 'rewarded'),
      'rejected',  count(*) FILTER (WHERE status = 'rejected'),
      'revoked',   count(*) FILTER (WHERE status = 'revoked'),
      'expired',   count(*) FILTER (WHERE status = 'expired'),
      'cost_da',   COALESCE(SUM(reward_referrer_da + reward_referee_da)
                     FILTER (WHERE status = 'rewarded'), 0),
      'codes_total', (SELECT count(*) FROM public.customer_referral_codes)
    )
    FROM public.customer_referrals
    WHERE (p_from IS NULL OR created_at >= p_from)
      AND (p_to   IS NULL OR created_at <  p_to)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_referral_stats(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_referral_stats(timestamptz, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- 13. Kill-switch client : flag `referral` (créé caché, activé au lancement
--     depuis /admin/controle).
-- ---------------------------------------------------------------------------
INSERT INTO public.feature_flags (key, status, title_fr, title_ar, message_fr, message_ar)
VALUES (
  'referral', 'hidden',
  'Parrainage', 'برنامج الإحالة',
  'Le programme de parrainage arrive bientôt.',
  'برنامج الإحالة قادم قريباً.'
)
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- VÉRIFICATION :
--   SELECT enabled, reward_referrer_da FROM referral_settings;
--   SELECT public.referral_code_valid('XXXXXXXX');            -- anon OK
--   SELECT status FROM feature_flags WHERE key = 'referral';  -- hidden
-- =============================================================================
