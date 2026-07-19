-- =============================================================================
-- 0381 — Anti-fraude promos plateforme façon Uber Eats :
--   1. `app_only` : un code peut être réservé à l'APPLICATION installée
--      (Android/iOS) — inutilisable depuis le site web ;
--   2. MÉMOIRE D'APPAREIL : un appareil qui a déjà bénéficié d'un code ne
--      peut pas re-bénéficier via un AUTRE compte (suppression/réinscription,
--      multi-comptes) → « Vous avez déjà bénéficié de cette promotion. »
-- =============================================================================

ALTER TABLE public.platform_promotions
  ADD COLUMN IF NOT EXISTS app_only boolean NOT NULL DEFAULT false;

-- Marque (promotion, appareil) posée à la PREMIÈRE commande qui utilise le
-- code (côté serveur, service_role). PK = un appareil ne compte qu'une fois
-- par promo, quel que soit le compte.
CREATE TABLE IF NOT EXISTS public.platform_promo_device_marks (
  promotion_id uuid NOT NULL REFERENCES public.platform_promotions(id) ON DELETE CASCADE,
  device_id    text NOT NULL,
  customer_id  uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (promotion_id, device_id)
);
ALTER TABLE public.platform_promo_device_marks ENABLE ROW LEVEL SECURITY;

-- validate_platform_promo : nouvelle signature (2 params optionnels). L'ancienne
-- (4 args) est SUPPRIMÉE pour éviter l'ambiguïté d'overload — les appelants
-- passent par PostgREST qui résout sur le nom + les clés fournies.
DROP FUNCTION IF EXISTS public.validate_platform_promo(text, uuid, integer, text);

CREATE OR REPLACE FUNCTION public.validate_platform_promo(
  p_code           text,
  p_customer_id    uuid,
  p_subtotal_da    integer,
  p_payment_method text,
  p_is_app         boolean DEFAULT false,
  p_device_id      text    DEFAULT NULL
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
  v_device_used boolean;
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

  -- Réservé à l'application installée (le serveur passe p_is_app depuis le
  -- cookie natif — jamais depuis une valeur choisie par le client web).
  IF v.app_only AND NOT COALESCE(p_is_app, false) THEN
    reason := 'app_only'; RETURN NEXT; RETURN;
  END IF;

  -- Mémoire d'appareil : déjà utilisé sur CET appareil par un AUTRE compte
  -- (le même compte est régi par per_customer_limit ci-dessous).
  IF p_device_id IS NOT NULL AND btrim(p_device_id) <> '' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.platform_promo_device_marks m
      WHERE m.promotion_id = v.id
        AND m.device_id = p_device_id
        AND (m.customer_id IS NULL OR m.customer_id <> p_customer_id)
    ) INTO v_device_used;
    IF v_device_used THEN
      reason := 'device_used'; RETURN NEXT; RETURN;
    END IF;
  END IF;

  IF v.online_only AND p_payment_method = 'cash' THEN
    reason := 'online_only'; RETURN NEXT; RETURN;
  END IF;

  IF v.min_subtotal_da IS NOT NULL AND COALESCE(p_subtotal_da, 0) < v.min_subtotal_da THEN
    reason := 'min_subtotal'; RETURN NEXT; RETURN;
  END IF;

  IF v.audience = 'targeted' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.platform_promotion_grants g
      WHERE g.promotion_id = v.id AND g.customer_id = p_customer_id
    ) INTO v_has_grant;
    IF NOT v_has_grant THEN reason := 'not_eligible'; RETURN NEXT; RETURN; END IF;
  END IF;

  IF v.max_uses IS NOT NULL AND v.uses_count >= v.max_uses THEN
    reason := 'exhausted'; RETURN NEXT; RETURN;
  END IF;

  IF v.max_uses_per_customer IS NOT NULL THEN
    SELECT count(*) INTO v_used_by_customer
    FROM public.platform_promotion_redemptions r
    WHERE r.promotion_id = v.id AND r.customer_id = p_customer_id;
    IF v_used_by_customer >= v.max_uses_per_customer THEN
      reason := 'per_customer_limit'; RETURN NEXT; RETURN;
    END IF;
  END IF;

  IF v.discount_kind = 'percent' THEN
    v_raw := round(COALESCE(p_subtotal_da, 0) * v.discount_value / 100.0)::integer;
  ELSE
    v_raw := round(v.discount_value)::integer;
  END IF;
  IF v.max_discount_da IS NOT NULL THEN
    v_raw := LEAST(v_raw, v.max_discount_da);
  END IF;
  v_discount := GREATEST(0, LEAST(v_raw, COALESCE(p_subtotal_da, 0)));

  valid := true; discount_da := v_discount; reason := 'ok';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_platform_promo(text, uuid, integer, text, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.validate_platform_promo(text, uuid, integer, text, boolean, text) TO authenticated, service_role;
