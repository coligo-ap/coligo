-- =============================================================================
-- 0135 — VTC : courses en recherche proches du chauffeur (file de dispatch)
-- =============================================================================
-- Le chauffeur EN LIGNE voit les courses `searching` dont le DÉPART est dans son
-- rayon, avec le prix proposé par le client + s'il a déjà fait une offre.
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
  distance_km        NUMERIC,
  proposed_price_da  INTEGER,
  suggested_price_da INTEGER,
  payment_method     TEXT,
  pickup_dist_km     NUMERIC,
  created_at         TIMESTAMPTZ,
  my_offer_da        INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ch UUID;
BEGIN
  SELECT c.id INTO v_ch FROM public.chauffeurs c WHERE c.user_id = auth.uid();
  IF v_ch IS NULL OR p_lat IS NULL OR p_lng IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT r.id, r.pickup_text, r.dest_text, r.distance_km, r.proposed_price_da,
         r.suggested_price_da, r.payment_method,
         (6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(p_lat)) * cos(radians(r.pickup_lat)) * cos(radians(r.pickup_lng) - radians(p_lng))
            + sin(radians(p_lat)) * sin(radians(r.pickup_lat))))))::NUMERIC AS pickup_dist_km,
         r.created_at,
         (SELECT o.price_da FROM public.ride_offers o
           WHERE o.ride_id = r.id AND o.chauffeur_id = v_ch AND o.status = 'offered') AS my_offer_da
  FROM public.rides r
  WHERE r.status = 'searching'
    AND (6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(p_lat)) * cos(radians(r.pickup_lat)) * cos(radians(r.pickup_lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(r.pickup_lat)))))) <= GREATEST(0.5, LEAST(COALESCE(p_radius_km, 8), 30))
  ORDER BY r.created_at DESC
  LIMIT 30;
END;
$$;

GRANT EXECUTE ON FUNCTION public.chauffeur_nearby_rides(DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC) TO authenticated;
