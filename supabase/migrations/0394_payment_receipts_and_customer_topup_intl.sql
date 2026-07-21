-- =============================================================================
-- 0394 — Reçus de paiement (traçabilité client) + recharge Coligo Pay en € (client)
-- =============================================================================
-- PARTIE 1 — `payment_receipts` : ce qui a RÉELLEMENT payé une commande ou une
-- course. Aujourd'hui l'information est éparpillée (orders.payment_status,
-- rides.online_paid_at, chargily_checkout_id, intl_payment_sessions) et la
-- MARQUE + les 4 DERNIERS CHIFFRES de la carte ne sont stockés nulle part : le
-- client ne peut pas savoir avec quelle carte il a payé. Une ligne par
-- paiement, écrite par les webhooks (seule source de vérité).
--
-- Données volontairement NON sensibles : jamais de PAN, jamais de CVC, jamais
-- de token réutilisable. Marque (« visa »), 4 derniers chiffres, portefeuille
-- (apple_pay / google_pay) et méthode locale (cib / edahabia) suffisent à la
-- reconnaissance par le client et sont autorisés en clair (PCI-DSS : le last4
-- n'est pas une donnée de compte protégée).
--
-- PARTIE 2 — le rail € accepte une 4ᵉ cible : la recharge du portefeuille
-- CLIENT (jusqu'ici Chargily seul). La contrainte « exactement une cible » de
-- `intl_payment_sessions` passe donc de 3 à 4.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Reçus
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_receipts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  kind         text NOT NULL CHECK (kind IN ('order','ride','topup')),
  order_id     uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  ride_id      uuid REFERENCES public.rides(id)  ON DELETE CASCADE,
  provider     text NOT NULL CHECK (provider IN ('stripe','chargily')),
  /** payment_intent Stripe ou checkout Chargily — clé d'idempotence. */
  external_id  text NOT NULL,
  status       text NOT NULL CHECK (status IN ('paid','failed','refunded')),
  amount_da    integer NOT NULL CHECK (amount_da > 0),
  /** Rail € seulement : ce qui a été DÉBITÉ en euros (le taux reste interne). */
  eur_cents    integer CHECK (eur_cents IS NULL OR eur_cents > 0),
  card_brand   text,
  card_last4   text CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
  /** 'apple_pay' | 'google_pay' | NULL (carte saisie). */
  wallet       text,
  /** 'cib' | 'edahabia' | 'card' — moyen local côté Chargily. */
  method       text,
  paid_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payment_receipt UNIQUE (provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_receipts_customer
  ON public.payment_receipts (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_order
  ON public.payment_receipts (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_receipts_ride
  ON public.payment_receipts (ride_id) WHERE ride_id IS NOT NULL;

ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;

-- Le client LIT ses propres reçus. Aucune policy d'écriture : seuls les
-- webhooks (service_role) écrivent — un client ne peut pas fabriquer la preuve
-- d'un paiement.
DROP POLICY IF EXISTS payment_receipts_own_select ON public.payment_receipts;
CREATE POLICY payment_receipts_own_select ON public.payment_receipts
  FOR SELECT TO authenticated
  USING (
    customer_id IN (
      SELECT c.id FROM public.customers c WHERE c.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 2) Écriture idempotente depuis les webhooks (service_role uniquement)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_payment_receipt(
  p_kind text,
  p_provider text,
  p_external_id text,
  p_status text,
  p_amount_da integer,
  p_customer_id uuid DEFAULT NULL,
  p_order_id uuid DEFAULT NULL,
  p_ride_id uuid DEFAULT NULL,
  p_eur_cents integer DEFAULT NULL,
  p_card_brand text DEFAULT NULL,
  p_card_last4 text DEFAULT NULL,
  p_wallet text DEFAULT NULL,
  p_method text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.payment_receipts (
    customer_id, kind, order_id, ride_id, provider, external_id, status,
    amount_da, eur_cents, card_brand, card_last4, wallet, method, paid_at
  ) VALUES (
    p_customer_id, p_kind, p_order_id, p_ride_id, p_provider, p_external_id,
    p_status, p_amount_da, p_eur_cents, p_card_brand,
    NULLIF(regexp_replace(COALESCE(p_card_last4,''), '[^0-9]', '', 'g'), ''),
    p_wallet, p_method,
    CASE WHEN p_status = 'paid' THEN now() ELSE NULL END
  )
  -- Rejeu de webhook : on ne duplique pas, mais un échec suivi d'un succès
  -- (même PaymentIntent) doit bien finir en 'paid', et les détails carte
  -- n'arrivent parfois qu'au second passage → on complète sans jamais écraser
  -- une valeur connue par un NULL.
  ON CONFLICT (provider, external_id) DO UPDATE SET
    status     = EXCLUDED.status,
    amount_da  = EXCLUDED.amount_da,
    eur_cents  = COALESCE(EXCLUDED.eur_cents,  public.payment_receipts.eur_cents),
    card_brand = COALESCE(EXCLUDED.card_brand, public.payment_receipts.card_brand),
    card_last4 = COALESCE(EXCLUDED.card_last4, public.payment_receipts.card_last4),
    wallet     = COALESCE(EXCLUDED.wallet,     public.payment_receipts.wallet),
    method     = COALESCE(EXCLUDED.method,     public.payment_receipts.method),
    paid_at    = COALESCE(public.payment_receipts.paid_at, EXCLUDED.paid_at);
END;
$$;
REVOKE ALL ON FUNCTION public.record_payment_receipt(
  text, text, text, text, integer, uuid, uuid, uuid, integer, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment_receipt(
  text, text, text, text, integer, uuid, uuid, uuid, integer, text, text, text, text
) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Rail € : 4ᵉ cible = recharge du portefeuille CLIENT
-- ---------------------------------------------------------------------------
ALTER TABLE public.intl_payment_sessions
  ADD COLUMN IF NOT EXISTS topup_customer_id uuid REFERENCES public.customers(id);

ALTER TABLE public.intl_payment_sessions
  DROP CONSTRAINT IF EXISTS chk_intl_session_one_target;
ALTER TABLE public.intl_payment_sessions
  ADD CONSTRAINT chk_intl_session_one_target CHECK (
    (order_id IS NOT NULL)::integer
    + (ride_id IS NOT NULL)::integer
    + (operator_wallet_id IS NOT NULL)::integer
    + (topup_customer_id IS NOT NULL)::integer = 1
  );
