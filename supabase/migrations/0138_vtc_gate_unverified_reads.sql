-- =============================================================================
-- 0138 — VTC : ne pas notifier / lister les courses aux chauffeurs NON vérifiés
-- =============================================================================
-- Le hard gate métier existe déjà (`chauffeur_offer_ride` exige is_verified AND
-- NOT is_frozen AND NOT is_blocked → un non-vérifié ne peut PAS prendre de course).
-- Mais les deux RPC de LECTURE laissaient encore passer les non-vérifiés :
--   • `chauffeurs_present_near` → le non-vérifié recevait quand même la SONNERIE ;
--   • `chauffeur_nearby_rides`  → il VOYAIT des courses qu'il ne peut pas prendre.
-- On aligne les deux lectures sur le même critère que l'offre : vérifié, non gelé,
-- non bloqué. Effet concret de la vérification admin : tant que is_verified=false,
-- le chauffeur ne reçoit rien et ne voit rien.
-- =============================================================================

-- 1) Dispatch (notification) : exclure les non-vérifiés.
CREATE OR REPLACE FUNCTION public.chauffeurs_present_near(
  p_lat        DOUBLE PRECISION,
  p_lng        DOUBLE PRECISION,
  p_radius_km  NUMERIC DEFAULT 6,
  p_within_min INTEGER DEFAULT 3
)
RETURNS TABLE(user_id UUID, chauffeur_id UUID, dist_km NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ch.user_id, ch.id,
    (6371 * acos(LEAST(1, GREATEST(-1,
      cos(radians(p_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(p_lng))
      + sin(radians(p_lat)) * sin(radians(p.lat))))))::NUMERIC AS dist_km
  FROM public.chauffeur_presence p
  JOIN public.chauffeurs ch ON ch.id = p.chauffeur_id
  WHERE p.is_online = true
    AND p.updated_at > now() - make_interval(mins => GREATEST(1, p_within_min))
    AND ch.user_id IS NOT NULL
    AND COALESCE(ch.is_verified, false) = true
    AND COALESCE(ch.is_frozen, false) = false
    AND COALESCE(ch.is_blocked, false) = false
    AND p_lat IS NOT NULL AND p_lng IS NOT NULL
    AND (6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(p_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(p.lat))
        )))) <= GREATEST(0.5, LEAST(COALESCE(p_radius_km, 6), 30))
  ORDER BY dist_km ASC;
$$;
GRANT EXECUTE ON FUNCTION public.chauffeurs_present_near(DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, INTEGER)
  TO authenticated, service_role;

-- 2) File de courses : un chauffeur non vérifié (ou gelé/bloqué) ne voit rien.
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
  -- Même critère que l'offre : seul un chauffeur vérifié, non gelé, non bloqué
  -- obtient un v_ch ; sinon RETURN (file vide).
  SELECT c.id INTO v_ch
  FROM public.chauffeurs c
  WHERE c.user_id = auth.uid()
    AND c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked;
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
