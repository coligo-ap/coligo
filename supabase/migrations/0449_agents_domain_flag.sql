-- =============================================================================
-- 0449 — KILL-SWITCH domaine « réseau d'agents Coligo Pay » (coligo_pay_agents)
-- =============================================================================
-- Un seul bouton dans /admin/controle pour MASQUER tout le domaine agent sur
-- la plateforme (≠ coligo_pay qui coupe le wallet lui-même) :
--   · méthode « Espèces chez un agent » retirée des recharges commerçant /
--     livreur / chauffeur (+ annuaire /recharger/especes redirigé) ;
--   · option agent retirée de la feuille « Espaces partenaires » (portails) ;
--   · carte « Agent Coligo Pay » retirée de /recrute ;
--   · option « Espèces chez un agent » retirée des abonnements chauffeur ;
--   · espace /partenaire : bannière « suspendu par l'équipe Coligo » +
--     inscription agent fermée.
-- Défaut ACTIVE (aucun changement de comportement au déploiement). Pas de
-- trigger DB dédié : les ventes des agents restent régies par coligo_pay
-- (mig 0182) et par la suspension individuelle des agents — ce drapeau pilote
-- la VISIBILITÉ du domaine.
-- =============================================================================

INSERT INTO public.feature_flags (key)
VALUES ('coligo_pay_agents')
ON CONFLICT (key) DO NOTHING;
