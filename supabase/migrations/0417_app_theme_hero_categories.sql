-- =============================================================================
-- 0417 — Thème accueil marketplace : le super-admin choisit si la BANDE DE
-- CATÉGORIES (filtres commerçants ronds) est INCLUSE dans le design du héro
-- (dégradé prolongé derrière, libellés blancs) ou laissée sur fond normal
-- (défaut) avec un petit espace sous le design.
-- =============================================================================

alter table public.app_theme
  add column if not exists hero_categories boolean not null default false;
