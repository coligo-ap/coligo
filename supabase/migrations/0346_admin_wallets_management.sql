-- =============================================================================
-- 0346 — Coligo Pay : gestion complète des PORTEFEUILLES côté super-admin.
-- =============================================================================
-- Constat (cartographie 08/07) : la surveillance Coligo Pay est 100 % agrégée.
-- Aucune recherche par utilisateur, aucune fiche portefeuille, et AUCUN
-- ajustement admin du wallet CLIENT (l'enum 'adjustment' existe depuis 0017
-- mais aucune écriture admin n'est possible). Côté opérateurs/agents,
-- admin_operator_credit (0185) existe déjà — il ne manque que la recherche
-- et la fiche. On ajoute :
--
--  1. admin_search_wallets — recherche UNIFIÉE par nom / téléphone / handle :
--     clients (solde Coligo Pay + cashback) ET portefeuilles opérateurs
--     (livreur / chauffeur / commerçant / AGENT partner, solde signé).
--     Gardée admin_can('finances').
--  2. admin_customer_credit — ajustement MOTIVÉ (crédit OU débit) du wallet
--     client : écriture 'adjustment' (note obligatoire, contrainte 0017),
--     source topup (Coligo Pay) ou cashback, un débit ne peut JAMAIS rendre
--     le solde négatif (contrôle sous verrou advisory par client), plafond
--     ±100 000 DA. Le grand livre reste append-only : toute correction est
--     une nouvelle ligne signée.
-- =============================================================================

-- ── 1. Recherche unifiée ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_search_wallets(
  p_q     TEXT,
  p_limit INTEGER DEFAULT 12
)
RETURNS TABLE (
  kind        TEXT,        -- 'client' | 'driver' | 'chauffeur' | 'merchant' | 'partner'
  ref_id      UUID,        -- client : customer_id ; opérateur : wallet_id
  name        TEXT,
  phone       TEXT,
  balance_da  INTEGER,     -- client : solde Coligo Pay (topup) ; opérateur : solde signé
  cashback_da INTEGER,     -- client uniquement (0 sinon)
  status      TEXT         -- opérateur : active/suspended/disabled ; client : 'active'
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q TEXT := NULLIF(btrim(COALESCE(p_q, '')), '');
  v_n INTEGER := LEAST(GREATEST(COALESCE(p_limit, 12), 1), 25);
BEGIN
  IF NOT public.admin_can('finances') THEN
    RETURN; -- fail-closed
  END IF;
  IF v_q IS NULL OR length(v_q) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  -- Clients (soldes calculés uniquement sur les quelques lignes retenues).
  SELECT 'client'::TEXT, c.id, c.full_name, c.phone,
         COALESCE((SELECT sum(e.amount_da) FROM public.customer_wallet_entries e
                    WHERE e.customer_id = c.id AND e.source = 'topup'), 0)::INTEGER,
         COALESCE((SELECT sum(e.amount_da) FROM public.customer_wallet_entries e
                    WHERE e.customer_id = c.id AND e.source = 'cashback'), 0)::INTEGER,
         'active'::TEXT
    FROM public.customers c
   WHERE c.full_name ILIKE '%' || v_q || '%'
      OR c.phone ILIKE '%' || v_q || '%'
      OR c.pay_handle ILIKE '%' || v_q || '%'
      OR c.id::TEXT = lower(v_q)
   LIMIT v_n;

  RETURN QUERY
  -- Portefeuilles opérateurs (livreur / chauffeur / commerçant / agent).
  SELECT w.owner_type::TEXT, w.id,
         COALESCE(
           w.display_name,
           CASE w.owner_type
             WHEN 'driver'    THEN (SELECT d.full_name FROM public.drivers d WHERE d.id = w.owner_id)
             WHEN 'chauffeur' THEN (SELECT ch.full_name FROM public.chauffeurs ch WHERE ch.id = w.owner_id)
             WHEN 'merchant'  THEN (SELECT m.name FROM public.merchants m WHERE m.id = w.owner_id)
             ELSE NULL
           END, '—'),
         COALESCE(
           w.phone,
           CASE w.owner_type
             WHEN 'driver'    THEN (SELECT d.phone FROM public.drivers d WHERE d.id = w.owner_id)
             WHEN 'chauffeur' THEN (SELECT ch.phone FROM public.chauffeurs ch WHERE ch.id = w.owner_id)
             ELSE NULL
           END),
         public.operator_balance(w.id),
         0,
         w.status
    FROM public.operator_wallets w
   WHERE w.id::TEXT = lower(v_q)
      OR w.display_name ILIKE '%' || v_q || '%'
      OR w.phone ILIKE '%' || v_q || '%'
      OR (w.owner_type = 'driver' AND w.owner_id IN (
            SELECT d.id FROM public.drivers d
             WHERE d.full_name ILIKE '%' || v_q || '%' OR d.phone ILIKE '%' || v_q || '%'))
      OR (w.owner_type = 'chauffeur' AND w.owner_id IN (
            SELECT ch.id FROM public.chauffeurs ch
             WHERE ch.full_name ILIKE '%' || v_q || '%' OR ch.phone ILIKE '%' || v_q || '%'))
      OR (w.owner_type = 'merchant' AND w.owner_id IN (
            SELECT m.id FROM public.merchants m WHERE m.name ILIKE '%' || v_q || '%'))
   LIMIT v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_search_wallets(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_wallets(TEXT, INTEGER) TO authenticated;

-- ── 2. Ajustement admin du wallet CLIENT ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_customer_credit(
  p_customer_id UUID,
  p_amount_da   INTEGER,   -- signé : >0 crédit, <0 débit
  p_source      TEXT,      -- 'topup' (Coligo Pay) | 'cashback'
  p_note        TEXT
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_exists BOOLEAN;
  v_bal    INTEGER;
BEGIN
  IF NOT public.admin_can('finances') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF p_amount_da IS NULL OR p_amount_da = 0
     OR abs(p_amount_da) > 100000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_amount');
  END IF;
  IF p_source NOT IN ('topup', 'cashback') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_source');
  END IF;
  IF NULLIF(btrim(COALESCE(p_note, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'note_required');
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = p_customer_id)
    INTO v_exists;
  IF NOT v_exists THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'customer_not_found');
  END IF;

  -- Sérialise les ajustements d'un même client (pas de course entre le calcul
  -- du solde et l'écriture — un débit ne rend jamais le solde négatif).
  PERFORM pg_advisory_xact_lock(hashtext('admin_customer_credit'), hashtext(p_customer_id::TEXT));

  SELECT COALESCE(sum(e.amount_da), 0)::INTEGER INTO v_bal
    FROM public.customer_wallet_entries e
   WHERE e.customer_id = p_customer_id AND e.source = p_source::public.customer_wallet_source;
  IF p_amount_da < 0 AND v_bal + p_amount_da < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_balance',
                              'balance_da', v_bal);
  END IF;

  INSERT INTO public.customer_wallet_entries
      (customer_id, order_id, type, source, amount_da, note)
    VALUES
      (p_customer_id, NULL, 'adjustment', p_source::public.customer_wallet_source,
       p_amount_da, 'Ajustement support — ' || btrim(p_note));

  RETURN jsonb_build_object(
    'ok', true,
    'amount_da', p_amount_da,
    'new_balance_da', v_bal + p_amount_da,
    'source', p_source
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_customer_credit(UUID, INTEGER, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_customer_credit(UUID, INTEGER, TEXT, TEXT) TO authenticated;
