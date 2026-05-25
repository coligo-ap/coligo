-- =============================================================================
-- Coligo v3 - Migration 0032 : print_width par défaut = 80mm (Sunmi V3)
-- =============================================================================
-- Contexte : le Sunmi V3 (terminal cible des commerçants Coligo) n'accepte
-- QUE des rouleaux de 80mm de largeur. Le défaut historique (58mm, migration
-- 0011) datait d'avant la décision matérielle.
--
-- On passe le DEFAULT à 80 ET on migre les lignes existantes qui étaient
-- restées sur 58 (commerçants créés avant cette décision qui n'ont jamais
-- ajusté manuellement leur réglage). Le 58 reste autorisé par le CHECK pour
-- les éventuelles imprimantes tierces.
-- =============================================================================

ALTER TABLE public.merchants
  ALTER COLUMN print_width SET DEFAULT 80;

UPDATE public.merchants
  SET print_width = 80
  WHERE print_width = 58;
