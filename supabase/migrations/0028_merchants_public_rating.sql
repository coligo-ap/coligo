-- =============================================================================
-- Coligo v3 - Migration 0028 : exposer rating_avg/rating_count dans la vue
-- =============================================================================
-- CREATE OR REPLACE VIEW interdit l'insertion d'une colonne au milieu de la
-- liste — on ajoute donc en FIN (cohérent avec la migration 0024).
-- =============================================================================

CREATE OR REPLACE VIEW public.merchants_public
WITH (security_invoker = true) AS
SELECT
  id,
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
  rating_count
FROM public.merchants
WHERE is_active = true;

GRANT SELECT ON public.merchants_public TO anon, authenticated;
