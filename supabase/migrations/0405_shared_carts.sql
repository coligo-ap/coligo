-- =============================================================================
-- 0405 — PANIER PARTAGÉ (« Inviter la famille »)
-- =============================================================================
-- Un client (le CAPITAINE) ouvre un panier collaboratif chez UN commerçant et
-- partage un lien court /p/{share_token} (WhatsApp). Les invités SANS COMPTE
-- (guest_token uuid côté navigateur) ajoutent leurs produits ; tout le monde
-- voit le temps réel (broadcast serveur, canal shared-cart:{token}).
--
-- SÉCURITÉ / PRIX :
--   • le share_token EST la capacité (gabarit /t/{token}, mig 0140) ;
--   • AUCUNE policy anon sur les tables — tout l'accès invité passe par des
--     RPC SECURITY DEFINER qui revalident le token à chaque appel ;
--   • AUCUN prix stocké : `option_ids` seulement — les prix sont résolus du
--     catalogue à CHAQUE lecture, et la commande finale est recalculée par
--     `createOrder` (parité stricte client/invité garantie) ;
--   • la lecture ne renvoie JAMAIS les guest_token des autres membres.
--
-- La commande issue du panier est une commande CLASSIQUE sur le compte du
-- capitaine (checkout existant) — rien ne change côté commerçant.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ENUM + kill-switch
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.shared_cart_status AS ENUM
    ('open', 'locked', 'ordered', 'expired', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Créé CACHÉ — activé au lancement depuis /admin/controle. Les RPC anon le
-- lisent en tête : le kill-switch coupe aussi l'API anonyme.
INSERT INTO public.feature_flags (key, status, title_fr, title_ar, message_fr, message_ar)
VALUES (
  'shared_cart', 'hidden',
  'Panier partagé', 'السلة المشتركة',
  'Le panier partagé arrive bientôt.',
  'السلة المشتركة قادمة قريباً.'
)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. TABLES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shared_carts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_token              TEXT NOT NULL UNIQUE,
  captain_customer_id      UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  merchant_id              UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  status                   public.shared_cart_status NOT NULL DEFAULT 'open',
  invitations_closed       BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at               TIMESTAMPTZ NOT NULL DEFAULT now() + interval '48 hours',
  reminder_sent_at         TIMESTAMPTZ,
  order_id                 UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  -- Lien de paiement invité (B5) : capacité distincte du share_token.
  payment_token            TEXT UNIQUE,
  payment_token_created_at TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shared_carts_captain
  ON public.shared_carts (captain_customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shared_carts_expiry
  ON public.shared_carts (status, expires_at);

CREATE TABLE IF NOT EXISTS public.shared_cart_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id       UUID NOT NULL REFERENCES public.shared_carts(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('captain', 'guest')),
  customer_id   UUID REFERENCES public.customers(id) ON DELETE CASCADE,
  guest_token   UUID,
  display_name  TEXT CHECK (display_name IS NULL OR char_length(display_name) <= 24),
  member_number SMALLINT NOT NULL DEFAULT 0,
  color_index   SMALLINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'captain') = (customer_id IS NOT NULL)),
  CHECK ((kind = 'guest') = (guest_token IS NOT NULL)),
  UNIQUE (cart_id, guest_token)
);

-- Un seul capitaine par panier.
CREATE UNIQUE INDEX IF NOT EXISTS uq_shared_cart_captain
  ON public.shared_cart_members (cart_id) WHERE kind = 'captain';
CREATE INDEX IF NOT EXISTS idx_shared_cart_members_cart
  ON public.shared_cart_members (cart_id);

CREATE TABLE IF NOT EXISTS public.shared_cart_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id     UUID NOT NULL REFERENCES public.shared_carts(id) ON DELETE CASCADE,
  member_id   UUID NOT NULL REFERENCES public.shared_cart_members(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  -- Options choisies : IDS SEULEMENT (les libellés/deltas sont résolus à la
  -- lecture — jamais de prix snapshoté).
  option_ids  UUID[] NOT NULL DEFAULT '{}',
  -- Clé de ligne serveur = product_id + ids d'options TRIÉS (fusion stable).
  line_key    TEXT NOT NULL,
  quantity    NUMERIC(8, 2) NOT NULL CHECK (quantity > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cart_id, member_id, line_key)
);

CREATE INDEX IF NOT EXISTS idx_shared_cart_items_cart
  ON public.shared_cart_items (cart_id);

-- ---------------------------------------------------------------------------
-- 3. RLS — capitaine (session) seulement ; les invités passent par les RPC.
-- ---------------------------------------------------------------------------
ALTER TABLE public.shared_carts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_cart_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_cart_items   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shared_carts_captain_select ON public.shared_carts;
CREATE POLICY shared_carts_captain_select ON public.shared_carts
  FOR SELECT USING (
    captain_customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );

-- Gestion capitaine (verrouiller, fermer invitations, annuler, lier commande,
-- poser payment_token) : les transitions précises sont validées par les
-- server actions (UPDATE conditionnels).
DROP POLICY IF EXISTS shared_carts_captain_update ON public.shared_carts;
CREATE POLICY shared_carts_captain_update ON public.shared_carts
  FOR UPDATE USING (
    captain_customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  ) WITH CHECK (
    captain_customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS shared_cart_members_captain_select ON public.shared_cart_members;
CREATE POLICY shared_cart_members_captain_select ON public.shared_cart_members
  FOR SELECT USING (
    cart_id IN (SELECT sc.id FROM public.shared_carts sc
                 WHERE sc.captain_customer_id IN
                   (SELECT id FROM public.customers WHERE user_id = auth.uid()))
  );

DROP POLICY IF EXISTS shared_cart_items_captain_select ON public.shared_cart_items;
CREATE POLICY shared_cart_items_captain_select ON public.shared_cart_items
  FOR SELECT USING (
    cart_id IN (SELECT sc.id FROM public.shared_carts sc
                 WHERE sc.captain_customer_id IN
                   (SELECT id FROM public.customers WHERE user_id = auth.uid()))
  );

-- Le capitaine supprime N'IMPORTE quelle ligne de SON panier (règle métier).
DROP POLICY IF EXISTS shared_cart_items_captain_delete ON public.shared_cart_items;
CREATE POLICY shared_cart_items_captain_delete ON public.shared_cart_items
  FOR DELETE USING (
    cart_id IN (SELECT sc.id FROM public.shared_carts sc
                 WHERE sc.captain_customer_id IN
                   (SELECT id FROM public.customers WHERE user_id = auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 4. Helpers internes (service uniquement — jamais exposés).
-- ---------------------------------------------------------------------------
-- Résout le MEMBRE qui agit : invité (guest_token) OU capitaine (session).
CREATE OR REPLACE FUNCTION public._shared_cart_actor(
  p_cart_id     uuid,
  p_guest_token uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_member uuid;
BEGIN
  IF p_guest_token IS NOT NULL THEN
    SELECT id INTO v_member FROM public.shared_cart_members
     WHERE cart_id = p_cart_id AND guest_token = p_guest_token;
    RETURN v_member;
  END IF;
  -- Capitaine connecté (la page room est la même pour lui).
  SELECT m.id INTO v_member
    FROM public.shared_cart_members m
    JOIN public.shared_carts sc ON sc.id = m.cart_id
    JOIN public.customers c ON c.id = sc.captain_customer_id
   WHERE m.cart_id = p_cart_id AND m.kind = 'captain' AND c.user_id = auth.uid();
  RETURN v_member;
END;
$$;

REVOKE ALL ON FUNCTION public._shared_cart_actor(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. RPC shared_cart_create(merchant, items) — CAPITAINE (authenticated).
--    Valide chaque ligne contre le catalogue, crée cart + membre + lignes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shared_cart_create(
  p_merchant_id uuid,
  p_items       jsonb  -- [{product_id, option_ids: [], quantity}]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer uuid;
  v_cart     uuid;
  v_member   uuid;
  v_token    text;
  v_item     jsonb;
  v_res      jsonb;
BEGIN
  IF public.feature_blocked('shared_cart') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_customer');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.merchants
                  WHERE id = p_merchant_id AND is_active) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'merchant_unavailable');
  END IF;

  -- Token court unique (gabarit share_token 0140), reprise sur collision.
  LOOP
    v_token := substr(md5(gen_random_uuid()::text), 1, 8);
    BEGIN
      INSERT INTO public.shared_carts (share_token, captain_customer_id, merchant_id)
      VALUES (v_token, v_customer, p_merchant_id)
      RETURNING id INTO v_cart;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- collision de token : retente
    END;
  END LOOP;

  INSERT INTO public.shared_cart_members (cart_id, kind, customer_id, member_number, color_index)
  VALUES (v_cart, 'captain', v_customer, 0, 0)
  RETURNING id INTO v_member;

  -- Lignes initiales (celles du panier local du capitaine) — chaque ligne
  -- passe par la MÊME validation catalogue que les ajouts invités.
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    v_res := public._shared_cart_add_validated(
      v_cart, v_member,
      (v_item->>'product_id')::uuid,
      COALESCE(
        (SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(
           COALESCE(v_item->'option_ids', '[]'::jsonb)) x),
        '{}'::uuid[]
      ),
      (v_item->>'quantity')::numeric
    );
    -- Ligne invalide (produit retiré entre-temps) : on l'ignore sans échouer.
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'token', v_token, 'cart_id', v_cart);
END;
$$;

REVOKE ALL ON FUNCTION public.shared_cart_create(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shared_cart_create(uuid, jsonb) TO authenticated;

-- Validation + fusion d'UNE ligne (partagée création / ajout). Service seul.
CREATE OR REPLACE FUNCTION public._shared_cart_add_validated(
  p_cart_id    uuid,
  p_member_id  uuid,
  p_product_id uuid,
  p_option_ids uuid[],
  p_quantity   numeric
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cart      public.shared_carts%ROWTYPE;
  v_product   public.products%ROWTYPE;
  v_valid_ids uuid[];
  v_line_key  text;
  v_qty       numeric;
  v_min       numeric;
  v_max       numeric;
BEGIN
  SELECT * INTO v_cart FROM public.shared_carts WHERE id = p_cart_id;
  IF v_cart.id IS NULL OR v_cart.status <> 'open' OR now() > v_cart.expires_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cart_closed');
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = p_product_id;
  IF v_product.id IS NULL
     OR v_product.merchant_id <> v_cart.merchant_id
     OR v_product.is_available IS DISTINCT FROM TRUE
     OR v_product.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'product_unavailable');
  END IF;

  -- Options : disponibles ET appartenant à CE produit — on ne garde que les
  -- valides, TRIÉES (clé de ligne stable, indépendante de l'ordre).
  SELECT COALESCE(array_agg(o.id ORDER BY o.id), '{}'::uuid[]) INTO v_valid_ids
    FROM unnest(COALESCE(p_option_ids, '{}'::uuid[])) sel(oid)
    JOIN public.product_options o ON o.id = sel.oid AND o.is_available
    JOIN public.product_option_groups g ON g.id = o.group_id
   WHERE g.product_id = p_product_id;

  v_line_key := p_product_id::text
    || CASE WHEN cardinality(v_valid_ids) > 0
            THEN '#' || array_to_string(v_valid_ids, '|') ELSE '' END;

  -- Bornes quantité (mêmes règles que le panier local : min/ligne, max/cmd).
  v_min := GREATEST(COALESCE(v_product.min_qty, 0), 0.01);
  v_max := COALESCE(NULLIF(v_product.max_qty, 0), 999);
  v_qty := LEAST(GREATEST(round(COALESCE(p_quantity, 1)::numeric, 2), v_min), v_max);

  INSERT INTO public.shared_cart_items
    (cart_id, member_id, product_id, option_ids, line_key, quantity)
  VALUES (p_cart_id, p_member_id, p_product_id, v_valid_ids, v_line_key, v_qty)
  ON CONFLICT (cart_id, member_id, line_key)
  DO UPDATE SET quantity = LEAST(public.shared_cart_items.quantity + EXCLUDED.quantity, v_max);

  UPDATE public.shared_carts SET updated_at = now() WHERE id = p_cart_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public._shared_cart_add_validated(uuid, uuid, uuid, uuid[], numeric) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. RPC shared_cart_by_token — LA lecture de la room (anon + capitaine).
--    NULL si token inconnu (jamais d'erreur qui confirme/inﬁrme un token).
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
      'has_payment_link', v_cart.payment_token IS NOT NULL
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
-- 7. RPC shared_cart_join — l'invité rejoint (prénom optionnel).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shared_cart_join(
  p_token        text,
  p_guest_token  uuid,
  p_display_name text DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cart   public.shared_carts%ROWTYPE;
  v_member public.shared_cart_members%ROWTYPE;
  v_n      integer;
  v_name   text := NULLIF(left(btrim(COALESCE(p_display_name, '')), 24), '');
BEGIN
  IF public.feature_blocked('shared_cart') OR p_guest_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;

  -- FOR UPDATE : sérialise les numérotations d'invités concurrentes.
  SELECT * INTO v_cart FROM public.shared_carts
   WHERE share_token = p_token FOR UPDATE;
  IF v_cart.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- Déjà membre → renvoie sa fiche (ré-ouverture du lien).
  SELECT * INTO v_member FROM public.shared_cart_members
   WHERE cart_id = v_cart.id AND guest_token = p_guest_token;
  IF v_member.id IS NOT NULL THEN
    IF v_name IS NOT NULL AND v_member.display_name IS DISTINCT FROM v_name THEN
      UPDATE public.shared_cart_members SET display_name = v_name
       WHERE id = v_member.id;
      v_member.display_name := v_name;
    END IF;
    RETURN jsonb_build_object('ok', true, 'member', jsonb_build_object(
      'id', v_member.id, 'display_name', v_member.display_name,
      'member_number', v_member.member_number, 'color_index', v_member.color_index));
  END IF;

  IF v_cart.status <> 'open' OR now() > v_cart.expires_at
     OR v_cart.invitations_closed THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'closed');
  END IF;

  SELECT count(*) INTO v_n FROM public.shared_cart_members
   WHERE cart_id = v_cart.id AND kind = 'guest';
  IF v_n >= 15 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'full');
  END IF;

  INSERT INTO public.shared_cart_members
    (cart_id, kind, guest_token, display_name, member_number, color_index)
  VALUES (v_cart.id, 'guest', p_guest_token, v_name, v_n + 1, (v_n + 1) % 8)
  RETURNING * INTO v_member;

  UPDATE public.shared_carts SET updated_at = now() WHERE id = v_cart.id;
  RETURN jsonb_build_object('ok', true, 'member', jsonb_build_object(
    'id', v_member.id, 'display_name', v_member.display_name,
    'member_number', v_member.member_number, 'color_index', v_member.color_index));
END;
$$;

REVOKE ALL ON FUNCTION public.shared_cart_join(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shared_cart_join(text, uuid, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. RPC shared_cart_add_item — invité (guest_token) OU capitaine (session).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shared_cart_add_item(
  p_token       text,
  p_guest_token uuid,
  p_product_id  uuid,
  p_option_ids  uuid[],
  p_quantity    numeric DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cart_id uuid;
  v_member  uuid;
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
  RETURN public._shared_cart_add_validated(
    v_cart_id, v_member, p_product_id, p_option_ids, p_quantity);
END;
$$;

REVOKE ALL ON FUNCTION public.shared_cart_add_item(text, uuid, uuid, uuid[], numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shared_cart_add_item(text, uuid, uuid, uuid[], numeric) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. RPC shared_cart_set_qty — UNIQUEMENT SES lignes (0 = suppression).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shared_cart_set_qty(
  p_token       text,
  p_guest_token uuid,
  p_item_id     uuid,
  p_quantity    numeric
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cart   public.shared_carts%ROWTYPE;
  v_member uuid;
  v_item   public.shared_cart_items%ROWTYPE;
  v_min    numeric;
  v_max    numeric;
BEGIN
  IF public.feature_blocked('shared_cart') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;
  SELECT * INTO v_cart FROM public.shared_carts WHERE share_token = p_token;
  IF v_cart.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_cart.status <> 'open' OR now() > v_cart.expires_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cart_closed');
  END IF;
  v_member := public._shared_cart_actor(v_cart.id, p_guest_token);
  IF v_member IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_member');
  END IF;

  -- La ligne doit appartenir à CE membre (un invité ne touche jamais aux
  -- lignes des autres — seul le capitaine supprime tout, via SON action).
  SELECT * INTO v_item FROM public.shared_cart_items
   WHERE id = p_item_id AND cart_id = v_cart.id AND member_id = v_member;
  IF v_item.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_yours');
  END IF;

  IF COALESCE(p_quantity, 0) <= 0 THEN
    DELETE FROM public.shared_cart_items WHERE id = v_item.id;
  ELSE
    SELECT GREATEST(COALESCE(p.min_qty, 0), 0.01),
           COALESCE(NULLIF(p.max_qty, 0), 999)
      INTO v_min, v_max
      FROM public.products p WHERE p.id = v_item.product_id;
    UPDATE public.shared_cart_items
       SET quantity = LEAST(GREATEST(round(p_quantity::numeric, 2), v_min), v_max)
     WHERE id = v_item.id;
  END IF;

  UPDATE public.shared_carts SET updated_at = now() WHERE id = v_cart.id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.shared_cart_set_qty(text, uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shared_cart_set_qty(text, uuid, uuid, numeric) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. RPC shared_cart_set_name — l'invité (re)nomme son avatar.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shared_cart_set_name(
  p_token       text,
  p_guest_token uuid,
  p_name        text
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cart_id uuid;
  v_member  uuid;
BEGIN
  IF public.feature_blocked('shared_cart') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;
  SELECT id INTO v_cart_id FROM public.shared_carts WHERE share_token = p_token;
  IF v_cart_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF p_guest_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_member');
  END IF;
  v_member := public._shared_cart_actor(v_cart_id, p_guest_token);
  IF v_member IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_member');
  END IF;

  UPDATE public.shared_cart_members
     SET display_name = NULLIF(left(btrim(COALESCE(p_name, '')), 24), '')
   WHERE id = v_member;
  UPDATE public.shared_carts SET updated_at = now() WHERE id = v_cart_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.shared_cart_set_name(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shared_cart_set_name(text, uuid, text) TO anon, authenticated;

-- =============================================================================
-- VÉRIFICATION :
--   SELECT public.shared_cart_by_token('deadbeef');  -- NULL (anon OK)
--   SELECT status FROM feature_flags WHERE key = 'shared_cart';  -- hidden
-- =============================================================================
