-- =============================================================================
-- 0276 — Durcissement : fonctions de règles d'alerte NON exposées
-- =============================================================================
-- CONTEXTE : la mig 0275 a fait `REVOKE ALL ... FROM PUBLIC` sur les fonctions
-- de règles `_admin_alert_rules_<domaine>()`. INSUFFISANT sur Supabase : les
-- `ALTER DEFAULT PRIVILEGES` du projet accordent automatiquement EXECUTE au rôle
-- `authenticated` (et `anon`) sur toute fonction créée dans `public` — un GRANT
-- DIRECT au rôle, que `REVOKE FROM PUBLIC` ne retire pas. Résultat : un simple
-- utilisateur connecté pouvait appeler `_admin_alert_rules_*()` et lire les
-- compteurs plateforme (commandes en retard, demandes, versements). Fuite mineure
-- mais réelle.
--
-- CORRECTIF : REVOKE EXECUTE explicite à `authenticated` ET `anon` sur les trois
-- fonctions de règles. L'agrégateur `admin_alerts()` (SECURITY DEFINER, propriété
-- de postgres) continue de les appeler sans souci — un SECURITY DEFINER exécute
-- avec les droits du PROPRIÉTAIRE, pas de l'appelant. Seul `admin_alerts()` reste
-- exposé (grant authenticated + garde is_super_admin interne).
--
-- RÈGLE pour les domaines suivants : toute nouvelle `_admin_alert_rules_<dom>()`
-- DOIT inclure ce REVOKE authenticated/anon (sinon même fuite).
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public._admin_alert_rules_pilotage()
  FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._admin_alert_rules_commercants()
  FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._admin_alert_rules_finances()
  FROM authenticated, anon;
