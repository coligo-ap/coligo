-- =============================================================================
-- Coligo v3 - Migration 0011 : Réglages d'impression du ticket de commande
-- =============================================================================
-- Ajoute les préférences d'impression directement sur `merchants` (un
-- commerçant = une caisse). Pas de nouvelle table : les réglages sont 1:1 avec
-- la boutique et la RLS `merchants_update_own` (0001) couvre déjà l'écriture.
--
-- Champs :
--   - auto_accept_orders : passe les commandes `pending` en `preparing` dès
--     leur arrivée côté client (logique branchée dans le bridge Realtime).
--   - auto_print : 'off' | 'on_receive' | 'on_accept' — quand imprimer.
--   - print_copies : 1 → 3 exemplaires (sac client / cuisine / souche).
--   - print_width  : 58 ou 80 mm (Sunmi V2/V3 = 58 ; comptoir = 80).
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE public.auto_print_mode AS ENUM ('off', 'on_receive', 'on_accept');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS auto_accept_orders BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_print public.auto_print_mode NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS print_copies INTEGER NOT NULL DEFAULT 1
    CHECK (print_copies BETWEEN 1 AND 3),
  ADD COLUMN IF NOT EXISTS print_width INTEGER NOT NULL DEFAULT 58
    CHECK (print_width IN (58, 80));

-- Pas besoin de policy supplémentaire : `merchants_update_own` autorise déjà
-- le commerçant à modifier sa propre ligne (donc ses propres réglages).
