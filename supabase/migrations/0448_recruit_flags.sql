-- =============================================================================
-- 0448 — RECRUTEMENT PARTENAIRES : 4 kill-switch super-admin (page /recrute)
-- =============================================================================
-- La page publique coligo.app/recrute présente les 4 métiers partenaires et
-- redirige vers leurs portails d'inscription EXISTANTS. Chaque recrutement
-- s'active/masque depuis /admin/controle (même machinerie 4 états que les
-- autres services : active / hidden / coming_soon / maintenance).
--   · recruit_merchant  → /signup            (commerçant)
--   · recruit_driver    → /driver/signup     (livreur)
--   · recruit_chauffeur → /chauffeur/signup  (chauffeur Drive)
--   · recruit_agent     → /partenaire/signup (agent Coligo Pay)
-- Pas de trigger d'enforcement : la validation ADMIN des dossiers (créés « en
-- attente ») reste la vraie barrière métier — ces drapeaux pilotent l'OFFRE.
-- =============================================================================

INSERT INTO public.feature_flags (key)
VALUES ('recruit_merchant'), ('recruit_driver'),
       ('recruit_chauffeur'), ('recruit_agent')
ON CONFLICT (key) DO NOTHING;
