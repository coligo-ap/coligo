-- =============================================================================
-- 0183 — FIX : chauffeur_nearby_rides « column reference "id" is ambiguous »
-- =============================================================================
-- Régression introduite en 0182 : la lecture du rayon configurable
--   SELECT ... FROM public.platform_settings WHERE id = true
-- référence un `id` NON qualifié. Or RETURNS TABLE(id uuid, …) déclare une
-- variable de sortie nommée `id` → plpgsql (variable_conflict=error) lève
-- « column reference "id" is ambiguous » à CHAQUE appel → getDriveHome échoue →
-- le chauffeur ne reçoit jamais les demandes de courses (temps réel ET tick).
-- Correctif : qualifier la colonne (public.platform_settings.id). Le reste est
-- identique à 0182 (garde feature drive + rayon configurable + zone perso).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.chauffeur_nearby_rides(
  p_lat       DOUBLE PRECISION,
  p_lng       DOUBLE PRECISION,
  p_radius_km NUMERIC DEFAULT 8
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
  v_cfg_radius NUMERIC;
  v_ref_lat NUMERIC;
  v_ref_lng NUMERIC;
  v_radius  NUMERIC;
BEGIN
  IF public.feature_blocked('drive') THEN RETURN; END IF;

  SELECT c.* INTO v_ch FROM public.chauffeurs c
  WHERE c.user_id = auth.uid()
    AND c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked;
  IF v_ch.id IS NULL OR p_lat IS NULL OR p_lng IS NULL THEN RETURN; END IF;
  v_female_online := public.drive_female_online();

  -- ⚠️ platform_settings.id qualifié : `id` est aussi une COLONNE DE SORTIE de
  -- cette fonction → un `id` nu serait ambigu (cf. en-tête).
  SELECT COALESCE(ps.drive_dispatch_radius_km, 8) INTO v_cfg_radius
  FROM public.platform_settings ps WHERE ps.id = true;

  IF v_ch.work_zone_lat IS NOT NULL AND v_ch.work_zone_lng IS NOT NULL
     AND COALESCE(v_ch.work_zone_radius_km, 0) > 0 THEN
    v_ref_lat := v_ch.work_zone_lat; v_ref_lng := v_ch.work_zone_lng;
    v_radius  := GREATEST(0.5, LEAST(v_ch.work_zone_radius_km, 60));
  ELSE
    v_ref_lat := p_lat; v_ref_lng := p_lng;
    v_radius  := GREATEST(0.5, LEAST(COALESCE(v_cfg_radius, 8), 60));
  END IF;

  RETURN QUERY
  SELECT r.id, r.pickup_text, r.dest_text,
         r.pickup_lat, r.pickup_lng, r.dest_lat, r.dest_lng,
         r.distance_km, r.proposed_price_da, r.suggested_price_da,
         r.boost_amount_da, r.gamme, r.female_only, r.payment_method,
         public.km_between(p_lat, p_lng, r.pickup_lat, r.pickup_lng)::NUMERIC AS pickup_dist_km,
         r.created_at,
         (SELECT o.price_da FROM public.ride_offers o
           WHERE o.ride_id = r.id AND o.chauffeur_id = v_ch.id AND o.status = 'offered') AS my_offer_da,
         COALESCE(NULLIF(split_part(cu.full_name, ' ', 1), ''), 'Client') AS customer_name,
         (SELECT round(avg(r2.client_rating)::NUMERIC, 1) FROM public.rides r2
           WHERE r2.customer_id = r.customer_id AND r2.client_rating IS NOT NULL) AS customer_rating,
         cu.created_at AS customer_since
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
    AND public.km_between(v_ref_lat, v_ref_lng, r.pickup_lat, r.pickup_lng) <= v_radius
  ORDER BY (r.boost_amount_da > 0) DESC, r.created_at DESC
  LIMIT 30;
END;
$$;
