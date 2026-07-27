-- =============================================================================
-- 0416 — Thème d'apparence (mig 0415) : ajout du MODÈLE de design, en plus des
-- couleurs. Le super-admin choisit indépendamment :
--   • theme : le preset de couleurs (coligo, ramadan, aïd…) ;
--   • model : le motif décoratif des héros — blobs (formes organiques),
--     vagues, halo (lueurs radiales) ou motifs (trame de points).
-- Consommé par les héros d'auth (attribut data-theme-model sur <html>) et le
-- bandeau intégré de l'accueil marketplace.
-- =============================================================================

alter table public.app_theme
  add column if not exists model text not null default 'blobs';
