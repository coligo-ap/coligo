-- =============================================================================
-- 0294 — Correctif validate_platform_promo : référence de colonne ambiguë
-- =============================================================================
-- La fonction RETURNS TABLE expose un paramètre OUT `code` ; le `WHERE upper(code)`
-- de la 0292 était ambigu (variable OUT vs colonne table) → erreur 42702. On
-- qualifie la table (alias pp). Aucun changement de logique.
-- =============================================================================

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

REVOKE ALL ON FUNCTION public.validate_platform_promo(text, uuid, integer, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.validate_platform_promo(text, uuid, integer, text) TO authenticated;
