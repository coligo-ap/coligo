-- =============================================================================
-- Coligo v3 - Migration 0030 : retirer les fixtures promo_banners
-- =============================================================================
-- La table promo_banners reste en place (pour usage futur via admin), mais on
-- supprime les 2 bannières seedées par 0026 ("Bienvenue sur Coligo" + "Click &
-- Collect partout en Algérie") qui polluaient la home.
--
-- Suppression idempotente — match par title car pas d'identifiant stable.
-- =============================================================================

DELETE FROM public.promo_banners
WHERE title IN (
  'Bienvenue sur Coligo',
  'Click & Collect partout en Algérie'
);
