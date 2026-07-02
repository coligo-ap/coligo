-- =============================================================================
-- 0314 — PHASE 4 catégories : CONTRÔLE MARKETING PAR SEGMENT.
-- Le statut « Masqué » d'une catégorie cache désormais AUSSI les commerçants
-- dont c'est la catégorie PRINCIPALE (pas seulement le rond de filtre) —
-- appliqué AU NIVEAU DE LA VUE merchants_public, donc bypass-proof pour TOUS
-- les chemins de lecture client (liste, proximité, recherche, vitrines).
-- Un commerce multi-catégories reste visible tant que sa PRINCIPALE est
-- active (masquer « boulangerie » ne coupe pas une supérette-boulangerie).
-- `coming_soon` n'affecte pas les commerces existants. La validation
-- d'inscription (is_active, mig 0273) reste un mécanisme distinct.
-- =============================================================================

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
    orders_count
   FROM merchants m
  WHERE is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM public.merchant_categories mc
      WHERE mc.code = m.category AND mc.status = 'hidden'
    );
