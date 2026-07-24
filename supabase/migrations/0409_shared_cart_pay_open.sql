-- =============================================================================
-- 0409 — Panier partagé : PAIEMENT OUVERT AU GROUPE + carte internationale
-- =============================================================================
-- Évolution demandée : N'IMPORTE QUI possédant le lien famille (/p/{token})
-- peut régler la commande — plus besoin que le capitaine transfère un lien
-- séparé. La room expose l'état de paiement de la commande liée et un
-- get-or-create du payment_token accessible au groupe (le share_token EST la
-- capacité). Le payeur choisit carte DZ (Chargily) OU carte internationale
-- (rail Stripe € existant — flag intl_card activé).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. shared_cart_by_token : même corps qu'en 0405 + l'état de PAIEMENT de la
--    commande liée (payment_method / payment_status) pour le bandeau room.
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
-- 2. shared_cart_room_pay_token — get-or-create du lien de paiement, ouvert
--    au GROUPE (quiconque a le lien famille). FOR UPDATE = zéro course.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shared_cart_room_pay_token(p_token text)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cart  public.shared_carts%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_ptoken text;
BEGIN
  IF public.feature_blocked('shared_cart') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;

  SELECT * INTO v_cart FROM public.shared_carts
   WHERE share_token = p_token FOR UPDATE;
  IF v_cart.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_cart.status <> 'ordered' OR v_cart.order_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_ordered');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_cart.order_id;
  IF v_order.id IS NULL OR v_order.payment_method <> 'online' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cash_order');
  END IF;
  IF v_order.payment_status IN ('paid', 'refunded') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_paid');
  END IF;
  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cancelled');
  END IF;

  IF v_cart.payment_token IS NULL THEN
    v_ptoken := substr(md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), 1, 16);
    UPDATE public.shared_carts
       SET payment_token = v_ptoken,
           payment_token_created_at = now(),
           updated_at = now()
     WHERE id = v_cart.id;
  ELSE
    v_ptoken := v_cart.payment_token;
  END IF;

  RETURN jsonb_build_object('ok', true, 'ptoken', v_ptoken);
END;
$$;

REVOKE ALL ON FUNCTION public.shared_cart_room_pay_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shared_cart_room_pay_token(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Carte internationale ACTIVE sur la page de paiement invité (le rail
--    Stripe € existant fait foi : éligibilité pays/plafonds au moment T).
-- ---------------------------------------------------------------------------
UPDATE public.feature_flags SET status = 'active' WHERE key = 'intl_card';

-- =============================================================================
-- VÉRIFICATION :
--   SELECT public.shared_cart_room_pay_token('deadbeef');  -- not_found (anon OK)
--   SELECT status FROM feature_flags WHERE key='intl_card'; -- active
-- =============================================================================
