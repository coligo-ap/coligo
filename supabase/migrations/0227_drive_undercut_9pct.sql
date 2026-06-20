-- ============================================================================
-- 0227 — Cible d'undercut médian ≈ 9 % (au lieu de 10 %)
-- ----------------------------------------------------------------------------
-- Décision proprio : remonter le prix client d'environ +1 % pour viser un écart
-- MÉDIAN de −9 % vs Yassir (au lieu de −10 %), tout en restant imbattable et
-- chauffeur-avantageux. On baisse le plafond de remise 0,12 → 0,11.
-- Vérifié sur 140 trajets réels : médian passe de −10 % à −9 %, 89 % sous Yassir.
-- ============================================================================

UPDATE public.platform_settings SET drive_undercut_max = 0.11 WHERE id = true;
