-- =============================================================================
-- 0377 — Bascule TEST/LIVE Stripe pilotée par le super-admin
-- =============================================================================
-- Même modèle que chargily_live_mode (mig 0347) : les CLÉS restent dans
-- l'environnement (STRIPE_TEST_SECRET_KEY / STRIPE_LIVE_SECRET_KEY), la
-- colonne ne porte que le CHOIX du mode, lu en base à chaque création de
-- session → effet immédiat, sans redéploiement. Défaut false = TEST
-- (fail-safe : on n'encaisse jamais du vrai argent par accident).

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS stripe_live_mode boolean NOT NULL DEFAULT false;
