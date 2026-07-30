-- ============================================================================
-- 0422 — /payer/[ptoken] : TRANSPARENCE avant paiement. L'invité qui règle
-- le panier du propriétaire voit désormais le MODE choisi par lui (retrait /
-- livraison express / tournée) et l'adresse de livraison — fixés au checkout
-- AVANT la génération du lien (demande produit : « le propriétaire choisit à
-- l'avance, l'invité ne fait que payer »). Redéfini depuis la définition LIVE.
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
    'payment_status', v_order.payment_status,
    'order_status', v_order.status,
    'share_token', v_cart.share_token,
    'is_delivery', v_delivery,
    -- Choix du PROPRIÉTAIRE, visibles AVANT paiement (l'invité sait ce qu'il
    -- règle : mode + frais inclus dans total_da + destination).
    'delivery_mode', CASE WHEN v_delivery THEN v_order.delivery_mode END,
    'delivery_address_text', CASE WHEN v_delivery
                                  THEN v_order.delivery_address_text END,
    'delivery_fee_da', CASE WHEN v_delivery THEN v_order.delivery_fee_da END,
    -- Révélés APRÈS paiement et AU PAYEUR seulement — le lien, lui, circule.
    'order_number', CASE WHEN v_paid AND v_reveal_ok
                         THEN v_order.order_number END,
    'pickup_code',  CASE WHEN v_paid AND v_reveal_ok AND NOT v_delivery
                          AND v_order.status <> 'cancelled'
                         THEN v_order.pickup_code END
  );
END;
$function$;
