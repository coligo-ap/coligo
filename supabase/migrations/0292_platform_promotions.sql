-- =============================================================================
-- 0292 — Codes promo PLATEFORME (financés par Coligo, valables cross-commerçant)
-- =============================================================================
-- Domaine SÉPARÉ du système commerçant (`promotions`, mig 0008/0076/0077) → zéro
-- régression. Ici la PLATEFORME finance la remise : le commerçant garde son net
-- entier, la plateforme absorbe via `platform_ledger` (dépense `promo_expense`).
--
-- v1 : EN LIGNE UNIQUEMENT (`online_only`) — l'argent transite par la plateforme
-- (Chargily / Coligo Pay), donc aucune dette d'espèces envers le commerçant.
--
-- Distribution :
--   - 'public'   : saisie libre du code (affiché dans le compte si `is_listed`).
--   - 'targeted' : éligible uniquement aux clients ayant un GRANT (attribution).
--   - 'all'      : éligible à TOUS (apparaît dans le compte de tous, sans grant).
--
-- Discipline (mémoire) : REVOKE ALL puis GRANT EXECUTE TO authenticated sur
-- chaque RPC (la garde est INTERNE : auth.uid()/is_super_admin), sinon la RPC est
-- inappelable par la session (mig 0272).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Nouveaux postes de compta plateforme (dépenses marketing).
--    ADD VALUE seul (jamais utilisé en DML dans CETTE migration → sûr en PG15+).
-- ---------------------------------------------------------------------------
ALTER TYPE public.platform_ledger_type ADD VALUE IF NOT EXISTS 'promo_expense';
ALTER TYPE public.platform_ledger_type ADD VALUE IF NOT EXISTS 'voucher_expense';

-- ---------------------------------------------------------------------------
-- 1. ENUMS dédiés
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.platform_promo_audience AS ENUM ('public', 'targeted', 'all');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2. TABLE: platform_promotions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_promotions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Code normalisé en MAJUSCULES applicatif (unicité insensible à la casse via
  -- l'index sur upper(code)).
  code                   TEXT NOT NULL,
  title_fr               TEXT NOT NULL,
  title_ar               TEXT,
  description_fr         TEXT,
  description_ar         TEXT,

  discount_kind          public.discount_kind NOT NULL,
  discount_value         NUMERIC(10, 2) NOT NULL CHECK (discount_value >= 0),
  -- Plafond de remise en DA (utile pour un pourcentage). NULL = pas de plafond.
  max_discount_da        INTEGER CHECK (max_discount_da IS NULL OR max_discount_da > 0),
  -- Sous-total minimum requis (DA) pour appliquer le code.
  min_subtotal_da        INTEGER CHECK (min_subtotal_da IS NULL OR min_subtotal_da >= 0),

  starts_at              TIMESTAMPTZ,
  ends_at                TIMESTAMPTZ,
  max_uses               INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  max_uses_per_customer  INTEGER CHECK (max_uses_per_customer IS NULL OR max_uses_per_customer > 0),
  uses_count             INTEGER NOT NULL DEFAULT 0 CHECK (uses_count >= 0),

  online_only            BOOLEAN NOT NULL DEFAULT true,
  audience               public.platform_promo_audience NOT NULL DEFAULT 'public',
  -- Code 'public' affiché tel quel dans la page compte (sinon, code « secret »).
  is_listed              BOOLEAN NOT NULL DEFAULT true,
  active                 BOOLEAN NOT NULL DEFAULT true,

  created_by             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT platform_promo_dates_chk
    CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);

-- Unicité du code (insensible à la casse).
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_promotions_code
  ON public.platform_promotions (upper(code));

CREATE INDEX IF NOT EXISTS idx_platform_promotions_active
  ON public.platform_promotions (active, audience);

-- ---------------------------------------------------------------------------
-- 3. TABLE: platform_promotion_grants — attribution ciblée / claim d'un public
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_promotion_grants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id  UUID NOT NULL REFERENCES public.platform_promotions(id) ON DELETE CASCADE,
  customer_id   UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_promo_grant_unique UNIQUE (promotion_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_promo_grants_customer
  ON public.platform_promotion_grants (customer_id);

-- ---------------------------------------------------------------------------
-- 4. TABLE: platform_promotion_redemptions — journal d'usage (traçabilité)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_promotion_redemptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id  UUID NOT NULL REFERENCES public.platform_promotions(id) ON DELETE CASCADE,
  order_id      UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  customer_id   UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  discount_da   INTEGER NOT NULL DEFAULT 0 CHECK (discount_da >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_promo_redemption_unique UNIQUE (order_id, promotion_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_promo_redemptions_promo
  ON public.platform_promotion_redemptions (promotion_id);
CREATE INDEX IF NOT EXISTS idx_platform_promo_redemptions_customer
  ON public.platform_promotion_redemptions (promotion_id, customer_id);

-- ---------------------------------------------------------------------------
-- 5. SNAPSHOT sur la commande (audit immuable). La remise plateforme réduit le
--    `total_da` payé par le client mais PAS le `net_total_da` (base commission /
--    ce que touche le commerçant).
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS platform_promo_id    UUID REFERENCES public.platform_promotions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS platform_promo_code  TEXT,
  ADD COLUMN IF NOT EXISTS platform_discount_da INTEGER NOT NULL DEFAULT 0
    CHECK (platform_discount_da >= 0);

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_promotions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_promotion_grants      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_promotion_redemptions ENABLE ROW LEVEL SECURITY;

-- Super-admin : accès total (la gestion passe par service_role/admin client, mais
-- on garde une policy explicite pour les lectures via session admin authentifiée).
DROP POLICY IF EXISTS "platform_promotions_admin_all" ON public.platform_promotions;
CREATE POLICY "platform_promotions_admin_all" ON public.platform_promotions
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- Le client n'accède PAS directement à la table des codes (passe par les RPC).
-- Il LIT en revanche SES grants et SES redemptions (affichage compte + contrôle).
DROP POLICY IF EXISTS "platform_promo_grants_select_own" ON public.platform_promotion_grants;
CREATE POLICY "platform_promo_grants_select_own" ON public.platform_promotion_grants
  FOR SELECT USING (
    customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "platform_promo_grants_admin_all" ON public.platform_promotion_grants;
CREATE POLICY "platform_promo_grants_admin_all" ON public.platform_promotion_grants
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "platform_promo_redemptions_select_own" ON public.platform_promotion_redemptions;
CREATE POLICY "platform_promo_redemptions_select_own" ON public.platform_promotion_redemptions
  FOR SELECT USING (
    customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "platform_promo_redemptions_admin" ON public.platform_promotion_redemptions;
CREATE POLICY "platform_promo_redemptions_admin" ON public.platform_promotion_redemptions
  FOR SELECT USING (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 7. Helper interne : statut effectif (actif + fenêtre de dates).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._platform_promo_is_live(
  p public.platform_promotions, p_now timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p.active
     AND (p.starts_at IS NULL OR p.starts_at <= p_now)
     AND (p.ends_at   IS NULL OR p.ends_at   >= p_now);
$$;

-- ---------------------------------------------------------------------------
-- 8. RPC validate_platform_promo — VÉRIFIE + calcule la remise (sans appliquer).
--    Renvoie une ligne (valid, promotion_id, code, discount_da, reason).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_platform_promo(
  p_code           text,
  p_customer_id    uuid,
  p_subtotal_da    integer,
  p_payment_method text
)
RETURNS TABLE (valid boolean, promotion_id uuid, code text, discount_da integer, reason text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v   public.platform_promotions%ROWTYPE;
  v_used_by_customer integer;
  v_has_grant boolean;
  v_raw integer;
  v_discount integer;
BEGIN
  reason := 'invalid'; valid := false; discount_da := 0;

  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RETURN NEXT; RETURN;
  END IF;

  SELECT pp.* INTO v FROM public.platform_promotions pp
  WHERE upper(pp.code) = upper(btrim(p_code))
  LIMIT 1;

  IF NOT FOUND THEN RETURN NEXT; RETURN; END IF;
  promotion_id := v.id; code := v.code;

  IF NOT public._platform_promo_is_live(v) THEN
    reason := 'inactive'; RETURN NEXT; RETURN;
  END IF;

  -- v1 : en ligne uniquement.
  IF v.online_only AND p_payment_method = 'cash' THEN
    reason := 'online_only'; RETURN NEXT; RETURN;
  END IF;

  IF v.min_subtotal_da IS NOT NULL AND COALESCE(p_subtotal_da, 0) < v.min_subtotal_da THEN
    reason := 'min_subtotal'; RETURN NEXT; RETURN;
  END IF;

  -- Éligibilité : 'targeted' exige un grant ; 'public'/'all' ouverts à tous.
  IF v.audience = 'targeted' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.platform_promotion_grants g
      WHERE g.promotion_id = v.id AND g.customer_id = p_customer_id
    ) INTO v_has_grant;
    IF NOT v_has_grant THEN reason := 'not_eligible'; RETURN NEXT; RETURN; END IF;
  END IF;

  -- Plafond global.
  IF v.max_uses IS NOT NULL AND v.uses_count >= v.max_uses THEN
    reason := 'exhausted'; RETURN NEXT; RETURN;
  END IF;

  -- Plafond par client.
  IF v.max_uses_per_customer IS NOT NULL THEN
    SELECT count(*) INTO v_used_by_customer
    FROM public.platform_promotion_redemptions r
    WHERE r.promotion_id = v.id AND r.customer_id = p_customer_id;
    IF v_used_by_customer >= v.max_uses_per_customer THEN
      reason := 'per_customer_limit'; RETURN NEXT; RETURN;
    END IF;
  END IF;

  -- Calcul de la remise.
  IF v.discount_kind = 'percent' THEN
    v_raw := round(COALESCE(p_subtotal_da, 0) * v.discount_value / 100.0)::integer;
  ELSE
    v_raw := round(v.discount_value)::integer;
  END IF;
  IF v.max_discount_da IS NOT NULL THEN
    v_raw := LEAST(v_raw, v.max_discount_da);
  END IF;
  -- Jamais plus que le sous-total, jamais négatif.
  v_discount := GREATEST(0, LEAST(v_raw, COALESCE(p_subtotal_da, 0)));

  valid := true; discount_da := v_discount; reason := 'ok';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_platform_promo(text, uuid, integer, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.validate_platform_promo(text, uuid, integer, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. RPC claim_platform_promo — le client « ajoute » un code public à son compte.
--    Crée un grant (pour qu'il apparaisse dans sa liste). Idempotent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_platform_promo(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer uuid;
  v public.platform_promotions%ROWTYPE;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid() LIMIT 1;
  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_customer');
  END IF;

  SELECT * INTO v FROM public.platform_promotions
  WHERE upper(code) = upper(btrim(p_code)) LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  IF NOT public._platform_promo_is_live(v) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive');
  END IF;
  -- On n'enregistre que les codes saisissables (public). Les 'targeted'/'all'
  -- apparaissent déjà tout seuls dans le compte.
  IF v.audience <> 'public' THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already', 'promotion_id', v.id);
  END IF;

  INSERT INTO public.platform_promotion_grants (promotion_id, customer_id)
  VALUES (v.id, v_customer)
  ON CONFLICT (promotion_id, customer_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'reason', 'claimed', 'promotion_id', v.id);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_platform_promo(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_platform_promo(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. RPC get_my_platform_codes — codes DISPONIBLES pour le client connecté
--     (audience 'all' + 'public' listés + ceux où il a un grant), avec son usage.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_platform_codes()
RETURNS TABLE (
  id uuid, code text, title_fr text, title_ar text,
  description_fr text, description_ar text,
  discount_kind public.discount_kind, discount_value numeric,
  max_discount_da integer, min_subtotal_da integer,
  ends_at timestamptz, online_only boolean,
  max_uses_per_customer integer, used_by_me integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer uuid;
BEGIN
  SELECT c.id INTO v_customer FROM public.customers c WHERE c.user_id = auth.uid() LIMIT 1;
  IF v_customer IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT p.id, p.code, p.title_fr, p.title_ar,
         p.description_fr, p.description_ar,
         p.discount_kind, p.discount_value,
         p.max_discount_da, p.min_subtotal_da,
         p.ends_at, p.online_only,
         p.max_uses_per_customer,
         (SELECT count(*)::integer FROM public.platform_promotion_redemptions r
            WHERE r.promotion_id = p.id AND r.customer_id = v_customer) AS used_by_me
  FROM public.platform_promotions p
  WHERE public._platform_promo_is_live(p)
    AND (
      p.audience = 'all'
      OR (p.audience = 'public' AND p.is_listed)
      OR EXISTS (
        SELECT 1 FROM public.platform_promotion_grants g
        WHERE g.promotion_id = p.id AND g.customer_id = v_customer
      )
    )
  ORDER BY p.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_platform_codes() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_platform_codes() TO authenticated;

-- ---------------------------------------------------------------------------
-- 11. TRIGGER: applique le code plateforme QUAND la commande est PAYÉE.
--     La remise est financée par la plateforme → l'écriture compta n'a lieu que
--     lorsque l'argent est réel (payment_status -> 'paid'), JAMAIS à la création
--     (sinon une commande online abandonnée laisserait une dépense fantôme).
--     Idempotent (UNIQUE order_id+promotion_id, UNIQUE order_id+type ledger).
--     Bypass-proof : posé en base, indépendant du chemin (webhook / wallet=0).
--
--     ⚠️ La remise plateforme réduit `total_da` (payé par le client) mais PAS
--     `net_total_da` (base commission / dû au commerçant) → le commerçant garde
--     son net entier, la plateforme absorbe via `promo_expense`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_platform_promo_on_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted integer := 0;
  v_disc integer := GREATEST(0, COALESCE(NEW.platform_discount_da, 0));
BEGIN
  IF NEW.payment_status = 'paid'
     AND OLD.payment_status IS DISTINCT FROM 'paid'
     AND NEW.platform_promo_id IS NOT NULL
     AND NEW.customer_id IS NOT NULL THEN

    INSERT INTO public.platform_promotion_redemptions
      (promotion_id, order_id, customer_id, code, discount_da)
    VALUES (NEW.platform_promo_id, NEW.id, NEW.customer_id,
            COALESCE(NEW.platform_promo_code, ''), v_disc)
    ON CONFLICT (order_id, promotion_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    IF v_inserted > 0 THEN
      UPDATE public.platform_promotions
      SET uses_count = COALESCE(uses_count, 0) + 1
      WHERE id = NEW.platform_promo_id;

      IF v_disc > 0 THEN
        INSERT INTO public.platform_ledger (order_id, type, amount_da)
        VALUES (NEW.id, 'promo_expense', -v_disc)
        ON CONFLICT (order_id, type) DO NOTHING;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_apply_platform_promo ON public.orders;
CREATE TRIGGER trigger_apply_platform_promo
  AFTER UPDATE OF payment_status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_platform_promo_on_paid();
