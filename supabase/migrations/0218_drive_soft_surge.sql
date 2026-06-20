-- ============================================================================
-- 0218 — Surge BAS & SOFT (positionnement anti-surge, façon inDrive)
-- ----------------------------------------------------------------------------
-- Décision produit : en Algérie, inDrive a gagné des parts en se positionnant
-- SANS surge (le client fixe son prix), transformant le surge de Yassir en
-- argument contre lui. Coligo, déjà NÉGOCIÉ (prix suggéré + offre client +
-- contre-offre chauffeur), ne doit donc PAS imiter le surge agressif de Yassir.
--
-- On abaisse le plafond de surge de 0,25 → 0,12 et il reste SOFT (intégré au
-- prix suggéré, jamais affiché « ×1,5 »). La pointe est absorbée par la
-- négociation (le client peut booster son offre lui-même), pas par une
-- majoration imposée.
--
-- Repère concurrentiel : inDrive DZ = 12% commission chauffeur ; Yassir ~20%.
-- → la commission Coligo doit rester SOUS 12% le plus longtemps possible
--   (avantage chauffeur), ce que gère déjà le modèle hybride (0217).
-- ============================================================================

UPDATE public.platform_settings
  SET drive_surge_max = 0.12
  WHERE id = true;
