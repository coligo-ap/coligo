-- =============================================================================
-- 0171 — Disponibilité TEMPS RÉEL des prestataires près d'un point (compte)
-- =============================================================================
-- Pour l'UX « Aucun/peu de livreur·chauffeur disponible » (SOFT, non-bloquant).
-- Renvoie un simple COMPTE (jamais d'identités → pas de fuite) de prestataires
-- EN LIGNE et RÉCENTS dans un rayon :
--   • express / tour → livreurs présents (driver_presence, mig 0130) non gelés/bloqués
--   • drive          → chauffeurs en ligne (chauffeur_presence) vérifiés, non gelés/bloqués
-- =============================================================================

CREATE OR REPLACE FUNCTION public.providers_online_near(
  p_service     TEXT,
  p_lat         DOUBLE PRECISION,
  p_lng         DOUBLE PRECISION,
  p_radius_km   NUMERIC DEFAULT 8,
  p_within_min  INTEGER DEFAULT 5
) RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER := 0;
  v_radius NUMERIC := GREATEST(0.5, LEAST(COALESCE(p_radius_km, 8), 30));
  v_mins   INTEGER := GREATEST(1, COALESCE(p_within_min, 5));
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN 0; END IF;

  IF p_service = 'drive' THEN
    SELECT count(*) INTO v_count
    FROM public.chauffeur_presence p
    JOIN public.chauffeurs c ON c.id = p.chauffeur_id
    WHERE p.is_online = true
      AND p.updated_at > now() - make_interval(mins => v_mins)
      AND c.user_id IS NOT NULL
      AND COALESCE(c.is_verified, false) = true
      AND COALESCE(c.is_frozen, false) = false
      AND COALESCE(c.is_blocked, false) = false
      AND (6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(p_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(p_lng))
            + sin(radians(p_lat)) * sin(radians(p.lat)))))) <= v_radius;
  ELSIF p_service IN ('express', 'tour') THEN
    SELECT count(*) INTO v_count
    FROM public.driver_presence p
    JOIN public.drivers d ON d.id = p.driver_id
    WHERE p.updated_at > now() - make_interval(mins => v_mins)
      AND d.user_id IS NOT NULL
      AND COALESCE(d.is_frozen, false) = false
      AND COALESCE(d.is_blocked, false) = false
      AND (6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(p_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(p_lng))
            + sin(radians(p_lat)) * sin(radians(p.lat)))))) <= v_radius;
  ELSE
    RETURN 0;
  END IF;

  RETURN COALESCE(v_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.providers_online_near(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, INTEGER)
  TO authenticated, service_role;

-- =============================================================================
-- VÉRIF : SELECT public.providers_online_near('drive', 36.75, 5.07, 8);
-- =============================================================================
