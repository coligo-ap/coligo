-- =============================================================================
-- 0047 — merchants_public : exposer les flags livraison
-- =============================================================================
-- Permet à la marketplace d'afficher un badge "Livraison" sur les cards et
-- de filtrer par mode (Express / Tournée) sans nécessiter d'auth pour
-- lire les flags publics.
--
-- On recrée la vue (DROP + CREATE) car ALTER VIEW ADD COLUMN n'existe pas
-- en Postgres.
-- =============================================================================

DROP VIEW IF EXISTS public.merchants_public CASCADE;

CREATE VIEW public.merchants_public
WITH (security_invoker = true) AS
SELECT
  id, slug, name, category, description_fr, description_ar,
  logo_url, cover_url, phone_public, city, commune, wilaya_code, address,
  latitude, longitude, opening_hours,
  min_order_da, prep_time_min, accepts_cash, accepts_online,
  pickup_slot_minutes, max_orders_per_slot, is_active, created_at,
  max_days_ahead, rating_avg, rating_count,
  delivery_enabled, express_enabled, tours_enabled, delivery_radius_km,
  shop_public_id
FROM public.merchants
WHERE is_active = true;

-- Permission lecture publique (anonyme via la marketplace).
GRANT SELECT ON public.merchants_public TO anon, authenticated;
