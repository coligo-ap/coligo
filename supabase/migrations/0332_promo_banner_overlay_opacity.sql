-- =============================================================================
-- 0332 — Bannières : opacité RÉGLABLE du mode « Texture de fond » (overlay)
-- =============================================================================
-- En mode d'image « Texture de fond » (image_fit = 'overlay'), l'image était
-- fondue à une opacité FIXE de 30 %. Le super-admin peut désormais régler ce
-- pourcentage (0–100) pour doser combien l'image transparaît sous le texte.
-- Ne concerne que le mode overlay (cover/contain gardent l'image pleine).
-- =============================================================================

ALTER TABLE public.promo_banners
  ADD COLUMN IF NOT EXISTS overlay_opacity SMALLINT NOT NULL DEFAULT 30
    CHECK (overlay_opacity BETWEEN 0 AND 100);

-- La RPC doit exposer `overlay_opacity`. Le type de retour CHANGE (nouvelle
-- colonne) → DROP puis recréation (comme mig 0330).
DROP FUNCTION IF EXISTS public.active_banners_for(
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT);

CREATE FUNCTION public.active_banners_for(
  p_lat     DOUBLE PRECISION DEFAULT NULL,
  p_lng     DOUBLE PRECISION DEFAULT NULL,
  p_wilaya  TEXT DEFAULT NULL,
  p_commune TEXT DEFAULT NULL
)
RETURNS TABLE(
  id              UUID,
  title           TEXT,
  subtitle        TEXT,
  cta_label       TEXT,
  image_url       TEXT,
  image_fit       TEXT,
  overlay_opacity SMALLINT,
  link            TEXT,
  accent          TEXT,
  "position"      INTEGER,
  promotion_id    UUID,
  merchant_id     UUID,
  merchant_slug   TEXT,
  offer           JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    b.id, b.title, b.subtitle, b.cta_label, b.image_url, b.image_fit,
    b.overlay_opacity,
    b.link, b.accent, b.position,
    b.promotion_id, b.merchant_id,
    off.merchant_slug,
    off.offer
  FROM public.promo_banners b
  LEFT JOIN LATERAL (
    SELECT
      m.slug AS merchant_slug,
      jsonb_build_object(
        'promotion_id',    p.id,
        'type',            p.type,
        'discount_kind',   p.discount_kind,
        'discount_value',  p.discount_value,
        'code',            p.code,
        'buy_qty',         p.buy_qty,
        'get_qty',         p.get_qty,
        'gift_label',      p.gift_label,
        'min_subtotal_da', p.min_subtotal_da,
        'title_fr',        p.title_fr,
        'title_ar',        p.title_ar,
        'ends_at',         p.ends_at,
        'merchant_id',     m.id,
        'merchant_name',   m.name,
        'merchant_slug',   m.slug
      ) AS offer
    FROM public.promotions p
    JOIN public.merchants  m ON m.id = p.merchant_id
    WHERE b.merchant_id IS NOT NULL
      AND p.id = b.promotion_id
      AND m.id = b.merchant_id
      AND m.is_active = true
      AND p.status = 'active'
      AND (p.starts_at IS NULL OR p.starts_at <= now())
      AND (p.ends_at   IS NULL OR p.ends_at   >  now())
      AND (p.max_uses  IS NULL OR p.uses_count < p.max_uses)
      AND (
        ( p_lat IS NOT NULL AND p_lng IS NOT NULL
          AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
          AND public.km_between(p_lat, p_lng, m.latitude, m.longitude) <= COALESCE(
                b.geo_radius_km,
                (SELECT max(z.max_km) FROM public.merchant_delivery_zones z
                   WHERE z.merchant_id = m.id),
                (SELECT browse_radius_km FROM public.platform_settings WHERE id = true),
                15) )
        OR
        ( (p_lat IS NULL OR p_lng IS NULL OR m.latitude IS NULL)
          AND p_wilaya IS NOT NULL
          AND m.wilaya_code IS NOT NULL
          AND m.wilaya_code = p_wilaya )
      )
    LIMIT 1
  ) off ON true
  WHERE b.active = true
    AND (b.starts_at IS NULL OR b.starts_at <= now())
    AND (b.ends_at   IS NULL OR b.ends_at   >  now())
    AND (
      ( b.merchant_id IS NULL
        AND (
          NOT EXISTS (SELECT 1 FROM public.promo_banner_zones z WHERE z.banner_id = b.id)
          OR EXISTS (
            SELECT 1 FROM public.promo_banner_zones z
            WHERE z.banner_id = b.id
              AND (
                   (z.scope = 'wilaya'  AND p_wilaya IS NOT NULL AND z.wilaya_code = p_wilaya)
                OR (z.scope = 'commune' AND p_commune IS NOT NULL AND lower(z.commune) = lower(p_commune))
                OR (z.scope = 'radius'  AND p_lat IS NOT NULL AND z.center_lat IS NOT NULL
                    AND z.radius_km IS NOT NULL
                    AND public.km_between(p_lat, p_lng, z.center_lat, z.center_lng) <= z.radius_km)
                OR (z.scope = 'polygon' AND p_lat IS NOT NULL AND z.polygon IS NOT NULL
                    AND public._coligo_point_in_polygon(p_lat, p_lng, z.polygon))
              )
          )
        )
      )
      OR
      ( b.merchant_id IS NOT NULL AND off.offer IS NOT NULL )
    )
  ORDER BY b.position ASC
  LIMIT 20;
$$;

GRANT EXECUTE ON FUNCTION public.active_banners_for(
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT)
  TO anon, authenticated, service_role;
