-- =============================================================================
-- 0064 — Nom du responsable du commerce (collecté à l'inscription)
-- =============================================================================
-- À l'inscription, on demande désormais le nom et prénom du responsable (en
-- plus du nom du commerce), ainsi que la position EXACTE sur la carte
-- (latitude/longitude existent déjà). Cette colonne stocke le contact référent.
-- =============================================================================

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS manager_name TEXT;

COMMENT ON COLUMN public.merchants.manager_name IS
  'Nom et prénom du responsable du commerce (saisi à l''inscription).';
