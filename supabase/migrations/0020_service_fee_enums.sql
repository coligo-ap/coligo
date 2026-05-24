-- =============================================================================
-- Coligo v3 - Migration 0020 : ENUMS service_fee (transaction séparée)
-- =============================================================================
-- Postgres interdit d'utiliser une valeur d'enum dans la même transaction que
-- celle qui l'ajoute. On isole donc l'ALTER TYPE ici ; la logique métier qui
-- consomme ces valeurs est dans 0021.
--
-- Modèle :
--   - `service_fee_owed`     : écriture wallet commerçant — DETTE des frais
--                              de service encaissés en espèces par lui.
--   - `service_fee_income`   : écriture platform_ledger — REVENU plateforme
--                              sur les frais de service (online ET cash).
-- =============================================================================

ALTER TYPE public.wallet_entry_type ADD VALUE IF NOT EXISTS 'service_fee_owed';
ALTER TYPE public.platform_ledger_type ADD VALUE IF NOT EXISTS 'service_fee_income';
