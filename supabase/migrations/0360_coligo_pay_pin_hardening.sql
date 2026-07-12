-- =============================================================================
-- Coligo v3 - Migration 0360 : durcissement du PIN Coligo Pay client
-- =============================================================================
-- Problème vécu : l'UI redemandait « créer un PIN » (props RSC périmées /
-- erreur RPC traitée comme « pas de PIN ») et coligo_pay_set_pin ÉCRASAIT
-- silencieusement le PIN existant — n'importe quelle session authentifiée
-- pouvait remplacer le PIN sans connaître l'ancien (vol de téléphone déverrouillé
-- = wallet vidé après un simple « nouveau PIN »).
--
-- Règles après cette migration :
--   1. Un PIN ne se CRÉE que s'il n'en existe pas.
--   2. Un PIN existant ne se CHANGE qu'avec l'ANCIEN PIN (mêmes compteurs de
--      verrouillage que la vérification : 5 échecs → 15 min).
--   3. L'OUBLI passe par la preuve de l'email (code OTP envoyé à l'adresse du
--      compte, vérifié par l'action serveur) puis coligo_pay_service_reset_pin,
--      exécutable UNIQUEMENT par service_role — jamais par le client.
--   4. Chaque opération est journalisée (pin_set / pin_changed / pin_reset)
--      DANS la même transaction SQL.
-- =============================================================================

-- ============================================================================
-- 1. Événement 'pin_reset' accepté dans le journal de sécurité
-- ============================================================================
ALTER TABLE public.customer_security_events
  DROP CONSTRAINT IF EXISTS customer_security_events_event_check;
ALTER TABLE public.customer_security_events
  ADD CONSTRAINT customer_security_events_event_check CHECK (event IN (
    'pin_set', 'pin_changed', 'pin_reset', 'email_changed', 'phone_changed'
  ));

-- ============================================================================
-- 2. set_pin durci : création libre, changement SEULEMENT avec l'ancien PIN
-- ============================================================================
DROP FUNCTION IF EXISTS public.coligo_pay_set_pin(TEXT);

CREATE OR REPLACE FUNCTION public.coligo_pay_set_pin(
  p_pin         TEXT,
  p_current_pin TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_customer UUID;
  v_row      public.customer_wallet_security%ROWTYPE;
  v_check    TEXT;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_customer');
  END IF;
  IF p_pin !~ '^[0-9]{4}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
  END IF;

  -- Même verrou que la vérification (réentrant dans la transaction) :
  -- sérialise créations/changements/tentatives concurrents.
  PERFORM pg_advisory_xact_lock(hashtext('cpp_pin:' || v_customer::text));

  SELECT * INTO v_row FROM public.customer_wallet_security
  WHERE customer_id = v_customer
  FOR UPDATE;

  IF NOT FOUND THEN
    -- CRÉATION (première fois) — libre.
    INSERT INTO public.customer_wallet_security
      (customer_id, pin_hash, failed_attempts, locked_until, updated_at)
    VALUES
      (v_customer, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
       0, NULL, now());
    INSERT INTO public.customer_security_events (customer_id, event)
    VALUES (v_customer, 'pin_set');
    RETURN jsonb_build_object('ok', true, 'created', true);
  END IF;

  -- CHANGEMENT : l'ancien PIN est OBLIGATOIRE.
  IF p_current_pin IS NULL OR p_current_pin = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pin_exists');
  END IF;

  -- Vérification de l'ancien PIN avec les MÊMES compteurs/verrouillage que la
  -- vérification de paiement (anti-bruteforce partagé).
  v_check := public.coligo_pay_pin_check_internal(v_customer, p_current_pin);
  IF v_check <> 'ok' THEN
    RETURN jsonb_build_object('ok', false, 'error',
      CASE v_check WHEN 'locked' THEN 'pin_locked' ELSE 'pin_wrong' END);
  END IF;

  UPDATE public.customer_wallet_security
  SET pin_hash        = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
      failed_attempts = 0,
      locked_until    = NULL,
      updated_at      = now()
  WHERE customer_id = v_customer;

  INSERT INTO public.customer_security_events (customer_id, event)
  VALUES (v_customer, 'pin_changed');

  RETURN jsonb_build_object('ok', true, 'created', false);
END;
$$;

REVOKE ALL ON FUNCTION public.coligo_pay_set_pin(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coligo_pay_set_pin(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.coligo_pay_set_pin(TEXT, TEXT) TO authenticated;

-- ============================================================================
-- 3. Réinitialisation par le SERVEUR seul (après preuve email OTP côté action)
-- ============================================================================
-- ⚠️ EXECUTE réservé à service_role : si `authenticated` pouvait l'appeler,
-- n'importe quelle session volée réinitialiserait le PIN SANS accès à l'email
-- — tout l'intérêt du flux de récupération tomberait.
CREATE OR REPLACE FUNCTION public.coligo_pay_service_reset_pin(
  p_user_id UUID,
  p_new_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_customer UUID;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = p_user_id;
  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_customer');
  END IF;
  IF p_new_pin !~ '^[0-9]{4}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('cpp_pin:' || v_customer::text));

  -- Remplace le PIN et LÈVE tout verrouillage (le client a prouvé son email).
  INSERT INTO public.customer_wallet_security
    (customer_id, pin_hash, failed_attempts, locked_until, updated_at)
  VALUES
    (v_customer, extensions.crypt(p_new_pin, extensions.gen_salt('bf', 10)),
     0, NULL, now())
  ON CONFLICT (customer_id) DO UPDATE
    SET pin_hash        = EXCLUDED.pin_hash,
        failed_attempts = 0,
        locked_until    = NULL,
        updated_at      = now();

  INSERT INTO public.customer_security_events (customer_id, event)
  VALUES (v_customer, 'pin_reset');

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.coligo_pay_service_reset_pin(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coligo_pay_service_reset_pin(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.coligo_pay_service_reset_pin(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.coligo_pay_service_reset_pin(UUID, TEXT) TO service_role;

-- ============================================================================
-- 4. Throttle du flux de récupération (envois d'emails + essais de code)
-- ============================================================================
-- Accès service_role UNIQUEMENT (RLS activée sans policy) — l'action serveur
-- lit/écrit via createAdminClient, le client n'y touche jamais.
CREATE TABLE IF NOT EXISTS public.pin_reset_throttle (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  fails         INTEGER NOT NULL DEFAULT 0,
  lock_level    INTEGER NOT NULL DEFAULT 0,
  locked_until  TIMESTAMPTZ,
  sends_window  TIMESTAMPTZ,
  sends_count   INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.pin_reset_throttle ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- VÉRIFICATION (SQL Editor) :
--   SELECT public.coligo_pay_set_pin('1234');            -- crée si absent
--   SELECT public.coligo_pay_set_pin('5678');            -- → pin_exists
--   SELECT public.coligo_pay_set_pin('5678', '1234');    -- → ok (changed)
--   SELECT public.coligo_pay_service_reset_pin(auth.uid(), '0000');
--     -- en session client : permission denied (service_role seul)
-- =============================================================================
