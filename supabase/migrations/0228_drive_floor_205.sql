-- ============================================================================
-- 0228 — Plancher relevé : très courts trajets à −16 % (au lieu de −18 %)
-- ----------------------------------------------------------------------------
-- Sur les villes type Béjaïa, les très courts trajets étaient à −18 % vs Yassir
-- (plancher 200 DA vs ~243 Yassir). Le proprio veut −14 à −16 % (≈ +2 % client).
-- Plancher classic 200 → 205, confort 290 → 300. Vérifié : très courts → −16 %.
-- ============================================================================
UPDATE public.platform_settings SET drive_pricing = jsonb_set(
  jsonb_set(drive_pricing, '{classic,min}', '205'),
  '{confort,min}', '300') WHERE id = true;
