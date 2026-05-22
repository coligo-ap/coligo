-- =============================================================================
-- Coligo v3 - Migration 0007 : montants figés sur les commandes
-- =============================================================================
-- Appliquée automatiquement via `npm run db:push` (pooler Supabase).
--
-- Règle métier : on ne recalcule JAMAIS les montants d'une commande déjà créée.
-- On stocke donc des montants figés à la création :
--   - service_fee_da : frais de service (0 pour l'instant)
--   - cashback_da    : cashback accordé (0 pour l'instant)
--   - commission_da  : part Coligo, figée (snapshot)
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN service_fee_da INTEGER NOT NULL DEFAULT 0 CHECK (service_fee_da >= 0),
  ADD COLUMN cashback_da    INTEGER NOT NULL DEFAULT 0 CHECK (cashback_da >= 0),
  ADD COLUMN commission_da  INTEGER NOT NULL DEFAULT 0 CHECK (commission_da >= 0);

-- Backfill : snapshot unique de la commission (5 % du total) sur l'existant.
UPDATE public.orders
SET commission_da = round(total_da * 0.05)
WHERE commission_da = 0;
