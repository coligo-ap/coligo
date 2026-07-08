-- ============================================================================
-- 0347 : bascule TEST / LIVE de Chargily Pay pilotée par le super-admin.
--
-- Le mode actif vit en base (toggle /admin/controle) ; les CLÉS restent dans
-- l'environnement (CHARGILY_SECRET_KEY = test, CHARGILY_LIVE_SECRET_KEY =
-- live) — jamais en base. Défaut FALSE = test : fail-safe, on n'encaisse
-- jamais du vrai argent par accident.
-- ============================================================================

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS chargily_live_mode boolean NOT NULL DEFAULT false;
