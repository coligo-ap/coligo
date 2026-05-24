-- =============================================================================
-- Coligo v3 - Migration 0025 : raison d'échec paiement (UX)
-- =============================================================================
-- Stocke une raison HUMAINE pour les paiements en ligne ratés, lue depuis le
-- webhook Chargily (events checkout.failed / checkout.canceled). Affichée
-- côté client sur /checkout/failure pour qu'il comprenne sans message
-- technique (solde insuffisant, carte refusée, abandon, etc.).
--
-- Codes (libres, alignés sur ce que Chargily peut renvoyer) :
--   - "insufficient_funds"  → "Solde insuffisant sur la carte."
--   - "card_declined"       → "Ta carte a été refusée par la banque."
--   - "canceled"            → "Tu as annulé le paiement avant de valider."
--   - "expired"             → "Le lien de paiement a expiré."
--   - "unknown"             → message générique
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_failure_reason TEXT;
