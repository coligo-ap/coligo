-- =============================================================================
-- Coligo v3 - Migration 0084 : Paiement QR Coligo Pay en magasin (argent réel)
-- =============================================================================
-- ⚠️ ARGENT RÉEL — sécurité maximale. Le client paie un COMMERÇANT Coligo en
-- magasin avec son solde Coligo Pay (topup). PÉRIMÈTRE : paiement marchand
-- UNIQUEMENT (P2P entre particuliers GELÉ : licence Banque d'Algérie + KYC/AML).
--
-- Garde-fous (tous obligatoires) :
--   1. CODE PIN Coligo Pay (4 chiffres) HASHÉ (pgcrypto bcrypt) — jamais stocké
--      ni transmis en clair. Anti-brute-force : verrouillage après N essais.
--   2. Le commerçant génère une DEMANDE de paiement (montant figé) → un TOKEN
--      opaque, à USAGE UNIQUE et qui EXPIRE. Le QR encode ce token, jamais un
--      secret sensible ni un montant modifiable par le client.
--   3. Le paiement s'EXÉCUTE côté serveur (SECURITY DEFINER) en UNE transaction
--      atomique : vérif PIN → verrou demande → verrou anti double-dépense par
--      client → contrôle solde → écritures ledger (client −, marchand +vente
--      −commission, plateforme +commission) → demande consommée.
--   4. IDEMPOTENCE : `client_operation_id` UNIQUE par paiement (rejeu réseau
--      sans double débit). Demande consommée = ne peut servir 2 fois.
--   5. RLS : tables verrouillées (deny-all direct) ; tout passe par les
--      fonctions DEFINER. Les ledgers restent append-only en lecture seule.
--
-- Modèle d'encaissement (cf. décision produit) : ENCAISSEMENT DIRECT — crédit
-- instantané du wallet marchand (vente − commission), comme une vente complétée,
-- SANS flux commande/préparation (order_id NULL ; idempotence par payment_id).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ============================================================================
-- 1. PIN Coligo Pay (hashé) — identification au paiement
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.customer_wallet_security (
  customer_id     UUID PRIMARY KEY
                    REFERENCES public.customers(id) ON DELETE CASCADE,
  pin_hash        TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_wallet_security ENABLE ROW LEVEL SECURITY;
-- AUCUNE policy : accès direct interdit (le hash ne doit JAMAIS transiter par
-- l'API). Tout passe par les fonctions SECURITY DEFINER ci-dessous.

-- ============================================================================
-- 2. Demandes de paiement (générées par le commerçant) — token usage unique
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.coligo_pay_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,
  amount_da     INTEGER NOT NULL CHECK (amount_da > 0),
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'consumed', 'cancelled')),
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_by   UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  payment_id    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cpr_merchant
  ON public.coligo_pay_requests(merchant_id, created_at DESC);

ALTER TABLE public.coligo_pay_requests ENABLE ROW LEVEL SECURITY;

-- Le commerçant LIT ses propres demandes (pour le polling « payé ? »).
DROP POLICY IF EXISTS "cpr_select_own_merchant" ON public.coligo_pay_requests;
CREATE POLICY "cpr_select_own_merchant" ON public.coligo_pay_requests
  FOR SELECT USING (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  );
-- Pas d'INSERT/UPDATE/DELETE direct : création via coligo_pay_create_request,
-- résolution/consommation via les fonctions DEFINER. Le client ne lit JAMAIS
-- la table directement (il ne connaît que le token, résolu via fonction).

-- ============================================================================
-- 3. Paiements exécutés (source de vérité + idempotence)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.coligo_pay_payments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id           UUID REFERENCES public.coligo_pay_requests(id)
                         ON DELETE SET NULL,
  customer_id          UUID NOT NULL REFERENCES public.customers(id)
                         ON DELETE CASCADE,
  merchant_id          UUID NOT NULL REFERENCES public.merchants(id)
                         ON DELETE CASCADE,
  amount_da            INTEGER NOT NULL CHECK (amount_da > 0),
  commission_rate      NUMERIC(5, 4) NOT NULL,
  commission_da        INTEGER NOT NULL CHECK (commission_da >= 0),
  net_da               INTEGER NOT NULL CHECK (net_da >= 0),
  client_operation_id  TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Idempotence : un même client ne rejoue pas une opération (double-tap,
  -- retry réseau) → un seul paiement.
  CONSTRAINT cpp_client_op_unique UNIQUE (customer_id, client_operation_id)
);

CREATE INDEX IF NOT EXISTS idx_cpp_customer
  ON public.coligo_pay_payments(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cpp_merchant
  ON public.coligo_pay_payments(merchant_id, created_at DESC);

ALTER TABLE public.coligo_pay_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cpp_select_own_customer" ON public.coligo_pay_payments;
CREATE POLICY "cpp_select_own_customer" ON public.coligo_pay_payments
  FOR SELECT USING (
    customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "cpp_select_own_merchant" ON public.coligo_pay_payments;
CREATE POLICY "cpp_select_own_merchant" ON public.coligo_pay_payments
  FOR SELECT USING (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  );

-- ============================================================================
-- 4. Liens d'idempotence sur les ledgers existants (paiement sans order_id)
-- ============================================================================
ALTER TABLE public.customer_wallet_entries
  ADD COLUMN IF NOT EXISTS coligo_pay_payment_id UUID
    REFERENCES public.coligo_pay_payments(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cwe_pay_payment
  ON public.customer_wallet_entries(coligo_pay_payment_id)
  WHERE coligo_pay_payment_id IS NOT NULL;

ALTER TABLE public.wallet_entries
  ADD COLUMN IF NOT EXISTS coligo_pay_payment_id UUID
    REFERENCES public.coligo_pay_payments(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_we_pay_payment_type
  ON public.wallet_entries(coligo_pay_payment_id, type)
  WHERE coligo_pay_payment_id IS NOT NULL;

ALTER TABLE public.platform_ledger
  ADD COLUMN IF NOT EXISTS coligo_pay_payment_id UUID
    REFERENCES public.coligo_pay_payments(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pl_pay_payment_type
  ON public.platform_ledger(coligo_pay_payment_id, type)
  WHERE coligo_pay_payment_id IS NOT NULL;

-- ============================================================================
-- 5. PIN : définir / changer (4 chiffres, hashé bcrypt)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.coligo_pay_set_pin(p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_customer UUID;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_customer');
  END IF;
  IF p_pin !~ '^[0-9]{4}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
  END IF;

  INSERT INTO public.customer_wallet_security
    (customer_id, pin_hash, failed_attempts, locked_until, updated_at)
  VALUES
    (v_customer, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
     0, NULL, now())
  ON CONFLICT (customer_id) DO UPDATE
    SET pin_hash        = EXCLUDED.pin_hash,
        failed_attempts = 0,
        locked_until    = NULL,
        updated_at      = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ============================================================================
-- 6. PIN : statut (défini ? verrouillé ?) — sans exposer le hash
-- ============================================================================
CREATE OR REPLACE FUNCTION public.coligo_pay_pin_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer UUID;
  v_row      public.customer_wallet_security%ROWTYPE;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_customer');
  END IF;

  SELECT * INTO v_row FROM public.customer_wallet_security
  WHERE customer_id = v_customer;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'has_pin', false, 'locked', false);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'has_pin', true,
    'locked', (v_row.locked_until IS NOT NULL AND v_row.locked_until > now()),
    'locked_until', v_row.locked_until
  );
END;
$$;

-- ============================================================================
-- 7. PIN : vérification interne (lockout + bcrypt) — réutilisée au paiement
--    Retour : 'ok' | 'wrong' | 'locked' | 'not_set'. Met à jour les compteurs.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.coligo_pay_pin_check_internal(
  p_customer UUID,
  p_pin TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_row     public.customer_wallet_security%ROWTYPE;
  v_max     CONSTANT INTEGER := 5;       -- essais avant verrouillage
  v_lock    CONSTANT INTERVAL := INTERVAL '15 minutes';
BEGIN
  -- Verrou par client pour sérialiser les tentatives concurrentes.
  PERFORM pg_advisory_xact_lock(hashtext('cpp_pin:' || p_customer::text));

  SELECT * INTO v_row FROM public.customer_wallet_security
  WHERE customer_id = p_customer
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_set';
  END IF;

  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN
    RETURN 'locked';
  END IF;

  IF extensions.crypt(p_pin, v_row.pin_hash) = v_row.pin_hash THEN
    UPDATE public.customer_wallet_security
    SET failed_attempts = 0, locked_until = NULL, updated_at = now()
    WHERE customer_id = p_customer;
    RETURN 'ok';
  END IF;

  -- Échec : incrémente, verrouille si seuil atteint.
  IF v_row.failed_attempts + 1 >= v_max THEN
    UPDATE public.customer_wallet_security
    SET failed_attempts = 0, locked_until = now() + v_lock, updated_at = now()
    WHERE customer_id = p_customer;
    RETURN 'locked';
  ELSE
    UPDATE public.customer_wallet_security
    SET failed_attempts = v_row.failed_attempts + 1, updated_at = now()
    WHERE customer_id = p_customer;
    RETURN 'wrong';
  END IF;
END;
$$;

-- ============================================================================
-- 8. PIN : vérification publique (déverrouillage écran wallet)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.coligo_pay_verify_pin(p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer UUID;
  v_res      TEXT;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_customer');
  END IF;
  IF p_pin !~ '^[0-9]{4}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wrong');
  END IF;

  v_res := public.coligo_pay_pin_check_internal(v_customer, p_pin);
  IF v_res = 'ok' THEN
    RETURN jsonb_build_object('ok', true);
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', v_res);
END;
$$;

-- ============================================================================
-- 9. Commerçant : créer une demande de paiement (token fourni par le serveur)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.coligo_pay_create_request(
  p_token TEXT,
  p_amount_da INTEGER,
  p_ttl_seconds INTEGER DEFAULT 900
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_merchant UUID;
  v_id       UUID;
  v_exp      TIMESTAMPTZ;
BEGIN
  SELECT id INTO v_merchant FROM public.merchants WHERE user_id = auth.uid();
  IF v_merchant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_merchant');
  END IF;
  IF p_amount_da IS NULL OR p_amount_da <= 0 OR p_amount_da > 1000000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;
  IF p_token IS NULL OR length(p_token) < 12 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  v_exp := now() + make_interval(secs => GREATEST(60, LEAST(p_ttl_seconds, 3600)));

  INSERT INTO public.coligo_pay_requests
    (merchant_id, token, amount_da, status, expires_at)
  VALUES (v_merchant, p_token, p_amount_da, 'active', v_exp)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'expires_at', v_exp);
END;
$$;

-- ============================================================================
-- 10. Client : résoudre un token (aperçu avant confirmation) — read-only
-- ============================================================================
CREATE OR REPLACE FUNCTION public.coligo_pay_resolve_request(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer UUID;
  v_req      public.coligo_pay_requests%ROWTYPE;
  v_mname    TEXT;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_customer');
  END IF;

  SELECT * INTO v_req FROM public.coligo_pay_requests WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_req.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'used');
  END IF;
  IF v_req.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  SELECT name INTO v_mname FROM public.merchants WHERE id = v_req.merchant_id;

  RETURN jsonb_build_object(
    'ok', true,
    'merchant_id', v_req.merchant_id,
    'merchant_name', v_mname,
    'amount_da', v_req.amount_da,
    'expires_at', v_req.expires_at
  );
END;
$$;

-- ============================================================================
-- 11. Client : EXÉCUTER le paiement (atomique, PIN, anti double-dépense)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.coligo_pay_execute(
  p_token TEXT,
  p_pin TEXT,
  p_client_operation_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer   UUID;
  v_req        public.coligo_pay_requests%ROWTYPE;
  v_existing   public.coligo_pay_payments%ROWTYPE;
  v_pin        TEXT;
  v_balance    INTEGER;
  v_rate       NUMERIC(5, 4);
  v_commission INTEGER;
  v_net        INTEGER;
  v_payment    UUID;
  v_mname      TEXT;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_customer');
  END IF;
  IF p_client_operation_id IS NULL OR length(p_client_operation_id) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_operation');
  END IF;

  -- (a) IDEMPOTENCE : si l'opération existe déjà, on renvoie son résultat.
  SELECT * INTO v_existing FROM public.coligo_pay_payments
  WHERE customer_id = v_customer AND client_operation_id = p_client_operation_id;
  IF FOUND THEN
    SELECT name INTO v_mname FROM public.merchants WHERE id = v_existing.merchant_id;
    RETURN jsonb_build_object(
      'ok', true, 'already', true,
      'payment_id', v_existing.id,
      'merchant_name', v_mname,
      'amount_da', v_existing.amount_da,
      'created_at', v_existing.created_at
    );
  END IF;

  -- (b) PIN obligatoire.
  v_pin := public.coligo_pay_pin_check_internal(v_customer, p_pin);
  IF v_pin <> 'ok' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pin_' || v_pin);
  END IF;

  -- (c) Verrou + validation de la demande (usage unique, non expirée).
  SELECT * INTO v_req FROM public.coligo_pay_requests
  WHERE token = p_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_req.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'used');
  END IF;
  IF v_req.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  -- (d) Anti double-dépense : même verrou que les dépenses sur commande (0070).
  PERFORM pg_advisory_xact_lock(hashtext('cwe_spend:' || v_customer::text));

  SELECT public.customer_topup_balance(v_customer) INTO v_balance;
  IF v_balance < v_req.amount_da THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient',
      'balance', v_balance, 'amount', v_req.amount_da);
  END IF;

  -- (e) Snapshot commission marchand.
  SELECT COALESCE(commission_rate, 0.05), name
    INTO v_rate, v_mname
  FROM public.merchants WHERE id = v_req.merchant_id;
  v_commission := round(v_req.amount_da * v_rate)::INTEGER;
  v_net        := v_req.amount_da - v_commission;

  -- (f) Paiement (source de vérité). L'UNIQUE (customer, op) re-protège contre
  --     les courses : en cas de doublon, 23505 → on relit et renvoie le résultat.
  BEGIN
    INSERT INTO public.coligo_pay_payments
      (request_id, customer_id, merchant_id, amount_da,
       commission_rate, commission_da, net_da, client_operation_id)
    VALUES
      (v_req.id, v_customer, v_req.merchant_id, v_req.amount_da,
       v_rate, v_commission, v_net, p_client_operation_id)
    RETURNING id INTO v_payment;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing FROM public.coligo_pay_payments
    WHERE customer_id = v_customer
      AND client_operation_id = p_client_operation_id;
    RETURN jsonb_build_object(
      'ok', true, 'already', true,
      'payment_id', v_existing.id,
      'merchant_name', v_mname,
      'amount_da', v_existing.amount_da,
      'created_at', v_existing.created_at
    );
  END;

  -- (g) Ledger CLIENT : débit topup (−montant).
  INSERT INTO public.customer_wallet_entries
    (customer_id, order_id, type, source, amount_da, note, coligo_pay_payment_id)
  VALUES
    (v_customer, NULL, 'topup_spent', 'topup', -v_req.amount_da,
     'Paiement Coligo Pay — ' || COALESCE(v_mname, 'commerçant'), v_payment);

  -- (h) Ledger MARCHAND : vente (+montant) et commission (−commission, figée).
  INSERT INTO public.wallet_entries
    (merchant_id, order_id, type, amount_da, coligo_pay_payment_id)
  VALUES (v_req.merchant_id, NULL, 'sale', v_req.amount_da, v_payment);

  IF v_commission > 0 THEN
    INSERT INTO public.wallet_entries
      (merchant_id, order_id, type, amount_da, commission_rate, coligo_pay_payment_id)
    VALUES (v_req.merchant_id, NULL, 'commission', -v_commission, v_rate, v_payment);

    -- (i) Ledger PLATEFORME : revenu de commission.
    INSERT INTO public.platform_ledger
      (order_id, type, amount_da, coligo_pay_payment_id)
    VALUES (NULL, 'commission_income', v_commission, v_payment);
  END IF;

  -- (j) Demande consommée (usage unique).
  UPDATE public.coligo_pay_requests
  SET status = 'consumed', consumed_by = v_customer, payment_id = v_payment
  WHERE id = v_req.id;

  RETURN jsonb_build_object(
    'ok', true, 'already', false,
    'payment_id', v_payment,
    'merchant_name', v_mname,
    'amount_da', v_req.amount_da,
    'created_at', now()
  );
END;
$$;

-- ============================================================================
-- 12. Droits d'exécution (authenticated suffit ; le rôle est vérifié dedans)
-- ============================================================================
REVOKE ALL ON FUNCTION public.coligo_pay_set_pin(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coligo_pay_verify_pin(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coligo_pay_pin_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coligo_pay_create_request(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coligo_pay_resolve_request(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coligo_pay_execute(TEXT, TEXT, TEXT) FROM PUBLIC;
-- L'usage interne ne doit pas être appelable directement par les clients API.
REVOKE ALL ON FUNCTION public.coligo_pay_pin_check_internal(UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.coligo_pay_set_pin(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.coligo_pay_verify_pin(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.coligo_pay_pin_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.coligo_pay_create_request(TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.coligo_pay_resolve_request(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.coligo_pay_execute(TEXT, TEXT, TEXT) TO authenticated;

-- =============================================================================
-- VÉRIF :
--   SELECT public.coligo_pay_pin_status();          -- en session client
--   SELECT public.coligo_pay_create_request('TESTTOKEN1234', 500, 900); -- marchand
-- =============================================================================
