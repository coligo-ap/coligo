-- ============================================================
-- 0147 — Drive : chauffeurs DÉMO « vivants »
-- Les comptes de démo (is_demo) restent visibles comme EN LIGNE
-- (exemption de la fenêtre de fraîcheur 3 min) et RÉPONDENT
-- automatiquement aux demandes (drive_demo_respond) : plusieurs
-- offres aux prix variés — dont des CONDUCTRICES — pour tester tout
-- le parcours (rose, gammes, favoris, PIN, SOS, annulation…).
-- ============================================================

ALTER TABLE public.chauffeurs
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

-- Conductrice « en ligne » : les démos comptent toujours.
CREATE OR REPLACE FUNCTION public.drive_female_online()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chauffeur_presence p
    JOIN public.chauffeurs c ON c.id = p.chauffeur_id
    WHERE p.is_online
      AND (p.updated_at > now() - INTERVAL '3 minutes' OR c.is_demo)
      AND c.is_female_verified AND c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked
  );
$$;

-- Diffusion : les démos en ligne sont toujours « fraîches ».
DROP FUNCTION IF EXISTS public.chauffeurs_present_near(DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, INTEGER, TEXT, BOOLEAN, UUID);
CREATE OR REPLACE FUNCTION public.chauffeurs_present_near(
  p_lat        DOUBLE PRECISION,
  p_lng        DOUBLE PRECISION,
  p_radius_km  NUMERIC DEFAULT 6,
  p_within_min INTEGER DEFAULT 3,
  p_gamme      TEXT DEFAULT NULL,
  p_female_only BOOLEAN DEFAULT false,
  p_customer_id UUID DEFAULT NULL
)
RETURNS TABLE(user_id UUID, chauffeur_id UUID, dist_km NUMERIC, is_premium BOOLEAN, is_favorite BOOLEAN, is_female BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_female_online BOOLEAN := false;
BEGIN
  IF COALESCE(p_female_only, false) THEN
    v_female_online := public.drive_female_online();
  END IF;
  RETURN QUERY
  SELECT ch.user_id, ch.id,
    (6371 * acos(LEAST(1, GREATEST(-1,
      cos(radians(p_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(p_lng))
      + sin(radians(p_lat)) * sin(radians(p.lat))))))::NUMERIC AS dist_km,
    (rp.plan = 'premium') AS is_premium,
    (p_customer_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.customer_favorite_chauffeurs f
       WHERE f.customer_id = p_customer_id AND f.chauffeur_id = ch.id)) AS is_favorite,
    ch.is_female_verified AS is_female
  FROM public.chauffeur_presence p
  JOIN public.chauffeurs ch ON ch.id = p.chauffeur_id
  CROSS JOIN LATERAL public.resolve_drive_plan(ch.id) rp
  WHERE p.is_online = true
    AND (p.updated_at > now() - make_interval(mins => GREATEST(1, p_within_min)) OR ch.is_demo)
    AND ch.user_id IS NOT NULL
    AND COALESCE(ch.is_verified, false) = true
    AND COALESCE(ch.is_frozen, false) = false
    AND COALESCE(ch.is_blocked, false) = false
    AND (p_gamme IS NULL OR (CASE ch.gamme
          WHEN 'confort' THEN p_gamme IN ('classic','confort')
          WHEN 'classic' THEN p_gamme = 'classic'
          ELSE p_gamme = 'moto' END))
    AND (NOT COALESCE(p_female_only,false) OR ch.is_female_verified OR NOT v_female_online)
    AND p_lat IS NOT NULL AND p_lng IS NOT NULL
    AND (6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(p_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(p.lat))
        )))) <= GREATEST(0.5, LEAST(COALESCE(p_radius_km, 6), 30))
  ORDER BY 4 DESC, 5 DESC, 3 ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chauffeurs_present_near(DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, INTEGER, TEXT, BOOLEAN, UUID)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- drive_demo_respond — les chauffeurs DÉMO éligibles font des offres
-- automatiques sur la demande : prix client (acceptation) + contre-offres
-- (+20/+40/+60), conductrices comprises ; carte prépayée = prix FIXE pour
-- toutes les offres. Jusqu'à 4 offres, du plus proche au plus loin.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_demo_respond(p_ride_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE;
  v_ride public.rides%ROWTYPE;
  v_total INTEGER; v_female_online BOOLEAN; v_n INTEGER := 0; rec RECORD;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride.id IS NULL OR v_ride.status <> 'searching'
     OR (v_ride.expires_at IS NOT NULL AND v_ride.expires_at < now())
     OR (v_ride.payment_method = 'card' AND v_ride.online_paid_at IS NULL) THEN
    RETURN 0;
  END IF;
  v_total := v_ride.proposed_price_da + v_ride.boost_amount_da;
  v_female_online := public.drive_female_online();

  FOR rec IN
    SELECT c.id,
      (6371 * acos(LEAST(1, GREATEST(-1,
        cos(radians(v_ride.pickup_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(v_ride.pickup_lng))
        + sin(radians(v_ride.pickup_lat)) * sin(radians(p.lat)))))) AS dist
    FROM public.chauffeurs c
    JOIN public.chauffeur_presence p ON p.chauffeur_id = c.id
    WHERE c.is_demo AND c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked
      AND p.is_online
      -- Matching gammes (règles dures, identiques à chauffeur_offer_ride)
      AND (CASE c.gamme
            WHEN 'confort' THEN v_ride.gamme IN ('classic','confort')
            WHEN 'classic' THEN v_ride.gamme = 'classic'
            ELSE v_ride.gamme = 'moto' END)
      -- Femme au volant : conductrices uniquement (repli si aucune en ligne)
      AND (NOT v_ride.female_only OR c.is_female_verified OR NOT v_female_online)
      -- Anti double-engagement : pas d'offre si le démo est déjà en course
      AND NOT EXISTS (SELECT 1 FROM public.rides r2 WHERE r2.chauffeur_id = c.id
                      AND r2.status IN ('accepted','arriving','arrived','in_progress'))
      AND (6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(v_ride.pickup_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(v_ride.pickup_lng))
            + sin(radians(v_ride.pickup_lat)) * sin(radians(p.lat)))))) <= 30
    ORDER BY dist ASC
    LIMIT 4
  LOOP
    INSERT INTO public.ride_offers (ride_id, chauffeur_id, price_da, status, expires_at)
    VALUES (p_ride_id, rec.id,
      -- Carte = prix fixe ; sinon : 1re offre au prix client, puis +20/+40/+60.
      CASE WHEN v_ride.payment_method = 'card' THEN v_total ELSE v_total + v_n * 20 END,
      'offered', now() + make_interval(mins => s.drive_offer_ttl_min))
    ON CONFLICT (ride_id, chauffeur_id) DO UPDATE
      SET price_da = EXCLUDED.price_da, status = 'offered',
          created_at = now(), expires_at = EXCLUDED.expires_at;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_demo_respond(UUID) TO service_role;

-- Marque les comptes de démo existants.
UPDATE public.chauffeurs SET is_demo = true WHERE phone LIKE '05501000%';
