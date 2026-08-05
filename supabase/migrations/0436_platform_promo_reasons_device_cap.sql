-- =============================================================================
-- 0436 — Codes promo PLATEFORME : motifs de refus PRÉCIS + plafond APPAREIL
-- configurable (anti multi-comptes sur un même téléphone).
--
-- Cas vécu (APP20, 05/08) : un code dont starts_at était encore dans le futur
-- répondait « inactive » → le client lisait « Ce code n'est plus actif » alors
-- que le code n'avait simplement PAS ENCORE COMMENCÉ. Les trois états
-- (désactivé / pas commencé / expiré) deviennent des motifs distincts, et
-- not_started renvoie la date de début pour l'afficher au client.
--
-- Anti-fraude appareil (demande produit, façon Uber Eats) :
--   platform_promotions.max_uses_per_device = nombre de COMPTES DIFFÉRENTS
--   pouvant bénéficier du code sur UN MÊME APPAREIL PHYSIQUE (ANDROID_ID —
--   survit à la désinstallation/réinstallation, cf. mig 0381 + 1.0.27).
--   1 (défaut) = comportement historique ; NULL = pas de limite appareil.
--   Les marques passent à UNE LIGNE PAR COMPTE (PK promo+device+customer)
--   pour pouvoir COMPTER les comptes servis sur l'appareil (table vide en
--   prod au moment de la migration — vérifié).
-- =============================================================================

-- 1. Plafond par appareil, configurable par l'admin.
ALTER TABLE public.platform_promotions
  ADD COLUMN IF NOT EXISTS max_uses_per_device integer DEFAULT 1;
UPDATE public.platform_promotions
   SET max_uses_per_device = 1
 WHERE max_uses_per_device IS NULL;

-- 2. Marques appareil : une ligne par (promo, appareil, compte).
ALTER TABLE public.platform_promo_device_marks
  ALTER COLUMN customer_id SET NOT NULL;
ALTER TABLE public.platform_promo_device_marks
  DROP CONSTRAINT platform_promo_device_marks_pkey;
ALTER TABLE public.platform_promo_device_marks
  ADD CONSTRAINT platform_promo_device_marks_pkey
  PRIMARY KEY (promotion_id, device_id, customer_id);

-- 3. Validation : motifs précis + plafond appareil. La colonne OUT `starts_at`
--    change la signature de sortie → DROP puis CREATE (jamais réintroduire
--    l'ancienne signature 4 args : ambiguïté d'overload PostgREST, cf. 0381).
DROP FUNCTION IF EXISTS public.validate_platform_promo(text, uuid, integer, text, boolean, text);

CREATE FUNCTION public.validate_platform_promo(
  p_code text,
  p_customer_id uuid,
  p_subtotal_da integer,
  p_payment_method text,
  p_is_app boolean DEFAULT false,
  p_device_id text DEFAULT NULL::text
)
 RETURNS TABLE(
   valid boolean,
   promotion_id uuid,
   code text,
   discount_da integer,
   reason text,
   starts_at timestamp with time zone
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v   public.platform_promotions%ROWTYPE;
  v_used_by_customer integer;
  v_has_grant boolean;
  v_device_accounts integer;
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

  -- Motifs PRÉCIS (fini le « inactive » fourre-tout, cas vécu APP20).
  IF NOT v.active THEN
    reason := 'inactive'; RETURN NEXT; RETURN;
  END IF;
  IF v.starts_at IS NOT NULL AND v.starts_at > now() THEN
    reason := 'not_started'; starts_at := v.starts_at; RETURN NEXT; RETURN;
  END IF;
  IF v.ends_at IS NOT NULL AND v.ends_at < now() THEN
    reason := 'expired'; RETURN NEXT; RETURN;
  END IF;

  -- Réservé à l'application installée (le serveur passe p_is_app depuis le
  -- cookie natif — jamais depuis une valeur choisie par le client web).
  IF v.app_only AND NOT COALESCE(p_is_app, false) THEN
    reason := 'app_only'; RETURN NEXT; RETURN;
  END IF;

  -- Plafond APPAREIL : nombre de comptes DIFFÉRENTS déjà servis sur cet
  -- appareil (le compte demandeur reste régi par per_customer_limit).
  -- NULL = pas de limite appareil.
  IF p_device_id IS NOT NULL AND btrim(p_device_id) <> ''
     AND v.max_uses_per_device IS NOT NULL THEN
    SELECT count(DISTINCT m.customer_id) INTO v_device_accounts
    FROM public.platform_promo_device_marks m
    WHERE m.promotion_id = v.id
      AND m.device_id = p_device_id
      AND m.customer_id <> p_customer_id;
    IF v_device_accounts >= v.max_uses_per_device THEN
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
$function$;

REVOKE ALL ON FUNCTION public.validate_platform_promo(text, uuid, integer, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_platform_promo(text, uuid, integer, text, boolean, text) TO authenticated, service_role;

-- 4. Claim (« Mes codes & bons ») : mêmes motifs précis, même vérité.
CREATE OR REPLACE FUNCTION public.claim_platform_promo(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF NOT v.active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive');
  END IF;
  IF v.starts_at IS NOT NULL AND v.starts_at > now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_started',
                              'starts_at', v.starts_at);
  END IF;
  IF v.ends_at IS NOT NULL AND v.ends_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
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
$function$;
