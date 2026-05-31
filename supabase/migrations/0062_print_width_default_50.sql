-- =============================================================================
-- Coligo v3 - Migration 0062 : print_width par défaut = 50mm (Sunmi V3)
-- =============================================================================
-- Découverte matérielle : le Sunmi V3 (terminal cible des commerçants Coligo)
-- utilise des rouleaux de papier de 50mm MAX — pas 80mm. Le défaut 80mm
-- (migration 0032) était erroné et expliquait le texte décalé / coupé /
-- mal aligné à l'impression (zone imprimable 384 dots → 32 car., pas 48).
--
-- On élargit le CHECK pour autoriser 50, on passe le DEFAULT à 50, et on
-- migre les lignes existantes (qui étaient restées sur 80/58) vers 50.
-- Le 58 et le 80 restent autorisés pour d'éventuelles imprimantes tierces.
-- =============================================================================

ALTER TABLE public.merchants
  DROP CONSTRAINT IF EXISTS merchants_print_width_check;

ALTER TABLE public.merchants
  ADD CONSTRAINT merchants_print_width_check
  CHECK (print_width IN (50, 58, 80));

ALTER TABLE public.merchants
  ALTER COLUMN print_width SET DEFAULT 50;

UPDATE public.merchants
  SET print_width = 50
  WHERE print_width IN (58, 80);
