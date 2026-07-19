-- =============================================================================
-- 0389 — Recharge Coligo Pay (portefeuille opérateur) par CARTE INTERNATIONALE €
-- =============================================================================
-- Nouveau moyen de recharge du portefeuille opérateur (livreur / chauffeur /
-- commerçant / agent), à côté de Carte CIB (Chargily) / CCP / Espèces : la
-- carte internationale via Stripe (diaspora / cartes étrangères). Piloté par le
-- super-admin comme les autres domaines € :
--   - interrupteur `enabled_wallet` (OFF par défaut — nouveauté) ;
--   - le kill-switch global `enabled` reste maître ;
--   - montant borné par `operator_topup_max_da` (déjà éditable admin) ;
--   - pays autorisés + taux maison partagés avec le rail diaspora.
--
-- Le crédit réutilise `credit_operator_topup_chargily` (idempotent sur l'id du
-- paiement) : un paiement Stripe passe l'`payment_intent` comme identifiant.
-- =============================================================================

ALTER TABLE public.intl_payment_settings
  ADD COLUMN IF NOT EXISTS enabled_wallet boolean NOT NULL DEFAULT false;

-- Session Stripe rattachée à un PORTEFEUILLE opérateur (nouvelle cible).
ALTER TABLE public.intl_payment_sessions
  ADD COLUMN IF NOT EXISTS operator_wallet_id uuid REFERENCES public.operator_wallets(id);

-- customer_id devient optionnel (une recharge portefeuille n'a pas de client).
ALTER TABLE public.intl_payment_sessions
  ALTER COLUMN customer_id DROP NOT NULL;

-- Exactement UNE cible : commande OU course OU portefeuille opérateur.
ALTER TABLE public.intl_payment_sessions
  DROP CONSTRAINT IF EXISTS chk_intl_session_one_target;
ALTER TABLE public.intl_payment_sessions
  ADD CONSTRAINT chk_intl_session_one_target CHECK (
    (order_id IS NOT NULL)::int
    + (ride_id IS NOT NULL)::int
    + (operator_wallet_id IS NOT NULL)::int = 1
  );

CREATE INDEX IF NOT EXISTS idx_intl_sessions_op_wallet
  ON public.intl_payment_sessions (operator_wallet_id)
  WHERE operator_wallet_id IS NOT NULL;
