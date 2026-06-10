-- =============================================================================
-- 0132 — VTC : revenu commission au platform_ledger (préalable à 0133)
-- =============================================================================
-- La commission VTC alimente le grand livre plateforme. Valeur d'enum ajoutée
-- séparément de son utilisation (les RPC de cycle de vie sont en 0133).
-- =============================================================================

ALTER TYPE public.platform_ledger_type ADD VALUE IF NOT EXISTS 'vtc_commission_income';
