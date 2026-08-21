-- =============================================================================
-- 0460 — FIDÉLITÉ : lots PRÉ-ACTIVÉS (défaut) — la carte physique s'utilise
--         tous les jours SANS compte ni application
-- =============================================================================
-- Demande propriétaire (17/08/2026) : par défaut (et en option), les cartes
-- naissent « activated » — utilisables immédiatement en caisse (crédits ET
-- réductions), sans jamais exiger de compte client : cas des personnes âgées.
-- La liaison à un compte reste POSSIBLE à tout moment, jamais obligatoire.
-- Sécurité inchangée : une carte activée à solde nul ne vaut rien de plus
-- qu'une carte `printed` — la valeur n'existe qu'au crédit en caisse par un
-- commerçant authentifié. Le mode « activation au premier crédit » reste
-- disponible (p_activate_immediately => false).
-- =============================================================================

ALTER TABLE public.loyalty_card_batches
  ADD COLUMN IF NOT EXISTS pre_activated boolean NOT NULL DEFAULT false;

DROP FUNCTION IF EXISTS public.admin_loyalty_create_batch(uuid, integer, text, text, boolean);

CREATE OR REPLACE FUNCTION public.admin_loyalty_create_batch(
  p_merchant_id uuid,
  p_quantity integer,
  p_template_key text DEFAULT 'classic',
  p_note text DEFAULT NULL,
  p_print_merchant_name boolean DEFAULT true,
  p_activate_immediately boolean DEFAULT true
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
     print_merchant_name, pre_activated)
  VALUES (p_merchant_id, COALESCE(NULLIF(btrim(p_template_key), ''), 'classic'),
          p_quantity, p_note, auth.uid(),
          (p_merchant_id IS NOT NULL AND COALESCE(p_print_merchant_name, true)),
          v_activate)
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

  -- Journal des cartes : la naissance « déjà active » est tracée.
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
    format('%s cartes %s%s', p_quantity,
      CASE WHEN p_merchant_id IS NULL THEN 'GÉNÉRIQUES' ELSE 'commerçant ' || p_merchant_id END,
      CASE WHEN v_activate THEN ' · pré-activées' ELSE '' END)
  );

  RETURN jsonb_build_object('ok', true, 'batch_id', v_batch,
                            'quantity', p_quantity, 'pre_activated', v_activate);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_loyalty_create_batch(uuid, integer, text, text, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_create_batch(uuid, integer, text, text, boolean, boolean) TO authenticated;

-- Journal des lots : expose pre_activated (affichage console).
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
  pre_activated boolean,
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
    b.pre_activated,
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
