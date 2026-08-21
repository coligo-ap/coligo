-- =============================================================================
-- 0458 — FIDÉLITÉ : recherche de commerçant (console) + pilotage À DISTANCE
--         du programme d'un commerçant par le super-admin
-- =============================================================================
-- Demandes propriétaire (16/08/2026) :
--   • plus de liste déroulante qui rapatrie TOUS les commerçants (règle
--     annuaires = recherche d'abord) : recherche par nom / téléphone / ville
--     / email (auth.users), échantillon des 3 derniers approuvés sans saisie ;
--   • le super-admin peut LIRE et MODIFIER le programme de n'importe quel
--     commerçant pour intervenir rapidement — mêmes bornes que le commerçant
--     (le trigger loyalty_program_bounds reste le juge de paix), trace
--     admin_audit_log avec avant/après.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_loyalty_search_merchants(p_query text)
RETURNS TABLE (
  id uuid,
  name text,
  city text,
  phone text,
  email text,
  approved boolean,
  has_program boolean,
  program_enabled boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q text := btrim(COALESCE(p_query, ''));
BEGIN
  IF NOT public.admin_can('commercants') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.name,
    COALESCE(m.city, m.commune),
    m.phone_public,
    u.email::text,
    (m.approval_status = 'approved'),
    (p.merchant_id IS NOT NULL),
    COALESCE(p.enabled, false)
  FROM public.merchants m
  LEFT JOIN auth.users u ON u.id = m.user_id
  LEFT JOIN public.loyalty_programs p ON p.merchant_id = m.id
  WHERE m.is_active
    AND (
      v_q = ''
      OR m.name ILIKE '%' || v_q || '%'
      OR m.phone_public ILIKE '%' || v_q || '%'
      OR m.city ILIKE '%' || v_q || '%'
      OR m.commune ILIKE '%' || v_q || '%'
      OR u.email ILIKE '%' || v_q || '%'
    )
  ORDER BY (m.approval_status = 'approved') DESC, m.created_at DESC
  LIMIT CASE WHEN v_q = '' THEN 3 ELSE 8 END;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_loyalty_search_merchants(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_search_merchants(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_loyalty_get_merchant_program(p_merchant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text;
  v_program public.loyalty_programs%ROWTYPE;
BEGIN
  IF NOT public.admin_can('commercants') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT m.name INTO v_name FROM public.merchants m WHERE m.id = p_merchant_id;
  IF v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  SELECT * INTO v_program FROM public.loyalty_programs WHERE merchant_id = p_merchant_id;
  RETURN jsonb_build_object(
    'ok', true,
    'merchant_name', v_name,
    'program', CASE WHEN v_program.merchant_id IS NULL THEN NULL ELSE jsonb_build_object(
      'enabled', v_program.enabled,
      'earn_rate_pct', v_program.earn_rate_pct,
      'tier_threshold_da', v_program.tier_threshold_da,
      'tier_reward_da', v_program.tier_reward_da,
      'voucher_validity_days', v_program.voucher_validity_days,
      'daily_credit_cap_da', v_program.daily_credit_cap_da,
      'link_bonus_da', v_program.link_bonus_da
    ) END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_loyalty_get_merchant_program(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_get_merchant_program(uuid) TO authenticated;

-- Écriture À DISTANCE du programme d'un commerçant. Mêmes bornes/codes que
-- merchant_update_loyalty_program ; le trigger DB re-vérifie de toute façon.
CREATE OR REPLACE FUNCTION public.admin_loyalty_update_merchant_program(
  p_merchant_id uuid,
  p_enabled boolean,
  p_earn_rate_pct numeric,
  p_tier_threshold_da integer,
  p_tier_reward_da integer,
  p_voucher_validity_days integer,
  p_daily_credit_cap_da integer,
  p_link_bonus_da integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.loyalty_platform_settings%ROWTYPE;
  v_old jsonb;
BEGIN
  IF NOT public.admin_can('commercants') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.merchants WHERE id = p_merchant_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  SELECT * INTO s FROM public.loyalty_platform_settings WHERE id = 1;

  IF p_earn_rate_pct IS NULL OR p_earn_rate_pct < s.min_earn_rate_pct
     OR p_earn_rate_pct > s.max_earn_rate_pct THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bounds_earn_rate',
      'min', s.min_earn_rate_pct, 'max', s.max_earn_rate_pct);
  END IF;
  IF (p_tier_threshold_da IS NULL) <> (p_tier_reward_da IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bounds_tier_pair');
  END IF;
  IF p_tier_threshold_da IS NOT NULL AND p_tier_threshold_da < s.min_tier_threshold_da THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bounds_tier_threshold',
      'min', s.min_tier_threshold_da);
  END IF;
  IF p_tier_reward_da IS NOT NULL
     AND (p_tier_reward_da <= 0 OR p_tier_reward_da > s.max_tier_reward_da) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bounds_tier_reward',
      'max', s.max_tier_reward_da);
  END IF;
  IF p_voucher_validity_days IS NULL
     OR p_voucher_validity_days < s.min_voucher_validity_days
     OR p_voucher_validity_days > s.max_voucher_validity_days THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bounds_validity',
      'min', s.min_voucher_validity_days, 'max', s.max_voucher_validity_days);
  END IF;
  IF p_daily_credit_cap_da IS NULL OR p_daily_credit_cap_da <= 0
     OR p_daily_credit_cap_da > s.max_daily_credit_cap_da THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bounds_daily_cap',
      'max', s.max_daily_credit_cap_da);
  END IF;
  IF p_link_bonus_da IS NULL OR p_link_bonus_da < 0
     OR p_link_bonus_da > s.max_link_bonus_da THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bounds_link_bonus',
      'max', s.max_link_bonus_da);
  END IF;

  SELECT to_jsonb(p) INTO v_old FROM public.loyalty_programs p
   WHERE p.merchant_id = p_merchant_id;

  INSERT INTO public.loyalty_programs
    (merchant_id, enabled, earn_rate_pct, tier_threshold_da, tier_reward_da,
     voucher_validity_days, daily_credit_cap_da, link_bonus_da, updated_by)
  VALUES
    (p_merchant_id, COALESCE(p_enabled, false), p_earn_rate_pct,
     p_tier_threshold_da, p_tier_reward_da, p_voucher_validity_days,
     p_daily_credit_cap_da, p_link_bonus_da, auth.uid())
  ON CONFLICT (merchant_id) DO UPDATE SET
    enabled               = EXCLUDED.enabled,
    earn_rate_pct         = EXCLUDED.earn_rate_pct,
    tier_threshold_da     = EXCLUDED.tier_threshold_da,
    tier_reward_da        = EXCLUDED.tier_reward_da,
    voucher_validity_days = EXCLUDED.voucher_validity_days,
    daily_credit_cap_da   = EXCLUDED.daily_credit_cap_da,
    link_bonus_da         = EXCLUDED.link_bonus_da,
    updated_by            = EXCLUDED.updated_by,
    updated_at            = now();

  INSERT INTO public.admin_audit_log
    (admin_email, action, target_kind, target_id, note, old_value, new_value)
  VALUES (
    COALESCE(NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''), 'inconnu'),
    'loyalty.program_admin_update', 'merchant', p_merchant_id,
    'Programme fidélité modifié à distance par l''équipe Coligo', v_old,
    (SELECT to_jsonb(p) FROM public.loyalty_programs p
      WHERE p.merchant_id = p_merchant_id)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_loyalty_update_merchant_program(uuid, boolean, numeric, integer, integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_update_merchant_program(uuid, boolean, numeric, integer, integer, integer, integer, integer)
  TO authenticated;
