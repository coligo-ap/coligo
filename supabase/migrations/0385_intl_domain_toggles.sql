-- =============================================================================
-- 0385 — Paiements € : activation PAR DOMAINE (Drive / Marketplace)
-- =============================================================================
-- Le kill-switch `enabled` (mig 0376) est GLOBAL. Le super-admin veut pouvoir
-- ouvrir/couper le rail € indépendamment par domaine : les courses Coligo
-- Drive et le checkout Marketplace. On ajoute deux sous-drapeaux, défaut TRUE
-- pour ne rien changer au comportement actuel (le global reste maître : un
-- domaine n'est proposable que si `enabled` ET son drapeau de domaine sont ON).
-- =============================================================================

ALTER TABLE public.intl_payment_settings
  ADD COLUMN IF NOT EXISTS enabled_drive       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enabled_marketplace boolean NOT NULL DEFAULT true;
