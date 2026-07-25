-- =============================================================================
-- 0411 — Panier partagé : CONFIRMATION DE PAIEMENT réactive
-- =============================================================================
-- Demande produit : après le paiement (retour Chargily/Stripe), le payeur voit
-- IMMÉDIATEMENT « Paiement accepté » avec le numéro de commande + le code de
-- retrait + le QR — et le capitaine reçoit la même confirmation en temps réel
-- (room + push) avec un bouton vers SA commande.
--
--   1. shared_cart_payment_info : expose order_number + pickup_code
--      UNIQUEMENT une fois la commande PAYÉE (jamais avant — le code de
--      retrait ne se révèle qu'à un paiement confirmé).
--   2. shared_cart_by_token : expose cart.order_id (uuid) pour que le bouton
--      capitaine mène à la commande CONCERNÉE (/commandes/{id}) — la fiche
--      elle-même reste protégée par la RLS (session capitaine requise).
--   3. Index shared_carts(order_id) : le webhook fait la correspondance
--      commande → panier partagé à CHAQUE paiement en ligne (lookup O(1)).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. shared_cart_payment_info — même corps qu'en 0406 + numéro/code APRÈS paie.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shared_cart_payment_info(p_payment_token text)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cart public.shared_carts%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_captain text;
  v_paid boolean;
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
    -- Révélés APRÈS paiement seulement : le lien de paiement circule dans la
    -- famille AVANT le règlement — le code de retrait ne doit exister pour
    -- eux qu'une fois la commande réellement payée.
    'order_number', CASE WHEN v_paid THEN v_order.order_number END,
    'pickup_code',  CASE WHEN v_paid AND v_order.status <> 'cancelled'
                         THEN v_order.pickup_code END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.shared_cart_payment_info(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shared_cart_payment_info(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. shared_cart_by_token — même corps qu'en 0409 + cart.order_id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shared_cart_by_token(p_token text)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.shared_cart_by_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shared_cart_by_token(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Correspondance commande → panier partagé (webhooks, chaque paiement).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_shared_carts_order_id
  ON public.shared_carts (order_id) WHERE order_id IS NOT NULL;

-- =============================================================================
-- VÉRIFICATION :
--   SELECT public.shared_cart_payment_info('inconnu');       -- NULL (anon OK)
--   -- pickup_code/order_number absents tant que payment_status <> paid ;
--   -- by_token expose cart.order_id une fois la commande liée.
-- =============================================================================
