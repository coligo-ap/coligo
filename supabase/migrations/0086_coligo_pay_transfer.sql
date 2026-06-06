-- =============================================================================
-- Coligo v3 - Migration 0086 : Transfert P2P Coligo Pay (boucle fermée)
-- =============================================================================
-- ⚠️ ARGENT RÉEL. Transfert de solde Coligo Pay (topup) entre DEUX clients qui
-- possèdent tous deux Coligo Pay. Boucle fermée : aucun retrait espèces/carte,
-- l'argent ne quitte jamais Coligo (il ne sort que vers un commerçant via le
-- flux d'encaissement 0084, payé par la plateforme).
--
-- Sécurité (identique au paiement marchand 0084) :
--   - PIN Coligo Pay obligatoire (hashé, anti-brute-force) — réutilise
--     coligo_pay_pin_check_internal.
--   - Idempotence : coligo_pay_transfers.client_operation_id UNIQUE par expéditeur.
--   - Atomique + anti double-dépense (pg_advisory_xact_lock par expéditeur, même
--     clé que les dépenses sur commande/paiement → sérialisation totale).
--   - Double-entrée : expéditeur −montant (transfer_out), bénéficiaire +montant
--     (transfer_in). SUM = 0.
--   - Anti self-transfer ; bénéficiaire DOIT exister (compte Coligo).
--   - RLS deny-all en écriture ; tout passe par la fonction DEFINER.
-- =============================================================================

-- ============================================================================
-- 1. Handle public de réception (code stable, encodé dans le QR « Recevoir »)
-- ============================================================================
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS pay_handle TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_pay_handle
  ON public.customers(pay_handle)
  WHERE pay_handle IS NOT NULL;

-- ============================================================================
-- 2. Transferts exécutés (source de vérité + idempotence)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.coligo_pay_transfers (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_customer_id   UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  recipient_customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  amount_da            INTEGER NOT NULL CHECK (amount_da > 0),
  client_operation_id  TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cpt_no_self CHECK (sender_customer_id <> recipient_customer_id),
  CONSTRAINT cpt_client_op_unique UNIQUE (sender_customer_id, client_operation_id)
);

CREATE INDEX IF NOT EXISTS idx_cpt_sender
  ON public.coligo_pay_transfers(sender_customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cpt_recipient
  ON public.coligo_pay_transfers(recipient_customer_id, created_at DESC);

ALTER TABLE public.coligo_pay_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cpt_select_own" ON public.coligo_pay_transfers;
CREATE POLICY "cpt_select_own" ON public.coligo_pay_transfers
  FOR SELECT USING (
    sender_customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
    OR recipient_customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );

-- ============================================================================
-- 3. Lien d'idempotence sur le ledger client (transfert sans order_id)
-- ============================================================================
ALTER TABLE public.customer_wallet_entries
  ADD COLUMN IF NOT EXISTS coligo_pay_transfer_id UUID
    REFERENCES public.coligo_pay_transfers(id) ON DELETE SET NULL;
-- Une écriture par (transfert, type) : transfer_out chez l'un, transfer_in chez
-- l'autre — la paire est unique.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cwe_transfer_type
  ON public.customer_wallet_entries(coligo_pay_transfer_id, type)
  WHERE coligo_pay_transfer_id IS NOT NULL;

-- ============================================================================
-- 4. Mon handle de réception (génère un code stable si absent)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.coligo_pay_my_handle()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_customer UUID;
  v_handle   TEXT;
  v_name     TEXT;
  v_try      TEXT;
  v_i        INTEGER := 0;
BEGIN
  SELECT id, pay_handle, full_name INTO v_customer, v_handle, v_name
  FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_customer');
  END IF;

  IF v_handle IS NULL THEN
    LOOP
      v_i := v_i + 1;
      -- 8 caractères hex majuscules (assez court à saisir, ~4 milliards d'espace).
      v_try := upper(substr(encode(extensions.gen_random_bytes(5), 'hex'), 1, 8));
      BEGIN
        UPDATE public.customers SET pay_handle = v_try WHERE id = v_customer;
        v_handle := v_try;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF v_i >= 8 THEN
          RETURN jsonb_build_object('ok', false, 'error', 'handle_gen_failed');
        END IF;
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'handle', v_handle, 'name', v_name);
END;
$$;

-- ============================================================================
-- 5. Résoudre un bénéficiaire par son handle (aperçu avant confirmation)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.coligo_pay_resolve_receiver(p_handle TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sender    UUID;
  v_recipient UUID;
  v_name      TEXT;
BEGIN
  SELECT id INTO v_sender FROM public.customers WHERE user_id = auth.uid();
  IF v_sender IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_customer');
  END IF;

  SELECT id, full_name INTO v_recipient, v_name
  FROM public.customers WHERE pay_handle = upper(btrim(p_handle));
  IF v_recipient IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_recipient = v_sender THEN
    RETURN jsonb_build_object('ok', false, 'error', 'self');
  END IF;

  RETURN jsonb_build_object('ok', true, 'recipient_name', v_name);
END;
$$;

-- ============================================================================
-- 6. EXÉCUTER un transfert (atomique, PIN, anti double-dépense)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.coligo_pay_transfer(
  p_handle TEXT,
  p_amount_da INTEGER,
  p_pin TEXT,
  p_client_operation_id TEXT
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
      (sender_customer_id, recipient_customer_id, amount_da, client_operation_id)
    VALUES (v_sender, v_recipient, p_amount_da, p_client_operation_id)
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
     'Transfert Coligo Pay envoyé à ' || COALESCE(v_rname, 'un ami'), v_transfer);

  INSERT INTO public.customer_wallet_entries
    (customer_id, order_id, type, source, amount_da, note, coligo_pay_transfer_id)
  VALUES
    (v_recipient, NULL, 'transfer_in', 'topup', p_amount_da,
     'Transfert Coligo Pay reçu', v_transfer);

  RETURN jsonb_build_object('ok', true, 'already', false,
    'transfer_id', v_transfer, 'recipient_name', v_rname,
    'amount_da', p_amount_da);
END;
$$;

-- ============================================================================
-- 7. Droits d'exécution
-- ============================================================================
REVOKE ALL ON FUNCTION public.coligo_pay_my_handle() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coligo_pay_resolve_receiver(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coligo_pay_transfer(TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.coligo_pay_my_handle() TO authenticated;
GRANT EXECUTE ON FUNCTION public.coligo_pay_resolve_receiver(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.coligo_pay_transfer(TEXT, INTEGER, TEXT, TEXT) TO authenticated;

-- =============================================================================
-- VÉRIF :
--   SELECT public.coligo_pay_my_handle();                 -- session client
--   SELECT public.coligo_pay_resolve_receiver('ABCD1234');
-- =============================================================================
