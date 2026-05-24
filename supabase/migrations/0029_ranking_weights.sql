-- =============================================================================
-- Coligo v3 - Migration 0029 : ranking_weights sur platform_settings
-- =============================================================================
-- Permet à l'admin d'ajuster la pondération des signaux (note, popularité,
-- promo, distance, ouvert) sans redéploiement. Si NULL/absent, le code
-- TS (lib/data/merchant-ranking.ts) tombe sur DEFAULT_WEIGHTS.
--
-- Format JSON attendu :
--   { "rating": 0.3, "popular": 0.25, "promo": 0.15, "distance": 0.2, "open": 0.1 }
-- =============================================================================

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS ranking_weights JSONB NOT NULL DEFAULT
    '{"rating":0.30,"popular":0.25,"promo":0.15,"distance":0.20,"open":0.10}'::jsonb;
