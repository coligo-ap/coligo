-- =============================================================================
-- 0459 — FIDÉLITÉ : lots GÉNÉRIQUES (sans commerçant) + impression du nom
--         optionnelle
-- =============================================================================
-- Demande propriétaire (17/08/2026) : pouvoir générer des cartes SANS
-- commerçant (cartes Coligo génériques, distribuables partout) et, quand un
-- commerçant est choisi, décider d'imprimer « Chez X » ou non.
-- Le nom sur la carte n'est que du BRANDING : le cloisonnement des soldes vit
-- dans le grand livre (comptes par commerçant), une carte générique fonctionne
-- déjà chez tous les commerçants. Conséquences d'un merchant_id NULL :
--   • pas de bonus de liaison (loyalty_link_card le garde déjà) ;
--   • landing /c/<code> sans « Chez X » (déjà conditionnel) ;
--   • journal des lots : LEFT JOIN (sinon les lots génériques disparaissent).
-- =============================================================================

ALTER TABLE public.loyalty_card_batches
  ALTER COLUMN merchant_id DROP NOT NULL;
ALTER TABLE public.loyalty_card_batches
  ADD COLUMN IF NOT EXISTS print_merchant_name boolean NOT NULL DEFAULT true;

-- Signature étendue → DROP + CREATE (jamais d'overload ambigu pour PostgREST).
DROP FUNCTION IF EXISTS public.admin_loyalty_create_batch(uuid, integer, text, text);

CREATE OR REPLACE FUNCTION public.admin_loyalty_create_batch(
  p_merchant_id uuid,
  p_quantity integer,
  p_template_key text DEFAULT 'classic',
  p_note text DEFAULT NULL,
  p_print_merchant_name boolean DEFAULT true
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
  -- Commerçant OPTIONNEL : NULL = lot générique Coligo.
  IF p_merchant_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.merchants WHERE id = p_merchant_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'merchant_not_found');
  END IF;

  INSERT INTO public.loyalty_card_batches
    (merchant_id, template_key, quantity, note, created_by, print_merchant_name)
  VALUES (p_merchant_id, COALESCE(NULLIF(btrim(p_template_key), ''), 'classic'),
          p_quantity, p_note, auth.uid(),
          -- Sans commerçant, il n'y a pas de nom à imprimer.
          (p_merchant_id IS NOT NULL AND COALESCE(p_print_merchant_name, true)))
  RETURNING id INTO v_batch;

  FOR i IN 1..p_quantity LOOP
    LOOP
      v_code := public.loyalty_generate_card_code();
      BEGIN
        INSERT INTO public.loyalty_cards (card_code, batch_id, merchant_id)
        VALUES (v_code, v_batch, p_merchant_id);
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        NULL; -- collision (≈ jamais à 80 bits) : on retire
      END;
    END LOOP;
  END LOOP;

  INSERT INTO public.admin_audit_log
    (admin_email, action, target_kind, target_id, note)
  VALUES (
    COALESCE(NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''), 'inconnu'),
    'loyalty.batch_create', 'loyalty_batch', v_batch,
    CASE WHEN p_merchant_id IS NULL
      THEN format('%s cartes GÉNÉRIQUES Coligo', p_quantity)
      ELSE format('%s cartes pour le commerçant %s', p_quantity, p_merchant_id)
    END
  );

  RETURN jsonb_build_object('ok', true, 'batch_id', v_batch, 'quantity', p_quantity);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_loyalty_create_batch(uuid, integer, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_create_batch(uuid, integer, text, text, boolean) TO authenticated;

-- Journal : LEFT JOIN (lots génériques visibles) + drapeau d'impression.
DROP FUNCTION IF EXISTS public.admin_loyalty_batches(integer);

CREATE OR REPLACE FUNCTION public.admin_loyalty_batches(p_limit integer DEFAULT 20)
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
  printed integer,
  activated integer,
  linked integer,
  blocked integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    COALESCE(count(*) FILTER (WHERE c.status = 'printed'), 0)::int,
    COALESCE(count(*) FILTER (WHERE c.status = 'activated'), 0)::int,
    COALESCE(count(*) FILTER (WHERE c.status = 'linked'), 0)::int,
    COALESCE(count(*) FILTER (WHERE c.status = 'blocked'), 0)::int
  FROM public.loyalty_card_batches b
  LEFT JOIN public.merchants m ON m.id = b.merchant_id
  LEFT JOIN public.loyalty_cards c ON c.batch_id = b.id
  GROUP BY b.id, m.name
  ORDER BY b.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_loyalty_batches(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_batches(integer) TO authenticated;
