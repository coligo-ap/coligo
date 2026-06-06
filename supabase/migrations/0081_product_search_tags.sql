-- =============================================================================
-- 0081 — Recherche par PRODUIT + tags commerçant (fondations)
-- =============================================================================
-- Volet 2/1 de la refonte « recherche produit » :
--   - Recherche tolérante aux fautes/accents ("pates" → "Pâtes") via pg_trgm +
--     unaccent (schéma `extensions` sur Supabase).
--   - `merchants.tags[]` : sous-spécialités choisies par le commerçant (volet 1).
--   - Index GIN trigram sur les titres produits + nom commerce, GIN sur tags →
--     recherche ILIKE '%…%' performante (sinon seq-scan).
--   - `merchants_public` ré-exposée avec `tags` (lecture anon).
--
-- Idempotent : extensions/colonnes/index protégés par IF NOT EXISTS.
-- =============================================================================

-- Extensions (Supabase les installe dans le schéma `extensions`).
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- Wrapper IMMUTABLE autour de unaccent (la fonction dictionnaire n'est pas
-- marquée immutable → on fige le dictionnaire pour pouvoir indexer dessus).
CREATE OR REPLACE FUNCTION public.f_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
AS $$
  SELECT extensions.unaccent('extensions.unaccent', $1)
$$;

-- Tags commerçant (sous-spécialités). Liste fermée côté app (config par
-- catégorie) ; stockés en minuscules sans accent côté requête.
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- Index de recherche.
--  - Produits : titre FR/AR, tolérant fautes/accents (trigram sur f_unaccent).
CREATE INDEX IF NOT EXISTS idx_products_name_fr_trgm
  ON public.products
  USING gin (public.f_unaccent(lower(name_fr)) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_name_ar_trgm
  ON public.products
  USING gin (public.f_unaccent(lower(coalesce(name_ar, ''))) extensions.gin_trgm_ops);
--  - Nom commerce : même tolérance.
CREATE INDEX IF NOT EXISTS idx_merchants_name_trgm
  ON public.merchants
  USING gin (public.f_unaccent(lower(name)) extensions.gin_trgm_ops);
--  - Tags : appartenance rapide.
CREATE INDEX IF NOT EXISTS idx_merchants_tags_gin
  ON public.merchants
  USING gin (tags);

-- Ré-expose la vue publique avec la colonne `tags` (ajoutée en fin de SELECT).
CREATE OR REPLACE VIEW public.merchants_public AS
  SELECT id,
    slug,
    name,
    category,
    description_fr,
    description_ar,
    logo_url,
    cover_url,
    phone_public,
    city,
    commune,
    wilaya_code,
    address,
    latitude,
    longitude,
    opening_hours,
    min_order_da,
    prep_time_min,
    accepts_cash,
    accepts_online,
    pickup_slot_minutes,
    max_orders_per_slot,
    is_active,
    created_at,
    max_days_ahead,
    rating_avg,
    rating_count,
    delivery_enabled,
    express_enabled,
    tours_enabled,
    delivery_radius_km,
    shop_public_id,
    orders_paused,
    paused_until,
    closure_start,
    closure_end,
    tags
   FROM public.merchants
  WHERE is_active = true;
