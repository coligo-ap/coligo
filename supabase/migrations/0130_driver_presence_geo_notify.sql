-- =============================================================================
-- 0130 — Présence livreur (position + en ligne) → notif Express GLOBALE géolocalisée
-- =============================================================================
-- Aujourd'hui la position des livreurs n'est pas stockée (le livreur l'envoie au
-- moment du pull). Pour « sonner » le RÉSEAU GLOBAL géolocalisé à l'apparition
-- d'une course express, on suit la PRÉSENCE des livreurs en ligne via un heartbeat
-- léger (le composant ZoneDispatch envoie déjà sa position toutes les ~20 s).
--
-- `driver_presence` = dernière position connue + horodatage. Un livreur est
-- « présent » si son heartbeat date de < N minutes (app ouverte + en ligne).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.driver_presence (
  driver_id  UUID PRIMARY KEY REFERENCES public.drivers(id) ON DELETE CASCADE,
  lat        DOUBLE PRECISION NOT NULL,
  lng        DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_presence_updated ON public.driver_presence (updated_at);

ALTER TABLE public.driver_presence ENABLE ROW LEVEL SECURITY;
-- Aucune policy : seules les RPC SECURITY DEFINER lisent/écrivent.

-- ---------------------------------------------------------------------------
-- Heartbeat : le livreur connecté pousse sa position (toutes les ~20 s en ligne).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_heartbeat(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver UUID;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN; END IF;
  IF p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN RETURN; END IF;

  SELECT id INTO v_driver FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver IS NULL THEN RETURN; END IF;

  INSERT INTO public.driver_presence (driver_id, lat, lng, updated_at)
  VALUES (v_driver, p_lat, p_lng, now())
  ON CONFLICT (driver_id) DO UPDATE
    SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_heartbeat(DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

-- ---------------------------------------------------------------------------
-- Cibles de notif : livreurs PRÉSENTS (heartbeat récent), NON gelés/bloqués,
-- dans le rayon (km) d'un point (la position du commerçant). Haversine inline.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drivers_present_near(
  p_lat        DOUBLE PRECISION,
  p_lng        DOUBLE PRECISION,
  p_radius_km  NUMERIC DEFAULT 6,
  p_within_min INTEGER DEFAULT 3
)
RETURNS TABLE(user_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d.user_id
  FROM public.driver_presence p
  JOIN public.drivers d ON d.id = p.driver_id
  WHERE p.updated_at > now() - make_interval(mins => GREATEST(1, p_within_min))
    AND d.user_id IS NOT NULL
    AND COALESCE(d.is_frozen, false) = false
    AND COALESCE(d.is_blocked, false) = false
    AND p_lat IS NOT NULL AND p_lng IS NOT NULL
    AND (6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(p_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(p.lat))
        )))) <= GREATEST(0.5, LEAST(COALESCE(p_radius_km, 6), 20));
$$;

GRANT EXECUTE ON FUNCTION public.drivers_present_near(DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, INTEGER)
  TO authenticated, service_role;
