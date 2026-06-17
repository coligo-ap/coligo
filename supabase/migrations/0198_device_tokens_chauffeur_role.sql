-- =============================================================================
-- 0198 — device_tokens : autoriser le rôle 'chauffeur'
-- =============================================================================
-- POST /api/device-tokens accepte role ∈ {merchant,customer,courier,chauffeur}
-- (PushRegistrar role="chauffeur" sur l'espace Drive), mais la contrainte CHECK
-- ne listait que {merchant,customer,courier} → tout enregistrement de token d'un
-- CHAUFFEUR levait un check_violation → 500 (visible en console côté chauffeur).
-- On aligne la contrainte sur la route.
-- =============================================================================

ALTER TABLE public.device_tokens DROP CONSTRAINT IF EXISTS device_tokens_role_check;
ALTER TABLE public.device_tokens
  ADD CONSTRAINT device_tokens_role_check
  CHECK (role = ANY (ARRAY['merchant','customer','courier','chauffeur']));
