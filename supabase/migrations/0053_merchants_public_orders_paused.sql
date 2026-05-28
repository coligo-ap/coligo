-- =============================================================================
-- 0053 — Expose orders_paused dans merchants_public (pour bloquer le checkout)
-- =============================================================================
CREATE OR REPLACE VIEW public.merchants_public AS
  SELECT
    id, slug, name, category, description_fr, description_ar,
    logo_url, cover_url, phone_public, city, commune, wilaya_code,
    address, latitude, longitude, opening_hours, min_order_da, prep_time_min,
    accepts_cash, accepts_online, pickup_slot_minutes, max_orders_per_slot,
    is_active, created_at, max_days_ahead, rating_avg, rating_count,
    delivery_enabled, express_enabled, tours_enabled, delivery_radius_km,
    shop_public_id,
    orders_paused
  FROM public.merchants
  WHERE is_active = true;
