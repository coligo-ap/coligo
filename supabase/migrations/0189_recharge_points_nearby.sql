-- =============================================================================
-- 0189 — Annuaire « Où recharger » : points partenaires proches (LOT 5)
-- =============================================================================
-- Liste les points de recharge (operator_wallets.is_partner + active + géoloc)
-- proches d'une position, triés par distance (Haversine), façon merchants_nearby.
-- SECURITY DEFINER car operator_wallets est en RLS deny-all : les points de
-- recharge sont une information publique aux opérateurs (nom/adresse/horaires).
-- Renvoie directement les champs d'affichage (pas besoin d'un second round-trip).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.recharge_points_nearby(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_limit INT DEFAULT 30,
  p_radius_override NUMERIC DEFAULT NULL
)
RETURNS TABLE (
  wallet_id    UUID,
  display_name TEXT,
  address      TEXT,
  phone        TEXT,
  hours        TEXT,
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  distance_km  DOUBLE PRECISION
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH cfg AS (
    SELECT COALESCE(browse_radius_km, 15)::numeric AS r_global
    FROM public.platform_settings WHERE id = true
  ),
  base AS (
    SELECT
      w.id, w.display_name, w.address, w.phone, w.hours, w.lat, w.lng,
      2 * 6371 * asin(sqrt(
        power(sin(radians(w.lat - p_lat) / 2), 2) +
        cos(radians(p_lat)) * cos(radians(w.lat)) *
        power(sin(radians(w.lng - p_lng) / 2), 2)
      )) AS distance_km,
      COALESCE(p_radius_override, cfg.r_global) AS eff_radius
    FROM public.operator_wallets w
    CROSS JOIN cfg
    WHERE w.is_partner
      AND w.status = 'active'
      AND w.lat IS NOT NULL
      AND w.lng IS NOT NULL
  )
  SELECT b.id, b.display_name, b.address, b.phone, b.hours, b.lat, b.lng, b.distance_km
  FROM base b
  WHERE p_lat IS NOT NULL AND p_lng IS NOT NULL
    AND b.distance_km <= b.eff_radius
  ORDER BY b.distance_km ASC
  LIMIT greatest(1, least(coalesce(p_limit, 30), 100));
$$;
GRANT EXECUTE ON FUNCTION public.recharge_points_nearby(DOUBLE PRECISION, DOUBLE PRECISION, INT, NUMERIC) TO authenticated;

-- Existe-t-il au moins un point de recharge actif ? (pour masquer l'entrée d'UI
-- quand le réseau est vide, sans dépendre de la géoloc).
CREATE OR REPLACE FUNCTION public.recharge_points_exist()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.operator_wallets
    WHERE is_partner AND status = 'active' AND lat IS NOT NULL
  );
$$;
GRANT EXECUTE ON FUNCTION public.recharge_points_exist() TO authenticated;
