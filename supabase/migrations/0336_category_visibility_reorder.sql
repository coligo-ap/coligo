-- =============================================================================
-- 0336 — Catégories : VISIBILITÉ PAR SURFACE + reclassement effectif.
-- Deux interrupteurs par catégorie (pilotés depuis /admin/categories) :
--   show_marketplace → apparaît dans le strip de filtres du marketplace ;
--   show_signup      → proposée dans la liste d'inscription / réglages
--                      commerçant (et acceptée par la garde serveur).
-- Ils DÉCOUPLENT la visibilité de `kind` : `kind` reste la nature outillage
-- (filter = mapping auto par mots-clés + suppression libre), les flags disent
-- OÙ la catégorie s'affiche. Backfill = comportement actuel préservé :
-- types visibles partout, filtres éditoriaux jamais à l'inscription.
-- Le reclassement (drag admin) écrit `position`, désormais l'ordre du strip
-- marketplace (listMerchantCategories triait par comptage avant).
-- Écritures service_role uniquement (REVOKE de la mig 0311 inchangé).
-- =============================================================================

ALTER TABLE public.merchant_categories
  ADD COLUMN IF NOT EXISTS show_marketplace BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_signup      BOOLEAN NOT NULL DEFAULT true;

UPDATE public.merchant_categories
SET show_signup = false
WHERE kind = 'filter';
