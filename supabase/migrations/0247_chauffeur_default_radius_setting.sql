-- =============================================================================
-- 0247 — Rayon de réception PAR DÉFAUT configurable par le super-admin (10 km)
-- =============================================================================
-- Le rayon « Ma zone » du chauffeur (work_zone_radius_km) reste personnalisable
-- (plancher 5 km, plafond 20 km, cf. 0246). Mais TANT QU'IL N'A RIEN PERSONNALISÉ,
-- on applique un DÉFAUT plateforme — réglable par le super-admin — fixé à 10 km
-- au lancement. C'est la distance, À VOL D'OISEAU, entre la position actuelle du
-- chauffeur et le POINT DE DÉPART de la course du client.
--
-- Priorité du rayon effectif (chauffeur_nearby_rides) :
--   work_zone_radius_km du chauffeur  →  défaut plateforme  →  hint client  →  10,
-- le tout clampé 5..20.
-- =============================================================================

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS drive_default_radius_km INTEGER NOT NULL DEFAULT 10;

-- Borne dure 5..20 (cohérente avec le plancher/plafond chauffeur).
UPDATE public.platform_settings
   SET drive_default_radius_km = GREATEST(5, LEAST(COALESCE(drive_default_radius_km, 10), 20))
 WHERE id = true;

CREATE OR REPLACE FUNCTION public.chauffeur_nearby_rides(
  p_lat       DOUBLE PRECISION,
  p_lng       DOUBLE PRECISION,
  p_radius_km NUMERIC DEFAULT NULL
)
RETURNS TABLE(
  id                 UUID,
  pickup_text        TEXT,
  dest_text          TEXT,
  pickup_lat         DOUBLE PRECISION,
  pickup_lng         DOUBLE PRECISION,
  dest_lat           DOUBLE PRECISION,
  dest_lng           DOUBLE PRECISION,
  distance_km        NUMERIC,
  proposed_price_da  INTEGER,
  suggested_price_da INTEGER,
  boost_amount_da    INTEGER,
  gamme              TEXT,
  female_only        BOOLEAN,
  payment_method     TEXT,
  pickup_dist_km     NUMERIC,
  created_at         TIMESTAMPTZ,
  my_offer_da        INTEGER,
  customer_name      TEXT,
  customer_rating    NUMERIC,
  customer_since     TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ch public.chauffeurs%ROWTYPE;
  v_female_online BOOLEAN;
  v_radius NUMERIC;            -- rayon effectif (5..20)
  v_default NUMERIC;           -- défaut plateforme (réglable super-admin)
  v_max    NUMERIC := 20;      -- plafond d'expansion automatique
  v_min    INTEGER := 6;       -- nb mini de courses visé avant d'élargir
BEGIN
  IF public.feature_blocked('drive') THEN RETURN; END IF;

  SELECT c.* INTO v_ch FROM public.chauffeurs c
  WHERE c.user_id = auth.uid()
    AND c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked;
  IF v_ch.id IS NULL OR p_lat IS NULL OR p_lng IS NULL THEN RETURN; END IF;
  v_female_online := public.drive_female_online();

  -- NB : alias `ps` + colonne qualifiée — `id` non qualifié serait AMBIGU avec
  -- le paramètre OUT `id` de la table de retour.
  SELECT COALESCE(ps.drive_default_radius_km, 10) INTO v_default
    FROM public.platform_settings ps WHERE ps.id = true;
  v_default := GREATEST(5, LEAST(COALESCE(v_default, 10), v_max));

  -- Rayon = préférence chauffeur (source de vérité, bypass-proof), sinon DÉFAUT
  -- plateforme, sinon hint client, sinon 10. Clampé 5..20.
  v_radius := GREATEST(5, LEAST(
    COALESCE(NULLIF(v_ch.work_zone_radius_km, 0), v_default, p_radius_km, 10), v_max));

  RETURN QUERY
  WITH elig AS (
    SELECT r.id, r.pickup_text, r.dest_text,
           r.pickup_lat, r.pickup_lng, r.dest_lat, r.dest_lng,
           r.distance_km, r.proposed_price_da, r.suggested_price_da,
           r.boost_amount_da, r.gamme, r.female_only, r.payment_method,
           public.km_between(p_lat, p_lng, r.pickup_lat, r.pickup_lng)::NUMERIC AS pdist,
           r.created_at, r.customer_id,
           cu.full_name AS cu_name, cu.created_at AS cu_since
    FROM public.rides r
    JOIN public.customers cu ON cu.id = r.customer_id
    WHERE r.status = 'searching'
      AND (r.expires_at IS NULL OR r.expires_at > now())
      AND (r.payment_method <> 'card' OR r.online_paid_at IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM public.ride_offers od
                      WHERE od.ride_id = r.id AND od.chauffeur_id = v_ch.id AND od.status = 'declined')
      AND (CASE v_ch.gamme
            WHEN 'confort' THEN r.gamme IN ('classic','confort')
            WHEN 'classic' THEN r.gamme = 'classic'
            ELSE r.gamme = 'moto' END)
      AND (NOT r.female_only OR v_ch.is_female_verified OR NOT v_female_online)
      -- Filtre large : tout ce qui est dans le plafond d'expansion.
      AND public.km_between(p_lat, p_lng, r.pickup_lat, r.pickup_lng) <= v_max
  ),
  ranked AS (
    SELECT e.*, row_number() OVER (ORDER BY e.pdist ASC) AS rn FROM elig e
  )
  SELECT k.id, k.pickup_text, k.dest_text,
         k.pickup_lat, k.pickup_lng, k.dest_lat, k.dest_lng,
         k.distance_km, k.proposed_price_da, k.suggested_price_da,
         k.boost_amount_da, k.gamme, k.female_only, k.payment_method,
         k.pdist AS pickup_dist_km,
         k.created_at,
         (SELECT o.price_da FROM public.ride_offers o
           WHERE o.ride_id = k.id AND o.chauffeur_id = v_ch.id AND o.status = 'offered') AS my_offer_da,
         COALESCE(NULLIF(split_part(k.cu_name, ' ', 1), ''), 'Client') AS customer_name,
         (SELECT round(avg(r2.client_rating)::NUMERIC, 1) FROM public.rides r2
           WHERE r2.customer_id = k.customer_id AND r2.client_rating IS NOT NULL) AS customer_rating,
         k.cu_since AS customer_since
  FROM ranked k
  WHERE k.pdist <= v_radius OR k.rn <= v_min
  ORDER BY (k.boost_amount_da > 0) DESC, k.created_at DESC
  LIMIT 30;
END;
$$;
