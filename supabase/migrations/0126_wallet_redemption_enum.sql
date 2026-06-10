-- =============================================================================
-- 0126 — Type d'écriture « wallet_redemption » (préalable à 0127)
-- =============================================================================
-- Quand un client paie une commande CASH (retrait ou tournée) partiellement en
-- cashback / Coligo Pay, il remet moins d'espèces au commerçant. La plateforme
-- doit alors REVERSER ce montant au commerçant (« payé en cashback comme du vrai
-- argent ») : elle détient le Coligo Pay et a provisionné le cashback. On trace
-- ce reversement par une écriture wallet dédiée. (Valeur d'enum ajoutée séparément
-- de son utilisation — règle Postgres.)
-- =============================================================================

ALTER TYPE public.wallet_entry_type ADD VALUE IF NOT EXISTS 'wallet_redemption';
