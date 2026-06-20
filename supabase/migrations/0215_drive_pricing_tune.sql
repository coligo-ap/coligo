-- ============================================================================
-- 0215 — Calibrage fin tarification Drive (suite 0213/0214)
-- ----------------------------------------------------------------------------
-- 1) Barème NATIONAL (zones non mesurées) abaissé à 110 + 24/km : la majorité
--    des wilayas non mesurées sont plutôt « cheap » (cf. Béjaïa/Sétif/Constantine)
--    → un national plus bas garantit mieux « toujours sous Yassir » par défaut.
-- 2) Rayons d'ancre élargis pour couvrir TOUTE la wilaya (communes éloignées
--    du chef-lieu : Akbou/Tazmalt sont en wilaya de Béjaïa mais à 70-85 km de
--    Béjaïa-ville → doivent utiliser le marché « Béjaïa », pas le national).
-- ============================================================================

UPDATE public.platform_settings SET drive_pricing = jsonb_build_object(
  'classic', jsonb_build_object('base', 110, 'per_km', 24, 'min', 200),
  'confort', jsonb_build_object('base', 160, 'per_km', 35, 'min', 290),
  'moto',    jsonb_build_object('base',  75, 'per_km', 17, 'min', 130)
) WHERE id = true;

UPDATE public.drive_zone_anchor SET radius_km = 95 WHERE id = 'bejaia';
UPDATE public.drive_zone_anchor SET radius_km = 55 WHERE id IN ('setif','constantine','oran','annaba','tlemcen');
UPDATE public.drive_zone_anchor SET radius_km = 45 WHERE id = 'alger';
