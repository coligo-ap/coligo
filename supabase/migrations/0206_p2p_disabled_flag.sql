-- =============================================================================
-- 0206 — ch.0.10 SPEC-COLIGO-PAY : P2P désactivé au lancement (bypass-proof)
-- =============================================================================
-- Le transfert personne-à-personne (coligo_pay_transfer, seul point P2P : crédite
-- customer→customer via coligo_pay_transfers) est coupé tant que p2p_enabled=false
-- (mig 0205). À ne réactiver qu'avec licence Banque d'Algérie + KYC/AML.
--
-- Le paiement MARCHAND (coligo_pay_create_request / coligo_pay_execute, qui
-- exigent un merchant_id) n'est PAS du P2P → reste actif.
--
-- Garde placé en TÊTE de fonction → bloque aussi un appel RPC direct (bypass UI).
-- Retour gracieux {ok:false,error:'p2p_disabled'} pour un message « Bientôt
-- disponible » côté client.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.coligo_pay_transfer(p_handle text, p_amount_da integer, p_pin text, p_client_operation_id text, p_note text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- ch.0.10 — P2P désactivé au lancement (réglementation Banque d'Algérie).
  IF NOT COALESCE((SELECT p2p_enabled FROM public.platform_settings WHERE id = true), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'p2p_disabled');
  END IF;

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
$function$;
