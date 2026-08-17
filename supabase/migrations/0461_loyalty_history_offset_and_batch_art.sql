-- =============================================================================
-- 0461 — FIDÉLITÉ : pagination de l'historique client + DESIGN PERSONNALISÉ
--         des lots de cartes (recto/verso fournis par le super-admin)
-- =============================================================================
-- Demandes propriétaire (17/08/2026) :
--   1. PAGINATION OBLIGATOIRE des historiques côté client (fidélité, cashback,
--      Coligo Pay) — jamais « tout télécharger » : my_loyalty_history gagne un
--      p_offset (les poches wallet paginent côté requête, sans RPC).
--   2. Le super-admin peut fournir le VISUEL de la carte (image recto + verso,
--      fond perdu compris) : le système ne pose alors QUE le QR + le numéro sur
--      le recto ; le verso est imprimé tel quel. Images stockées dans le bucket
--      PRIVÉ `loyalty-card-art` (accès service_role uniquement — l'upload et la
--      lecture passent par les server actions/route admin, jamais le client).
-- =============================================================================

-- ── 1. Historique client PAGINÉ ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.my_loyalty_history(uuid, integer);

CREATE OR REPLACE FUNCTION public.my_loyalty_history(
  p_merchant_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, merchant_id uuid, merchant_name text,
  type public.loyalty_entry_type, amount_da integer,
  purchase_amount_da integer, note text, created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.id, e.merchant_id, m.name, e.type, e.amount_da,
         e.purchase_amount_da, e.note, e.created_at
  FROM public.loyalty_entries e
  JOIN public.loyalty_accounts a ON a.id = e.account_id
  JOIN public.merchants m ON m.id = e.merchant_id
  WHERE a.owner_kind = 'customer'
    AND a.customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
    AND (p_merchant_id IS NULL OR e.merchant_id = p_merchant_id)
  ORDER BY e.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;
REVOKE ALL ON FUNCTION public.my_loyalty_history(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_loyalty_history(uuid, integer, integer) TO authenticated;

-- ── 2. Design personnalisé par LOT + cycle de vie du LOT ────────────────────
ALTER TABLE public.loyalty_card_batches
  ADD COLUMN IF NOT EXISTS art_recto_path text,
  ADD COLUMN IF NOT EXISTS art_verso_path text,
  -- Suppression DOUCE : le lot et ses cartes RESTENT en base (historique,
  -- séries désactivées consultables) — les cartes sont toutes bloquées.
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- Bucket PRIVÉ (aucune policy : seul service_role y accède).
INSERT INTO storage.buckets (id, name, public)
VALUES ('loyalty-card-art', 'loyalty-card-art', false)
ON CONFLICT (id) DO NOTHING;

-- Signature étendue → DROP + CREATE (jamais d'overload ambigu pour PostgREST).
DROP FUNCTION IF EXISTS public.admin_loyalty_create_batch(uuid, integer, text, text, boolean, boolean);

CREATE OR REPLACE FUNCTION public.admin_loyalty_create_batch(
  p_merchant_id uuid,
  p_quantity integer,
  p_template_key text DEFAULT 'classic',
  p_note text DEFAULT NULL,
  p_print_merchant_name boolean DEFAULT true,
  p_activate_immediately boolean DEFAULT true,
  p_art_recto_path text DEFAULT NULL,
  p_art_verso_path text DEFAULT NULL
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
     print_merchant_name, pre_activated, art_recto_path, art_verso_path)
  VALUES (p_merchant_id, COALESCE(NULLIF(btrim(p_template_key), ''), 'classic'),
          p_quantity, p_note, auth.uid(),
          (p_merchant_id IS NOT NULL AND COALESCE(p_print_merchant_name, true)),
          v_activate,
          NULLIF(btrim(COALESCE(p_art_recto_path, '')), ''),
          NULLIF(btrim(COALESCE(p_art_verso_path, '')), ''))
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
    format('%s cartes %s%s%s', p_quantity,
      CASE WHEN p_merchant_id IS NULL THEN 'GÉNÉRIQUES' ELSE 'commerçant ' || p_merchant_id END,
      CASE WHEN v_activate THEN ' · pré-activées' ELSE '' END,
      CASE WHEN p_art_recto_path IS NOT NULL THEN ' · design perso' ELSE '' END)
  );

  RETURN jsonb_build_object('ok', true, 'batch_id', v_batch,
                            'quantity', p_quantity, 'pre_activated', v_activate);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_loyalty_create_batch(uuid, integer, text, text, boolean, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_create_batch(uuid, integer, text, text, boolean, boolean, text, text) TO authenticated;

-- Journal : design personnalisé + suppression douce, avec RECHERCHE optionnelle
-- (règle annuaires : liste courte par défaut, ilike sur nom/note/n° de lot).
DROP FUNCTION IF EXISTS public.admin_loyalty_batches(integer);

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
  blocked integer
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
    COALESCE(count(*) FILTER (WHERE c.status = 'blocked'), 0)::int
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

-- ── 3. Opérations sur le LOT ENTIER : bloquer / débloquer / supprimer ───────
-- Chaque carte passe par loyalty_card_transition → le journal append-only
-- loyalty_card_events garde la TRACE de chaque série désactivée/réactivée.

CREATE OR REPLACE FUNCTION public.admin_loyalty_block_batch(
  p_batch_id uuid,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch public.loyalty_card_batches%ROWTYPE;
  v_card RECORD;
  v_count integer := 0;
BEGIN
  IF NOT public.admin_can('commercants') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_batch FROM public.loyalty_card_batches WHERE id = p_batch_id FOR UPDATE;
  IF v_batch.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  FOR v_card IN
    SELECT id FROM public.loyalty_cards
     WHERE batch_id = p_batch_id AND status <> 'blocked'
     ORDER BY created_at FOR UPDATE
  LOOP
    PERFORM public.loyalty_card_transition(
      v_card.id, 'blocked', 'admin', auth.uid(),
      COALESCE(p_note, 'Lot bloqué par l''équipe Coligo'));
    v_count := v_count + 1;
  END LOOP;
  INSERT INTO public.admin_audit_log (admin_email, action, target_kind, target_id, note)
  VALUES (
    COALESCE(NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''), 'inconnu'),
    'loyalty.batch_block', 'loyalty_batch', p_batch_id,
    format('%s carte(s) bloquée(s)%s', v_count,
           CASE WHEN p_note IS NOT NULL THEN ' · ' || p_note ELSE '' END));
  RETURN jsonb_build_object('ok', true, 'blocked', v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_loyalty_block_batch(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_block_batch(uuid, text) TO authenticated;

-- Déblocage : chaque carte retrouve son état d'AVANT blocage (même règle que
-- admin_loyalty_unblock_card : linked > activated > printed). Un lot SUPPRIMÉ
-- ne se débloque pas (il faut d'abord annuler la suppression — volontairement
-- non exposé : la suppression est pensée définitive côté métier).
CREATE OR REPLACE FUNCTION public.admin_loyalty_unblock_batch(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch public.loyalty_card_batches%ROWTYPE;
  v_card public.loyalty_cards%ROWTYPE;
  v_to public.loyalty_card_status;
  v_count integer := 0;
BEGIN
  IF NOT public.admin_can('commercants') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_batch FROM public.loyalty_card_batches WHERE id = p_batch_id FOR UPDATE;
  IF v_batch.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_batch.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'deleted');
  END IF;
  FOR v_card IN
    SELECT * FROM public.loyalty_cards
     WHERE batch_id = p_batch_id AND status = 'blocked'
     ORDER BY created_at FOR UPDATE
  LOOP
    v_to := CASE
      WHEN v_card.customer_id IS NOT NULL THEN 'linked'::public.loyalty_card_status
      WHEN v_card.activated_at IS NOT NULL THEN 'activated'::public.loyalty_card_status
      ELSE 'printed'::public.loyalty_card_status
    END;
    PERFORM public.loyalty_card_transition(
      v_card.id, v_to, 'admin', auth.uid(), 'Lot débloqué par l''équipe Coligo');
    v_count := v_count + 1;
  END LOOP;
  INSERT INTO public.admin_audit_log (admin_email, action, target_kind, target_id, note)
  VALUES (
    COALESCE(NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''), 'inconnu'),
    'loyalty.batch_unblock', 'loyalty_batch', p_batch_id,
    format('%s carte(s) débloquée(s)', v_count));
  RETURN jsonb_build_object('ok', true, 'unblocked', v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_loyalty_unblock_batch(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_unblock_batch(uuid) TO authenticated;

-- Suppression DOUCE du lot : toutes les cartes bloquées + lot marqué supprimé.
-- Rien n'est effacé : le journal des lots garde la ligne (badge « supprimé »),
-- loyalty_card_events garde chaque série désactivée, l'audit garde qui/quand.
CREATE OR REPLACE FUNCTION public.admin_loyalty_delete_batch(
  p_batch_id uuid,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch public.loyalty_card_batches%ROWTYPE;
  v_card RECORD;
  v_count integer := 0;
BEGIN
  IF NOT public.admin_can('commercants') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_batch FROM public.loyalty_card_batches WHERE id = p_batch_id FOR UPDATE;
  IF v_batch.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_batch.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'blocked', 0);
  END IF;
  FOR v_card IN
    SELECT id FROM public.loyalty_cards
     WHERE batch_id = p_batch_id AND status <> 'blocked'
     ORDER BY created_at FOR UPDATE
  LOOP
    PERFORM public.loyalty_card_transition(
      v_card.id, 'blocked', 'admin', auth.uid(),
      COALESCE(p_note, 'Lot supprimé par l''équipe Coligo'));
    v_count := v_count + 1;
  END LOOP;
  UPDATE public.loyalty_card_batches
     SET deleted_at = now(), deleted_by = auth.uid()
   WHERE id = p_batch_id;
  INSERT INTO public.admin_audit_log (admin_email, action, target_kind, target_id, note)
  VALUES (
    COALESCE(NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''), 'inconnu'),
    'loyalty.batch_delete', 'loyalty_batch', p_batch_id,
    format('lot supprimé — %s carte(s) désactivée(s)%s', v_count,
           CASE WHEN p_note IS NOT NULL THEN ' · ' || p_note ELSE '' END));
  RETURN jsonb_build_object('ok', true, 'already', false, 'blocked', v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_loyalty_delete_batch(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_delete_batch(uuid, text) TO authenticated;

-- ── 4. BUG VÉCU : le QR personnel du client était INCONNU en caisse ─────────
-- `coligo_pay_my_handle()` renvoie du JSONB ({ok, handle, name}) ; 0454
-- l'assignait TEL QUEL à un text → le QR client encodait
-- `coligo:user:{"ok": true, …}` au lieu du handle seul → le scan commerçant
-- répondait « Carte ou code fidélité inconnu ». Fix : extraire ->>'handle'.
-- Défense en profondeur : la résolution du handle devient INSENSIBLE à la
-- casse (saisie manuelle en minuscules acceptée) — les handles sont générés
-- en hex majuscule, aucun risque de collision par casse.
CREATE OR REPLACE FUNCTION public.loyalty_resolve_target(
  p_identifier text,
  p_lock boolean DEFAULT false,
  OUT o_error text,          -- 'not_found' | 'blocked' | NULL
  OUT o_kind text,           -- 'card' | 'customer'
  OUT o_card public.loyalty_cards,
  OUT o_customer uuid,
  OUT o_customer_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind text;
  v_val  text;
BEGIN
  SELECT p.o_kind, p.o_value INTO v_kind, v_val
  FROM public.loyalty_parse_identifier(p_identifier) p;

  IF v_kind IS NULL THEN o_error := 'not_found'; RETURN; END IF;

  IF v_kind = 'handle' THEN
    SELECT c.id, c.full_name INTO o_customer, o_customer_name
    FROM public.customers c WHERE upper(c.pay_handle) = upper(v_val);
    IF o_customer IS NULL THEN o_error := 'not_found'; RETURN; END IF;
    o_kind := 'customer';
    RETURN;
  END IF;

  IF p_lock THEN
    SELECT * INTO o_card FROM public.loyalty_cards WHERE card_code = v_val FOR UPDATE;
  ELSE
    SELECT * INTO o_card FROM public.loyalty_cards WHERE card_code = v_val;
  END IF;
  IF o_card.id IS NULL THEN o_error := 'not_found'; RETURN; END IF;
  o_kind := 'card';
  IF o_card.status = 'blocked' THEN o_error := 'blocked'; RETURN; END IF;
  IF o_card.customer_id IS NOT NULL THEN
    o_customer := o_card.customer_id;
    SELECT full_name INTO o_customer_name FROM public.customers WHERE id = o_customer;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.loyalty_resolve_target(text, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.my_loyalty_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer uuid;
  v_handle text := NULL;
  v_accounts jsonb;
  v_cards jsonb;
  v_acc RECORD;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'not_a_customer' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Purge paresseuse des bons échus (best-effort — l'affichage reste juste).
  FOR v_acc IN
    SELECT a.id FROM public.loyalty_accounts a
     WHERE a.customer_id = v_customer AND a.owner_kind = 'customer'
  LOOP
    BEGIN
      PERFORM public.loyalty_expire_due(v_acc.id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;

  -- Le QR personnel réutilise le handle Coligo Pay (le compte SERT de carte).
  -- FIX 0461 : la RPC renvoie du JSONB — on extrait LE handle, pas le blob.
  BEGIN
    v_handle := public.coligo_pay_my_handle()->>'handle';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  SELECT COALESCE(jsonb_agg(row_json ORDER BY last_at DESC NULLS LAST), '[]'::jsonb)
    INTO v_accounts
  FROM (
    SELECT
      jsonb_build_object(
        'merchant_id', m.id,
        'merchant_name', m.name,
        'merchant_slug', m.slug,
        'merchant_logo', m.logo_url,
        'program', CASE WHEN p.merchant_id IS NULL THEN NULL ELSE jsonb_build_object(
          'enabled', p.enabled,
          'earn_rate_pct', p.earn_rate_pct,
          'tier_threshold_da', p.tier_threshold_da,
          'tier_reward_da', p.tier_reward_da
        ) END,
        'summary', public.loyalty_account_summary(a.id, p.tier_threshold_da, p.tier_reward_da)
      ) AS row_json,
      (SELECT max(e.created_at) FROM public.loyalty_entries e
        WHERE e.account_id = a.id) AS last_at
    FROM public.loyalty_accounts a
    JOIN public.merchants m ON m.id = a.merchant_id
    LEFT JOIN public.loyalty_programs p ON p.merchant_id = a.merchant_id
    WHERE a.customer_id = v_customer AND a.owner_kind = 'customer'
      AND EXISTS (SELECT 1 FROM public.loyalty_entries e WHERE e.account_id = a.id)
  ) t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'code_masked', '•••• ' || right(c.card_code, 4),
           'status', c.status,
           'merchant_name', m.name
         ) ORDER BY c.linked_at DESC), '[]'::jsonb)
    INTO v_cards
  FROM public.loyalty_cards c
  LEFT JOIN public.merchants m ON m.id = c.merchant_id
  WHERE c.customer_id = v_customer;

  RETURN jsonb_build_object(
    'handle', v_handle,
    'accounts', v_accounts,
    'cards', v_cards
  );
END;
$$;
REVOKE ALL ON FUNCTION public.my_loyalty_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_loyalty_overview() TO authenticated;
