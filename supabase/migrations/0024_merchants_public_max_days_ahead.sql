-- =============================================================================
-- Coligo v3 - Migration 0024 : exposer max_days_ahead dans merchants_public
-- =============================================================================
-- La vue merchants_public doit inclure max_days_ahead pour que le checkout et
-- la fiche commerçant puissent afficher la fenêtre de réservation J+N.
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
  -- Ajouté en FIN de liste : CREATE OR REPLACE VIEW interdit d'insérer une
  -- colonne au milieu (cannot change name of view column ...).
  max_days_ahead
FROM public.merchants
WHERE is_active = true;

GRANT SELECT ON public.merchants_public TO anon, authenticated;
