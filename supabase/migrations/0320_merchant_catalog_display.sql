-- ============================================================================
-- 0320 — Affichage du catalogue côté client, au choix du COMMERÇANT.
--
--   merchants.catalog_display :
--     • 'list'       (défaut) : sections catégories + produits déroulés
--                    (comportement historique) ;
--     • 'categories' : d'abord une grille de CARTES catégories (photo), le
--                    client tape une carte pour voir les produits dedans.
--
--   Le client peut ensuite basculer lui-même l'affichage sur la boutique
--   (préférence locale, jamais écrite en base). Exposé via merchants_public.
-- ============================================================================

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS catalog_display TEXT NOT NULL DEFAULT 'list'
  CHECK (catalog_display IN ('list', 'categories'));

-- Vue publique : reprise à l'identique de 0314 + catalog_display (ajout en fin
-- de liste = compatible CREATE OR REPLACE).
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
    tags,
    score_quality,
    score_speed,
    avg_prep_min,
    orders_count,
    catalog_display
   FROM merchants m
  WHERE is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM public.merchant_categories mc
      WHERE mc.code = m.category AND mc.status = 'hidden'
    );
