-- ============================================================================
-- 0237 — Calibrage : premium nuit plus doux + courts trajets ~7 % moins chers
-- ----------------------------------------------------------------------------
-- Mesures live Béjaïa (samedi soir) :
--   • Le premium NUIT (+20 %, 22h–6h) faisait passer Coligo AU-DESSUS de la
--     concurrence la nuit (long 8400 > Yassir 7860). On l'assouplit en gardant
--     un vrai premium chauffeur : drive_night_coef 0,20 → 0,15 (choix proprio ;
--     global, n'affecte QUE 22h–6h ; le jour ne bouge pas).
--   • Courts trajets : on vise « un peu moins cher que Yassir ET inDrive »
--     (385 ≈ Yassir promo 381 / inDrive 390 → cible ~360). On baisse la BASE de
--     l'ancre Béjaïa (elle pèse sur les courts ; le long, dominé par le /km +
--     dégression, bouge à peine). 200 → 173 ⇒ ~−7 % à 9 km, plus sur très court,
--     ~0 sur très long. La commission chauffeur reste 0 % (gain chauffeur
--     toujours > concurrents).
-- NB : réduction de base appliquée à BÉJAÏA seulement (seule ville mesurée). Les
-- autres villes se calibrent via leurs propres mesures + la boucle 0230.
-- ============================================================================

UPDATE public.platform_settings SET drive_night_coef = 0.15 WHERE id = true;

UPDATE public.drive_zone_anchor SET base_da = 173, updated_at = now() WHERE id = 'bejaia';
