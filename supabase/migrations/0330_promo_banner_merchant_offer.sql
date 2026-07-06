-- =============================================================================
-- 0330 — Bannières marketing « Offre d'un commerçant » (mise en avant d'une
--         promotion RÉELLE publiée par le commerçant)
-- =============================================================================
-- Nouveau type de bannière : au lieu d'un simple visuel + lien, le super-admin
-- peut RELIER une bannière à une promotion EXISTANTE d'un commerçant
-- (table `promotions`). Le client voit la bannière, touche « Récupérer mon
-- offre / mon code », une pop-up affiche les détails LIVE de l'offre (code,
-- réduction, quantité offerte, condition, expiration…), puis il est redirigé
-- vers la boutique pour en profiter.
--
-- RÈGLES (façon senior, sécurisé, sans duplication de la vérité) :
--   • Coligo NE CRÉE PAS la promo : la bannière POINTE vers `promotions.id`.
--     Tout le contenu (code, montant, condition) reste la source du commerçant.
--   • Si le commerçant DÉSACTIVE/expire/épuise l'offre, ou se met inactif, la
--     bannière DISPARAÎT automatiquement (l'offre n'est jamais figée dans la
--     bannière — elle est relue à chaque affichage).
--   • CIBLAGE GÉO = les MÊMES conditions que le commerçant : la bannière n'est
--     visible QUE pour les utilisateurs à portée du commerce (rayon GPS réel
--     autour du commerçant, ou même wilaya à défaut de position). Un client à
--     Alger ne verra pas l'offre d'un commerçant d'Akbou / Béjaïa.
--   • Les détails de l'offre ne sont exposés (JSON) QUE lorsque la bannière est
--     réellement visible → aucune fuite de contenu hors zone / hors validité.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Colonnes de liaison sur promo_banners.
--    merchant_id NON NULL ⇒ bannière « offre commerçant » ; NULL ⇒ éditoriale.
--    promotion_id supprimée (promo effacée) ⇒ SET NULL → la bannière n'a plus
--    d'offre live → masquée (jamais affichée « à vide »). merchant supprimé ⇒
--    CASCADE (la bannière n'a plus de raison d'être).
-- ---------------------------------------------------------------------------
ALTER TABLE public.promo_banners
  ADD COLUMN IF NOT EXISTS promotion_id UUID
    REFERENCES public.promotions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merchant_id  UUID
    REFERENCES public.merchants(id) ON DELETE CASCADE,
  -- Rayon de ciblage FORCÉ par l'admin (km). NULL = auto (portée du commerçant).
  ADD COLUMN IF NOT EXISTS geo_radius_km NUMERIC
    CHECK (geo_radius_km IS NULL OR (geo_radius_km > 0 AND geo_radius_km <= 200));

CREATE INDEX IF NOT EXISTS idx_promo_banners_merchant
  ON public.promo_banners (merchant_id) WHERE merchant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promo_banners_promotion
  ON public.promo_banners (promotion_id) WHERE promotion_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. RPC publique : bannières visibles pour un point/zone donné.
--    Le type de retour change (offre + commerçant) → on DROP puis recrée.
--    Deux familles :
--      • éditoriale (merchant_id NULL) : logique de zones existante (mig 0249).
--      • offre commerçant (merchant_id NOT NULL) : la LATÉRALE ne renvoie une
--        offre QUE si la promo est vivante ET le commerçant à portée. Sinon la
--        bannière est masquée.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.active_banners_for(
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT);

CREATE FUNCTION public.active_banners_for(
  p_lat     DOUBLE PRECISION DEFAULT NULL,
  p_lng     DOUBLE PRECISION DEFAULT NULL,
  p_wilaya  TEXT DEFAULT NULL,
  p_commune TEXT DEFAULT NULL
)
RETURNS TABLE(
  id            UUID,
  title         TEXT,
  subtitle      TEXT,
  cta_label     TEXT,
  image_url     TEXT,
  image_fit     TEXT,
  link          TEXT,
  accent        TEXT,
  "position"    INTEGER,
  promotion_id  UUID,
  merchant_id   UUID,
  merchant_slug TEXT,
  offer         JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    b.id, b.title, b.subtitle, b.cta_label, b.image_url, b.image_fit,
    b.link, b.accent, b.position,
    b.promotion_id, b.merchant_id,
    off.merchant_slug,
    off.offer
  FROM public.promo_banners b
  -- Offre LIVE + commerçant à portée. Ne renvoie une ligne QUE si tout est vrai
  -- → sert à la fois de contenu (JSON) ET de filtre de visibilité de l'offre.
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
        -- (a) position GPS connue → rayon RÉEL autour du commerce. Portée =
        --     override admin > plus grande bande de livraison > rayon plateforme.
        ( p_lat IS NOT NULL AND p_lng IS NOT NULL
          AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
          AND public.km_between(p_lat, p_lng, m.latitude, m.longitude) <= COALESCE(
                b.geo_radius_km,
                (SELECT max(z.max_km) FROM public.merchant_delivery_zones z
                   WHERE z.merchant_id = m.id),
                (SELECT browse_radius_km FROM public.platform_settings WHERE id = true),
                15) )
        OR
        -- (b) pas de position mais wilaya connue → même wilaya que le commerce.
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
      -- Éditoriale : zones existantes (globale si aucune zone).
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
      -- Offre commerçant : visible SEULEMENT si la latérale a renvoyé une offre
      -- (promo vivante + commerçant à portée).
      ( b.merchant_id IS NOT NULL AND off.offer IS NOT NULL )
    )
  ORDER BY b.position ASC
  LIMIT 20;
$$;

GRANT EXECUTE ON FUNCTION public.active_banners_for(
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT)
  TO anon, authenticated, service_role;
