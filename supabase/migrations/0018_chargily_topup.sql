-- =============================================================================
-- Coligo v3 - Migration 0018 : ENUM topup (Coligo Pay) — prompt 18 / étape B
-- =============================================================================
-- Postgres interdit d'utiliser une valeur d'enum dans la même transaction
-- que celle qui l'a ajoutée. On isole donc l'ALTER TYPE dans sa propre
-- migration ; le reste (tables/triggers/fonctions qui consomment les
-- nouvelles valeurs) est dans 0019.
-- =============================================================================

ALTER TYPE public.customer_wallet_entry_type ADD VALUE IF NOT EXISTS 'topup_credit';
ALTER TYPE public.customer_wallet_entry_type ADD VALUE IF NOT EXISTS 'topup_spent';
