-- =============================================================================
-- 0272 — Correctif : EXECUTE des RPC admin pour la session super-admin
-- =============================================================================
-- BUG révélé en prod : « permission denied for function admin_process_payout ».
--
-- Cause : ces RPC admin faisaient `REVOKE ALL ... FROM public, anon,
-- authenticated`, ne laissant l'EXECUTE qu'à postgres + service_role. Or les
-- Server Actions admin les appellent via la SESSION de l'admin (createClient),
-- dont le rôle PostgREST est `authenticated`. Résultat : l'admin ne pouvait
-- exécuter AUCUNE de ces fonctions (versements ET recharges — bug latent).
--
-- Fix : `GRANT EXECUTE ... TO authenticated`. C'est SANS danger car chaque
-- fonction se garde elle-même en interne (`is_super_admin()` / `platform_admins`)
-- → un authentifié non-admin reçoit « Réservé au super-admin ». C'est le pattern
-- déjà utilisé par les RPC qui fonctionnent (ex. request_operator_topup).
-- =============================================================================

-- Versements (mig 0271)
GRANT EXECUTE ON FUNCTION public.admin_process_payout(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_operator_payout(UUID, INTEGER, TEXT, TEXT) TO authenticated;

-- Recharges (mig 0185/0187/0194) — mêmes RPC admin, même bug latent
GRANT EXECUTE ON FUNCTION public.admin_operator_credit(UUID, INTEGER, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_topup_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_topup_request(UUID, TEXT) TO authenticated;
