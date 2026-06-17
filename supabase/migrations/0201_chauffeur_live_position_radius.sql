-- =============================================================================
-- 0201 — Dispatch chauffeur VERROUILLÉ sur la position GPS actuelle + expansion
-- =============================================================================
-- AVANT (0182/0183) : « Ma zone » = un CENTRE fixe + rayon. Si le chauffeur
-- définissait une zone, il ne voyait QUE les courses au départ de ce périmètre,
-- où qu'il soit — sa position GPS live était alors ignorée pour le dispatch.
--
-- DÉSORMAIS : le dispatch est TOUJOURS centré sur la position GPS live du
-- chauffeur (il se déplace → son rayon se déplace avec lui, partout en Algérie).
-- « Ma zone » ne choisit plus qu'un RAYON autour de soi :
--   • 3 km par défaut, ajustable jusqu'à 20 km (clamp serveur 3..20).
-- EXPANSION AUTO : s'il y a peu de demandes dans le rayon choisi, le système
-- complète avec les courses LES PLUS PROCHES au-delà du rayon (jusqu'à 20 km),
-- de sorte que le chauffeur ne reste jamais sans propositions s'il y en a aux
-- alentours — libre à lui de les accepter ou non.
--
-- Les colonnes work_zone_lat/lng ne servent plus de centre. work_zone_radius_km
-- est réutilisée comme « rayon choisi » (source de vérité serveur).
-- =============================================================================

-- 1) Migration des chauffeurs existants : on efface tout centre fixe (le
--    dispatch repart de la position live) et on conserve/clampe leur rayon.
UPDATE public.chauffeurs
   SET work_zone_lat = NULL,
       work_zone_lng = NULL,
       work_zone_radius_km = GREATEST(3, LEAST(COALESCE(work_zone_radius_km, 3), 20))
 WHERE work_zone_lat IS NOT NULL
    OR work_zone_lng IS NOT NULL
    OR work_zone_radius_km IS NOT NULL;

-- 2) RPC pour enregistrer le RAYON choisi (3..20 km). Efface tout centre fixe.
CREATE OR REPLACE FUNCTION public.set_chauffeur_search_radius(p_radius_km NUMERIC)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.chauffeurs
     SET work_zone_radius_km = GREATEST(3, LEAST(COALESCE(p_radius_km, 3), 20)),
         work_zone_lat = NULL,
         work_zone_lng = NULL
   WHERE user_id = auth.uid();
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_chauffeur_search_radius(NUMERIC) TO authenticated;

-- 3) Dispatch : centre = TOUJOURS la position live (p_lat/p_lng). Rayon =
--    préférence chauffeur (work_zone_radius_km), sinon rayon transmis, sinon 3.
--    Expansion automatique jusqu'à 20 km pour atteindre au moins v_min courses.
CREATE OR REPLACE FUNCTION public.chauffeur_nearby_rides(
  p_lat       DOUBLE PRECISION,
  p_lng       DOUBLE PRECISION,
  p_radius_km NUMERIC DEFAULT 3
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
  v_radius NUMERIC;            -- rayon choisi par le chauffeur (3..20)
  v_max    NUMERIC := 20;      -- plafond d'expansion automatique
  v_min    INTEGER := 6;       -- nb mini de courses visé avant d'élargir
BEGIN
  IF public.feature_blocked('drive') THEN RETURN; END IF;

  SELECT c.* INTO v_ch FROM public.chauffeurs c
  WHERE c.user_id = auth.uid()
    AND c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked;
  IF v_ch.id IS NULL OR p_lat IS NULL OR p_lng IS NULL THEN RETURN; END IF;
  v_female_online := public.drive_female_online();

  -- Rayon = préférence serveur (source de vérité, bypass-proof), sinon hint
  -- client, sinon 3 km. Clampé 3..20.
  v_radius := GREATEST(3, LEAST(
    COALESCE(NULLIF(v_ch.work_zone_radius_km, 0), p_radius_km, 3), v_max));

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
  -- Dans le rayon choisi → toujours ; sinon expansion : on garde les v_min plus
  -- proches au-delà (jusqu'à v_max) pour ne pas laisser le chauffeur à sec.
  WHERE k.pdist <= v_radius OR k.rn <= v_min
  ORDER BY (k.boost_amount_da > 0) DESC, k.created_at DESC
  LIMIT 30;
END;
$$;
