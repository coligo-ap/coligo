-- =============================================================================
-- Coligo v3 - Migration 0089 : « Envoyer à un ami » — recherche + note
-- =============================================================================
-- Complète le transfert P2P (0085/0086) pour le flux DÉDIÉ « Envoyer à un ami »
-- (recherche destinataire → montant → confirmation).
--
-- Confidentialité : PAS d'énumération par nom (fuite de PII). La recherche ne
-- résout que par TÉLÉPHONE EXACT (9 derniers chiffres) ou @HANDLE EXACT. Les
-- « récents » ne montrent que les bénéficiaires que l'utilisateur a DÉJÀ payés
-- (son propre graphe), jamais des inconnus.
--
-- Ajoute une NOTE optionnelle au transfert (snapshot immuable dans le ledger).
-- =============================================================================

ALTER TABLE public.coligo_pay_transfers
  ADD COLUMN IF NOT EXISTS note TEXT;

-- ============================================================================
-- 1. Rechercher un bénéficiaire par téléphone exact OU @handle exact
-- ============================================================================
CREATE OR REPLACE FUNCTION public.coligo_pay_search_recipient(p_query TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sender    UUID;
  v_q         TEXT;
  v_digits    TEXT;
  v_rec       RECORD;
BEGIN
  SELECT id INTO v_sender FROM public.customers WHERE user_id = auth.uid();
  IF v_sender IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_customer');
  END IF;

  v_q := btrim(COALESCE(p_query, ''));
  v_q := regexp_replace(v_q, '^@', '');           -- @handle → handle
  IF length(v_q) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too_short');
  END IF;

  v_digits := regexp_replace(v_q, '\D', '', 'g');

  IF length(v_digits) >= 8 THEN
    -- Téléphone : comparaison sur les 9 derniers chiffres (tolère +213 / 0…).
    SELECT id, full_name, pay_handle INTO v_rec
    FROM public.customers
    WHERE pay_handle IS NOT NULL
      AND id <> v_sender
      AND right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 9)
          = right(v_digits, 9)
    LIMIT 1;
  ELSE
    -- @handle exact (insensible à la casse).
    SELECT id, full_name, pay_handle INTO v_rec
    FROM public.customers
    WHERE pay_handle = upper(v_q) AND id <> v_sender
    LIMIT 1;
  END IF;

  IF v_rec.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'handle', v_rec.pay_handle,
    'name', v_rec.full_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.coligo_pay_search_recipient(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.coligo_pay_search_recipient(TEXT) TO authenticated;

-- ============================================================================
-- 2. Bénéficiaires récents (graphe perso : à qui j'ai déjà envoyé)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.coligo_pay_recent_recipients(p_limit INTEGER DEFAULT 8)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sender UUID;
  v_lim    INTEGER := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 20);
  v        JSONB;
BEGIN
  SELECT id INTO v_sender FROM public.customers WHERE user_id = auth.uid();
  IF v_sender IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(y)), '[]'::jsonb) INTO v
  FROM (
    SELECT handle, name
    FROM (
      SELECT DISTINCT ON (t.recipient_customer_id)
             c.pay_handle AS handle, c.full_name AS name, t.created_at
      FROM public.coligo_pay_transfers t
      JOIN public.customers c ON c.id = t.recipient_customer_id
      WHERE t.sender_customer_id = v_sender AND c.pay_handle IS NOT NULL
      ORDER BY t.recipient_customer_id, t.created_at DESC
    ) x
    ORDER BY x.created_at DESC
    LIMIT v_lim
  ) y;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.coligo_pay_recent_recipients(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.coligo_pay_recent_recipients(INTEGER) TO authenticated;

-- ============================================================================
-- 3. Transfert avec NOTE optionnelle (remplace la version 4-args de 0086)
-- ============================================================================
DROP FUNCTION IF EXISTS public.coligo_pay_transfer(TEXT, INTEGER, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.coligo_pay_transfer(
  p_handle TEXT,
  p_amount_da INTEGER,
  p_pin TEXT,
  p_client_operation_id TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sender    UUID;
  v_recipient UUID;
  v_rname     TEXT;
  v_existing  public.coligo_pay_transfers%ROWTYPE;
  v_pin       TEXT;
  v_balance   INTEGER;
  v_transfer  UUID;
  v_note      TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  SELECT id INTO v_sender FROM public.customers WHERE user_id = auth.uid();
  IF v_sender IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_customer');
  END IF;
  IF p_client_operation_id IS NULL OR length(p_client_operation_id) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_operation');
  END IF;
  IF p_amount_da IS NULL OR p_amount_da <= 0 OR p_amount_da > 1000000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 140 THEN
    v_note := left(v_note, 140);
  END IF;

  -- (a) Idempotence.
  SELECT * INTO v_existing FROM public.coligo_pay_transfers
  WHERE sender_customer_id = v_sender
    AND client_operation_id = p_client_operation_id;
  IF FOUND THEN
    SELECT full_name INTO v_rname FROM public.customers
    WHERE id = v_existing.recipient_customer_id;
    RETURN jsonb_build_object('ok', true, 'already', true,
      'transfer_id', v_existing.id, 'recipient_name', v_rname,
      'amount_da', v_existing.amount_da);
  END IF;

  -- (b) PIN obligatoire.
  v_pin := public.coligo_pay_pin_check_internal(v_sender, p_pin);
  IF v_pin <> 'ok' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pin_' || v_pin);
  END IF;

  -- (c) Bénéficiaire (compte Coligo obligatoire, jamais soi-même).
  SELECT id, full_name INTO v_recipient, v_rname FROM public.customers
  WHERE pay_handle = upper(btrim(p_handle));
  IF v_recipient IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_recipient = v_sender THEN
    RETURN jsonb_build_object('ok', false, 'error', 'self');
  END IF;

  -- (d) Anti double-dépense (même verrou que les autres dépenses du client).
  PERFORM pg_advisory_xact_lock(hashtext('cwe_spend:' || v_sender::text));

  SELECT public.customer_topup_balance(v_sender) INTO v_balance;
  IF v_balance < p_amount_da THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient',
      'balance', v_balance, 'amount', p_amount_da);
  END IF;

  -- (e) Transfert (source de vérité).
  BEGIN
    INSERT INTO public.coligo_pay_transfers
      (sender_customer_id, recipient_customer_id, amount_da, client_operation_id, note)
    VALUES (v_sender, v_recipient, p_amount_da, p_client_operation_id, v_note)
    RETURNING id INTO v_transfer;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing FROM public.coligo_pay_transfers
    WHERE sender_customer_id = v_sender
      AND client_operation_id = p_client_operation_id;
    RETURN jsonb_build_object('ok', true, 'already', true,
      'transfer_id', v_existing.id, 'recipient_name', v_rname,
      'amount_da', v_existing.amount_da);
  END;

  -- (f) Double-entrée ledger : expéditeur − / bénéficiaire +.
  INSERT INTO public.customer_wallet_entries
    (customer_id, order_id, type, source, amount_da, note, coligo_pay_transfer_id)
  VALUES
    (v_sender, NULL, 'transfer_out', 'topup', -p_amount_da,
     'Transfert Coligo Pay envoyé à ' || COALESCE(v_rname, 'un ami')
       || COALESCE(' — ' || v_note, ''), v_transfer);

  INSERT INTO public.customer_wallet_entries
    (customer_id, order_id, type, source, amount_da, note, coligo_pay_transfer_id)
  VALUES
    (v_recipient, NULL, 'transfer_in', 'topup', p_amount_da,
     'Transfert Coligo Pay reçu' || COALESCE(' — ' || v_note, ''), v_transfer);

  RETURN jsonb_build_object('ok', true, 'already', false,
    'transfer_id', v_transfer, 'recipient_name', v_rname,
    'amount_da', p_amount_da);
END;
$$;

REVOKE ALL ON FUNCTION public.coligo_pay_transfer(TEXT, INTEGER, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.coligo_pay_transfer(TEXT, INTEGER, TEXT, TEXT, TEXT) TO authenticated;

-- =============================================================================
-- VÉRIF (session client) :
--   SELECT public.coligo_pay_search_recipient('+213770112233');
--   SELECT public.coligo_pay_recent_recipients(8);
-- =============================================================================
