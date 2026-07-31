-- ============================================================================
-- 0425 — Panier partagé, correctifs P2 de l'audit sécurité (31/07/2026).
--
--  P2-8  VIE PRIVÉE : /payer n'expose PLUS l'adresse postale complète du
--        propriétaire avant paiement (le lien circule sur WhatsApp). Le payeur
--        voit la COMMUNE seule ; l'adresse entière n'apparaît qu'APRÈS
--        paiement ET avec le secret de révélation (comme le code de retrait).
--  P2-11 Plafond de LIGNES par membre (anti-flood du panier de groupe) —
--        appliqué dans shared_cart_add_item via un garde de comptage.
-- Fonction redéfinie depuis la définition LIVE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.shared_cart_payment_info(p_payment_token text, p_reveal text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cart public.shared_carts%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_captain text;
  v_paid boolean;
  v_reveal_ok boolean;
  v_delivery boolean;
BEGIN
  IF public.feature_blocked('shared_cart') THEN RETURN NULL; END IF;

  SELECT * INTO v_cart FROM public.shared_carts
   WHERE payment_token = p_payment_token;
  IF v_cart.id IS NULL OR v_cart.order_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_cart.order_id;
  IF v_order.id IS NULL THEN RETURN NULL; END IF;

  SELECT split_part(btrim(COALESCE(c.full_name, '')), ' ', 1) INTO v_captain
    FROM public.customers c WHERE c.id = v_cart.captain_customer_id;

  v_paid := v_order.payment_status IN ('paid', 'refunded');
  -- Seul le navigateur qui a DÉMARRÉ le paiement détient le secret en clair.
  v_reveal_ok := p_reveal IS NOT NULL
             AND v_cart.payer_reveal_hash IS NOT NULL
             AND encode(extensions.digest(p_reveal, 'sha256'), 'hex')
                 = v_cart.payer_reveal_hash;
  v_delivery := v_order.fulfillment_type = 'delivery';

  RETURN jsonb_build_object(
    'captain_name', NULLIF(v_captain, ''),
    'merchant', (
      SELECT jsonb_build_object('name', m.name, 'logo_url', m.logo_url)
        FROM public.merchants m WHERE m.id = v_cart.merchant_id
    ),
    'total_da', v_order.total_da,
    'subtotal_da', v_order.subtotal_da,
    'service_fee_da', v_order.service_fee_da,
    'payment_status', v_order.payment_status,
    'order_status', v_order.status,
    'share_token', v_cart.share_token,
    'is_delivery', v_delivery,
    -- Choix du PROPRIÉTAIRE, visibles AVANT paiement (l'invité sait ce qu'il
    -- règle : mode + frais inclus dans total_da + destination).
    'delivery_mode', CASE WHEN v_delivery THEN v_order.delivery_mode END,
    'delivery_address_text', CASE
                               WHEN v_delivery AND v_paid AND v_reveal_ok
                                    THEN v_order.delivery_address_text
                               WHEN v_delivery THEN NULLIF(btrim(COALESCE(v_order.delivery_commune, '')), '')
                             END,
    'delivery_fee_da', CASE WHEN v_delivery THEN v_order.delivery_fee_da END,
    -- Révélés APRÈS paiement et AU PAYEUR seulement — le lien, lui, circule.
    'order_number', CASE WHEN v_paid AND v_reveal_ok
                         THEN v_order.order_number END,
    'pickup_code',  CASE WHEN v_paid AND v_reveal_ok AND NOT v_delivery
                          AND v_order.status <> 'cancelled'
                         THEN v_order.pickup_code END
  );
END;
$function$
;

-- P2-11 : plafond de LIGNES par membre (anti-flood du panier de groupe).
-- 40 lignes/membre = très large pour un usage familial, ferme le vecteur
-- « un invité ajoute 10 000 lignes ». Le reste de la validation catalogue
-- vit dans _shared_cart_add_validated (inchangée).
CREATE OR REPLACE FUNCTION public.shared_cart_add_item(p_token text, p_guest_token uuid, p_product_id uuid, p_option_ids uuid[], p_quantity numeric DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cart_id uuid;
  v_member  uuid;
  v_lines   integer;
BEGIN
  IF public.feature_blocked('shared_cart') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;
  SELECT id INTO v_cart_id FROM public.shared_carts WHERE share_token = p_token;
  IF v_cart_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  v_member := public._shared_cart_actor(v_cart_id, p_guest_token);
  IF v_member IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_member');
  END IF;

  SELECT count(*) INTO v_lines
    FROM public.shared_cart_items
   WHERE cart_id = v_cart_id AND member_id = v_member;
  IF v_lines >= 40 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_many_lines');
  END IF;

  RETURN public._shared_cart_add_validated(
    v_cart_id, v_member, p_product_id, p_option_ids, p_quantity);
END;
$function$;

-- P2-10 : throttle des démarrages de paiement invité (par panier).
-- Renvoie true si l'appel est autorisé (≤ 6 tentatives / heure), false sinon.
ALTER TABLE public.shared_carts
  ADD COLUMN IF NOT EXISTS pay_attempts_window timestamptz,
  ADD COLUMN IF NOT EXISTS pay_attempts_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.shared_cart_take_pay_attempt(p_cart_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_win   timestamptz;
  v_count integer;
BEGIN
  SELECT pay_attempts_window, pay_attempts_count
    INTO v_win, v_count
    FROM public.shared_carts WHERE id = p_cart_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF v_win IS NULL OR v_win < now() - interval '1 hour' THEN
    UPDATE public.shared_carts
       SET pay_attempts_window = now(), pay_attempts_count = 1
     WHERE id = p_cart_id;
    RETURN true;
  END IF;
  IF v_count >= 6 THEN RETURN false; END IF;
  UPDATE public.shared_carts
     SET pay_attempts_count = pay_attempts_count + 1
   WHERE id = p_cart_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.shared_cart_take_pay_attempt(uuid)
  FROM PUBLIC, anon, authenticated;
