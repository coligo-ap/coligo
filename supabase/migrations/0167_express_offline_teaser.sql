-- =============================================================================
-- 0167 — Notifs livreur : distinction EN LIGNE vs HORS LIGNE pour l'Express
-- =============================================================================
-- Règle produit (demande fondateur) :
--   • Express + livreur EN LIGNE  → push par course « Nouvelle course Express ⚡ »
--     (déjà fait via drivers_present_near = heartbeat récent).
--   • Express + livreur HORS LIGNE → PAS de push par course. À la place, un
--     TEASER agrégé throttlé : « N livraisons express autour de toi, mets-toi en
--     ligne, gagne de l'argent… » (reçu même app fermée sur Android natif).
--   • Tournée → push aux livreurs inscrits actifs (déjà fait, indépendant du
--     statut en ligne).
--
-- `driver_presence` garde la DERNIÈRE position connue même hors ligne (le
-- heartbeat ne tourne qu'en ligne) → un livreur dont la présence est PÉRIMÉE
-- mais proche du commerçant = hors ligne mais localisable = cible du teaser.
-- =============================================================================

ALTER TABLE public.driver_presence
  ADD COLUMN IF NOT EXISTS last_teaser_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- Cibles du teaser Express hors-ligne : livreurs dont la dernière position est
-- dans le rayon du commerçant, NON présents (heartbeat périmé = hors ligne),
-- non gelés/bloqués, pas déjà teasés depuis < throttle. Marque last_teaser_at
-- (atomique) pour éviter le spam. Renvoie aussi le nombre de courses express
-- disponibles autour (proxy = commerçants proches), pour le corps du message.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.express_teaser_targets(
  p_merchant_id  UUID,
  p_radius_km    NUMERIC DEFAULT 8,
  p_present_min  INTEGER DEFAULT 3,
  p_throttle_min INTEGER DEFAULT 30
) RETURNS TABLE(user_id UUID, available_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lat   DOUBLE PRECISION;
  v_lng   DOUBLE PRECISION;
  v_count INTEGER;
  v_rad   NUMERIC := GREATEST(1, LEAST(COALESCE(p_radius_km, 8), 30));
BEGIN
  SELECT latitude, longitude INTO v_lat, v_lng
  FROM public.merchants WHERE id = p_merchant_id;
  IF v_lat IS NULL OR v_lng IS NULL THEN RETURN; END IF;

  -- Nb de courses express NON attribuées autour (tous commerçants dans le rayon).
  SELECT count(*) INTO v_count
  FROM public.orders o
  JOIN public.merchants m ON m.id = o.merchant_id
  WHERE o.fulfillment_type = 'delivery'
    AND o.delivery_mode = 'express'
    AND o.delivery_driver_id IS NULL
    AND o.status IN ('preparing', 'ready')
    AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
    AND (6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(v_lat)) * cos(radians(m.latitude)) * cos(radians(m.longitude) - radians(v_lng))
          + sin(radians(v_lat)) * sin(radians(m.latitude))
        )))) <= v_rad;

  IF COALESCE(v_count, 0) = 0 THEN RETURN; END IF;

  RETURN QUERY
  WITH targets AS (
    SELECT d.user_id AS uid, p.driver_id AS did
    FROM public.driver_presence p
    JOIN public.drivers d ON d.id = p.driver_id
    WHERE d.user_id IS NOT NULL
      AND COALESCE(d.is_frozen, false) = false
      AND COALESCE(d.is_blocked, false) = false
      -- HORS LIGNE : heartbeat plus récent que present_min = en ligne → exclu.
      AND p.updated_at <= now() - make_interval(mins => GREATEST(1, p_present_min))
      -- Throttle anti-spam.
      AND (p.last_teaser_at IS NULL
           OR p.last_teaser_at < now() - make_interval(mins => GREATEST(5, p_throttle_min)))
      -- Dernière position connue dans le rayon.
      AND (6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(v_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(v_lng))
            + sin(radians(v_lat)) * sin(radians(p.lat))
          )))) <= v_rad
  ), marked AS (
    UPDATE public.driver_presence dp
       SET last_teaser_at = now()
      FROM targets t
     WHERE dp.driver_id = t.did
    RETURNING t.uid AS uid
  )
  SELECT uid, v_count FROM marked;
END;
$$;

GRANT EXECUTE ON FUNCTION public.express_teaser_targets(UUID, NUMERIC, INTEGER, INTEGER)
  TO service_role;
