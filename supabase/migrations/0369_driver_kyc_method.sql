-- ============================================================================
-- 0369 — INSCRIPTION LIVREUR : méthode de vérification d'identité choisie.
--
-- Le livreur a désormais DEUX chemins pour prouver son identité (étape 2 du
-- parcours), à la manière des néobanques :
--   • 'instant' → vérification AUTOMATIQUE (IDV) : scan du document + selfie,
--     résultat en quelques secondes. Aucune pièce d'identité à téléverser.
--   • 'manual'  → envoi des pièces, examinées par l'équipe Coligo (24-72 h).
--
-- Quand le super-admin a rendu l'IDV OBLIGATOIRE pour les livreurs, le choix
-- n'existe pas : c'est 'instant', imposé (le serveur le force, cf.
-- setDriverKycMethod).
-- NULL = le livreur n'a pas encore choisi.
-- ============================================================================

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS kyc_method text
    CHECK (kyc_method IS NULL OR kyc_method IN ('manual', 'instant'));

COMMENT ON COLUMN public.drivers.kyc_method IS
  'Méthode de vérification d''identité choisie à l''inscription : instant (IDV automatique) ou manual (pièces examinées par l''équipe).';
