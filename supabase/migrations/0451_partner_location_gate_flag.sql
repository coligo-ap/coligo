-- =============================================================================
-- 0451 — KILL-SWITCH « localisation obligatoire » chauffeur + livreur
--        (partner_location_gate)
-- =============================================================================
-- La garde de localisation (commit 519fad1f) bloque tout l'espace chauffeur et
-- livreur tant que la position exacte manque — comportement Uber/Bolt/Yassir.
-- Elle n'avait AUCUNE porte de sortie : un bug de la garde (faux « service
-- éteint » sur un modèle de téléphone, régression du plugin) aurait bloqué
-- toute la flotte, avec pour seul repli un revert + redéploiement (~6 min).
--
-- Ce drapeau donne la main au super-admin dans /admin/controle :
--   · active (DÉFAUT)        → garde appliquée, comportement inchangé ;
--   · tout autre état        → garde désactivée (les écrans partenaires ne la
--                              montent plus). AUCUN autre effet : pas d'écran
--                              « bientôt », pas de message — c'est une vanne
--                              de sécurité, pas une fonctionnalité visible.
-- Lecture côté serveur uniquement (coques chauffeur/livreur) ; pas de trigger
-- DB : la garde est purement front, il n'y a pas d'API à couper.
-- =============================================================================

INSERT INTO public.feature_flags (key)
VALUES ('partner_location_gate')
ON CONFLICT (key) DO NOTHING;
