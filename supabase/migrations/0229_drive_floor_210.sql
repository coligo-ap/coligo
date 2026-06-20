-- ============================================================================
-- 0229 — Plancher 210 : très courts trajets à −14 % pile vs Yassir
-- ----------------------------------------------------------------------------
-- Cible proprio : très courts trajets exactement −14 % vs Yassir (mid ~243).
-- 243 × 0,86 ≈ 210. Plancher classic 205 → 210, confort 300 → 305.
-- Vérifié : très courts → −14 % pile.
-- ============================================================================
UPDATE public.platform_settings SET drive_pricing = jsonb_set(
  jsonb_set(drive_pricing, '{classic,min}', '210'),
  '{confort,min}', '305') WHERE id = true;
