-- ============================================================================
-- 0423 — Panier partagé v3 : le PROPRIÉTAIRE configure la récupération
-- (retrait / livraison EXPRESS + adresse) DANS LA ROOM, visible par tous ;
-- create_room_order la lira (fini le retrait forcé quand un invité paie).
-- La tournée reste réservée au checkout classique du propriétaire (créneaux).
-- /payer détaille les montants AVANT paiement (sous-total, service, livraison).
-- RPC redéfinies depuis les définitions LIVE.
-- ============================================================================

ALTER TABLE public.shared_carts
  ADD COLUMN IF NOT EXISTS fulfillment_type TEXT NOT NULL DEFAULT 'pickup'
    CHECK (fulfillment_type IN ('pickup', 'delivery')),
  ADD COLUMN IF NOT EXISTS delivery_mode TEXT
    CHECK (delivery_mode IN ('express')),
  ADD COLUMN IF NOT EXISTS delivery_address_id UUID,
  ADD COLUMN IF NOT EXISTS delivery_address_text TEXT,
  ADD COLUMN IF NOT EXISTS delivery_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS delivery_lng DOUBLE PRECISION,
  ADD CONSTRAINT shared_carts_delivery_coherent CHECK (
    fulfillment_type = 'pickup'
    OR (delivery_mode IS NOT NULL AND delivery_lat IS NOT NULL AND delivery_lng IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION public.shared_cart_by_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cart public.shared_carts%ROWTYPE;
  v_captain_name text;
BEGIN
  IF public.feature_blocked('shared_cart') THEN RETURN NULL; END IF;

  SELECT * INTO v_cart FROM public.shared_carts WHERE share_token = p_token;
  IF v_cart.id IS NULL THEN RETURN NULL; END IF;

  SELECT split_part(btrim(COALESCE(c.full_name, '')), ' ', 1) INTO v_captain_name
    FROM public.customers c WHERE c.id = v_cart.captain_customer_id;

  RETURN jsonb_build_object(
    'cart', jsonb_build_object(
      'id', v_cart.id,
      'status', CASE WHEN v_cart.status = 'open' AND now() > v_cart.expires_at
                     THEN 'expired' ELSE v_cart.status::text END,
      'invitations_closed', v_cart.invitations_closed,
      'expires_at', v_cart.expires_at,
      'ordered', v_cart.order_id IS NOT NULL,
      'has_payment_link', v_cart.payment_token IS NOT NULL,
      -- Config LIVRAISON fixée par le propriétaire (mig 0423) — visible par
      -- tous les membres, lue par create_room_order.
      'fulfillment_type', v_cart.fulfillment_type,
      'delivery_mode', v_cart.delivery_mode,
      'delivery_address_text', v_cart.delivery_address_text,
      -- uuid seul : la fiche /commandes/{id} exige la session du capitaine
      -- (RLS) — un invité qui suivrait le lien n'obtient rien.
      'order_id', v_cart.order_id,
      'payment_method', (SELECT o.payment_method FROM public.orders o
                          WHERE o.id = v_cart.order_id),
      'payment_status', (SELECT o.payment_status FROM public.orders o
                          WHERE o.id = v_cart.order_id)
    ),
    'captain_name', NULLIF(v_captain_name, ''),
    'merchant', (
      SELECT jsonb_build_object('id', m.id, 'slug', m.slug, 'name', m.name,
                                'logo_url', m.logo_url, 'category', m.category,
                                'min_order_da', m.min_order_da)
        FROM public.merchants m WHERE m.id = v_cart.merchant_id
    ),
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', m.id, 'kind', m.kind,
               'display_name', m.display_name,
               'member_number', m.member_number,
               'color_index', m.color_index
             ) ORDER BY m.member_number)
        FROM public.shared_cart_members m WHERE m.cart_id = v_cart.id
    ), '[]'::jsonb),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', i.id,
               'member_id', i.member_id,
               'product_id', i.product_id,
               'name_fr', p.name_fr,
               'name_ar', p.name_ar,
               'image_url', p.image_url,
               'unit', p.unit,
               'min_qty', p.min_qty,
               'max_qty', p.max_qty,
               'quantity', i.quantity,
               'unit_price_da', p.price_da + COALESCE(od.delta, 0),
               'line_total_da', round((p.price_da + COALESCE(od.delta, 0)) * i.quantity)::int,
               'available', (p.is_available AND p.archived_at IS NULL),
               'options', COALESCE(od.opts, '[]'::jsonb)
             ) ORDER BY i.created_at)
        FROM public.shared_cart_items i
        JOIN public.products p ON p.id = i.product_id
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(o.price_delta_da), 0) AS delta,
                 jsonb_agg(jsonb_build_object(
                   'option_id', o.id,
                   'group_fr', g.name_fr, 'group_ar', g.name_ar,
                   'name_fr', o.name_fr, 'name_ar', o.name_ar,
                   'delta_da', o.price_delta_da
                 ) ORDER BY g.position, o.position) AS opts
            FROM unnest(i.option_ids) sel(oid)
            JOIN public.product_options o ON o.id = sel.oid AND o.is_available
            JOIN public.product_option_groups g ON g.id = o.group_id
        ) od ON TRUE
       WHERE i.cart_id = v_cart.id
    ), '[]'::jsonb),
    'total_da', COALESCE((
      SELECT SUM(round((p.price_da + COALESCE((
               SELECT SUM(o.price_delta_da)
                 FROM unnest(i.option_ids) sel(oid)
                 JOIN public.product_options o ON o.id = sel.oid AND o.is_available
             ), 0)) * i.quantity))::int
        FROM public.shared_cart_items i
        JOIN public.products p ON p.id = i.product_id
       WHERE i.cart_id = v_cart.id
         AND p.is_available AND p.archived_at IS NULL
    ), 0)
  );
END;
$function$
;

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
$function$
;
