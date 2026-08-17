-- =============================================================================
-- 0462 — Cartes de fidélité : design recto v2 + options d'impression par lot.
--
-- Demande propriétaire (17/08/2026) : le recto porte désormais un TITRE
-- « CARTE DE FIDÉLITÉ » (grand, majuscules, italique) avec « بطاقة الوفاء »
-- en dessous (plus petit, italique), une mention basse « Carte valable chez
-- tous les commerçants » OPTIONNELLE, et le LOGO DU COMMERÇANT optionnel
-- (personnalisation des cartes par commerçant). Chaque élément est un choix
-- PAR LOT, persisté ici pour que le PDF retéléchargé des années plus tard
-- ressorte à l'identique (le PDF n'est jamais stocké, régénéré à la volée).
--
--   print_title         : bloc titre FR + AR sur le recto (défaut : oui).
--   print_merchant_logo : logo du commerçant (merchants.logo_url) sur un
--                         socle blanc du recto — lots commerçant seulement.
--   print_valid_all     : mention basse « valable chez tous les commerçants »
--                         (défaut : oui pour les lots GÉNÉRIQUES, non sinon).
--
-- Reprise de l'existant : les lots génériques déjà créés affichaient la
-- mention « Valable chez tous tes commerçants » → backfill print_valid_all.
-- =============================================================================

ALTER TABLE public.loyalty_card_batches
  ADD COLUMN IF NOT EXISTS print_title boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS print_merchant_logo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS print_valid_all boolean NOT NULL DEFAULT false;

UPDATE public.loyalty_card_batches
SET print_valid_all = true
WHERE merchant_id IS NULL;

-- Signature étendue → DROP + CREATE (jamais d'overload ambigu pour PostgREST).
DROP FUNCTION IF EXISTS public.admin_loyalty_create_batch(uuid, integer, text, text, boolean, boolean, text, text);

CREATE OR REPLACE FUNCTION public.admin_loyalty_create_batch(
  p_merchant_id uuid,
  p_quantity integer,
  p_template_key text DEFAULT 'classic',
  p_note text DEFAULT NULL,
  p_print_merchant_name boolean DEFAULT true,
  p_activate_immediately boolean DEFAULT true,
  p_art_recto_path text DEFAULT NULL,
  p_art_verso_path text DEFAULT NULL,
  p_print_title boolean DEFAULT true,
  p_print_merchant_logo boolean DEFAULT false,
  p_print_valid_all boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.loyalty_platform_settings%ROWTYPE;
  v_batch uuid;
  v_code text;
  v_activate boolean := COALESCE(p_activate_immediately, true);
  i integer;
BEGIN
  IF NOT public.admin_can('commercants') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO s FROM public.loyalty_platform_settings WHERE id = 1;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > s.max_batch_quantity THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_quantity',
                              'max', s.max_batch_quantity);
  END IF;
  IF p_merchant_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.merchants WHERE id = p_merchant_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'merchant_not_found');
  END IF;

  INSERT INTO public.loyalty_card_batches
    (merchant_id, template_key, quantity, note, created_by,
     print_merchant_name, pre_activated, art_recto_path, art_verso_path,
     print_title, print_merchant_logo, print_valid_all)
  VALUES (p_merchant_id, COALESCE(NULLIF(btrim(p_template_key), ''), 'classic'),
          p_quantity, p_note, auth.uid(),
          (p_merchant_id IS NOT NULL AND COALESCE(p_print_merchant_name, true)),
          v_activate,
          NULLIF(btrim(COALESCE(p_art_recto_path, '')), ''),
          NULLIF(btrim(COALESCE(p_art_verso_path, '')), ''),
          COALESCE(p_print_title, true),
          (p_merchant_id IS NOT NULL AND COALESCE(p_print_merchant_logo, false)),
          -- Défaut : la mention « valable partout » suit le type de lot.
          COALESCE(p_print_valid_all, p_merchant_id IS NULL))
  RETURNING id INTO v_batch;

  FOR i IN 1..p_quantity LOOP
    LOOP
      v_code := public.loyalty_generate_card_code();
      BEGIN
        INSERT INTO public.loyalty_cards
          (card_code, batch_id, merchant_id, status, activated_at)
        VALUES (v_code, v_batch, p_merchant_id,
                CASE WHEN v_activate
                  THEN 'activated'::public.loyalty_card_status
                  ELSE 'printed'::public.loyalty_card_status END,
                CASE WHEN v_activate THEN now() ELSE NULL END);
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;
    END LOOP;
  END LOOP;

  IF v_activate THEN
    INSERT INTO public.loyalty_card_events
      (card_id, from_status, to_status, actor, actor_id, note)
    SELECT c.id, NULL, 'activated', 'admin', auth.uid(),
           'Active dès la génération (lot pré-activé)'
    FROM public.loyalty_cards c WHERE c.batch_id = v_batch;
  END IF;

  INSERT INTO public.admin_audit_log
    (admin_email, action, target_kind, target_id, note)
  VALUES (
    COALESCE(NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''), 'inconnu'),
    'loyalty.batch_create', 'loyalty_batch', v_batch,
    format('%s cartes %s%s%s%s', p_quantity,
      CASE WHEN p_merchant_id IS NULL THEN 'GÉNÉRIQUES' ELSE 'commerçant ' || p_merchant_id END,
      CASE WHEN v_activate THEN ' · pré-activées' ELSE '' END,
      CASE WHEN p_art_recto_path IS NOT NULL THEN ' · design perso' ELSE '' END,
      CASE WHEN p_merchant_id IS NOT NULL AND COALESCE(p_print_merchant_logo, false)
        THEN ' · logo commerçant' ELSE '' END)
  );

  RETURN jsonb_build_object('ok', true, 'batch_id', v_batch,
                            'quantity', p_quantity, 'pre_activated', v_activate);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_loyalty_create_batch(uuid, integer, text, text, boolean, boolean, text, text, boolean, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_create_batch(uuid, integer, text, text, boolean, boolean, text, text, boolean, boolean, boolean) TO authenticated;

-- Journal : expose les options d'impression v2 (badges console).
DROP FUNCTION IF EXISTS public.admin_loyalty_batches(integer, text);

CREATE OR REPLACE FUNCTION public.admin_loyalty_batches(
  p_limit integer DEFAULT 20,
  p_query text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  merchant_id uuid,
  merchant_name text,
  template_key text,
  quantity integer,
  note text,
  created_by_email text,
  print_merchant_name boolean,
  pre_activated boolean,
  has_custom_art boolean,
  deleted_at timestamptz,
  printed integer,
  activated integer,
  linked integer,
  blocked integer,
  print_title boolean,
  print_merchant_logo boolean,
  print_valid_all boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q text := NULLIF(btrim(COALESCE(p_query, '')), '');
BEGIN
  IF NOT public.admin_can('commercants') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT
    b.id,
    b.created_at,
    b.merchant_id,
    m.name,
    b.template_key,
    b.quantity,
    b.note,
    (SELECT u.email::text FROM auth.users u WHERE u.id = b.created_by),
    b.print_merchant_name,
    b.pre_activated,
    (b.art_recto_path IS NOT NULL),
    b.deleted_at,
    COALESCE(count(*) FILTER (WHERE c.status = 'printed'), 0)::int,
    COALESCE(count(*) FILTER (WHERE c.status = 'activated'), 0)::int,
    COALESCE(count(*) FILTER (WHERE c.status = 'linked'), 0)::int,
    COALESCE(count(*) FILTER (WHERE c.status = 'blocked'), 0)::int,
    b.print_title,
    b.print_merchant_logo,
    b.print_valid_all
  FROM public.loyalty_card_batches b
  LEFT JOIN public.merchants m ON m.id = b.merchant_id
  LEFT JOIN public.loyalty_cards c ON c.batch_id = b.id
  WHERE v_q IS NULL
     OR m.name ILIKE '%' || v_q || '%'
     OR b.note ILIKE '%' || v_q || '%'
     OR b.id::text ILIKE v_q || '%'
     OR (v_q ~* '^g[eé]n[eé]rique' AND b.merchant_id IS NULL)
  GROUP BY b.id, m.name
  ORDER BY b.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_loyalty_batches(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_batches(integer, text) TO authenticated;
