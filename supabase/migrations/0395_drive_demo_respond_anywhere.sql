-- =============================================================================
-- 0395 — Répondeur DÉMO : répond depuis N'IMPORTE QUELLE adresse
-- =============================================================================
-- Constat : les 13 chauffeurs de démo (is_demo) étaient TOUS hors ligne, et
-- `drive_demo_respond` exigeait qu'ils soient à ≤ 30 km du point de départ
-- avec une position FIXE (Alger, Béjaïa, Lille). Résultat : aucune offre dès
-- qu'on testait ailleurs — impossible de dérouler un parcours complet pour la
-- vidéo de démo exigée par l'App Store.
--
-- APRÈS : les démos sont « téléportés » au moment où ils répondent — présence
-- forcée en ligne à quelques centaines de mètres du départ demandé. Ils
-- répondent donc partout, et l'ETA / la distance affichés au client restent
-- plausibles (l'UI lit chauffeur_presence).
--
-- Ce que ça NE change PAS (garde-fous conservés) :
--   - seuls les comptes is_demo sont concernés — jamais un vrai chauffeur ;
--   - matching de GAMME et règle « femme au volant » inchangés (les scénarios
--     de test gardent leur valeur) ;
--   - un démo déjà en course ne re-propose pas (anti double-engagement) ;
--   - la 1re offre est au prix EXACT proposé par le client (« acceptation
--     directe »), les suivantes à +20/+40/+60 pour tester la négociation.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.drive_demo_respond(p_ride_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE;
  v_ride public.rides%ROWTYPE;
  v_total INTEGER;
  v_female_online BOOLEAN;
  v_n INTEGER := 0;
  rec RECORD;
  v_dlat DOUBLE PRECISION;
  v_dlng DOUBLE PRECISION;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride.id IS NULL OR v_ride.status <> 'searching'
     OR (v_ride.expires_at IS NOT NULL AND v_ride.expires_at < now())
     OR v_ride.pickup_lat IS NULL OR v_ride.pickup_lng IS NULL THEN
    RETURN 0;
  END IF;
  v_total := v_ride.proposed_price_da + COALESCE(v_ride.boost_amount_da, 0);
  v_female_online := public.drive_female_online();

  FOR rec IN
    SELECT c.id
    FROM public.chauffeurs c
    WHERE c.is_demo AND c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked
      AND (CASE c.gamme
            WHEN 'confort' THEN v_ride.gamme IN ('classic','confort')
            WHEN 'classic' THEN v_ride.gamme = 'classic'
            ELSE v_ride.gamme = 'moto' END)
      AND (NOT v_ride.female_only OR c.is_female_verified OR NOT v_female_online)
      AND NOT EXISTS (SELECT 1 FROM public.rides r2 WHERE r2.chauffeur_id = c.id
                      AND r2.status IN ('accepted','arriving','arrived','in_progress'))
      -- Plus AUCUN filtre de distance : un bot n'a pas de position réelle, il
      -- vient se placer près du client (ci-dessous).
    ORDER BY c.is_female_verified DESC, c.id
    LIMIT 4
  LOOP
    -- Téléportation : ~350 m à ~1,4 km du départ, en éventail, pour que les
    -- quatre offres n'aient pas la même distance ni le même ETA.
    v_dlat := 0.003 + (v_n * 0.0035);
    v_dlng := CASE WHEN v_n % 2 = 0 THEN 0.004 + (v_n * 0.002)
                   ELSE -(0.004 + (v_n * 0.002)) END;
    INSERT INTO public.chauffeur_presence AS cp
      (chauffeur_id, lat, lng, is_online, updated_at)
    VALUES (rec.id, v_ride.pickup_lat + v_dlat, v_ride.pickup_lng + v_dlng,
            true, now())
    ON CONFLICT (chauffeur_id) DO UPDATE
      SET lat = EXCLUDED.lat,
          lng = EXCLUDED.lng,
          is_online = true,
          updated_at = now();

    INSERT INTO public.ride_offers (ride_id, chauffeur_id, price_da, status, expires_at)
    VALUES (p_ride_id, rec.id,
      -- 1re offre = prix EXACT du client (le bot « accepte » la proposition).
      v_total + v_n * 20,
      'offered', now() + make_interval(mins => s.drive_offer_ttl_min))
    ON CONFLICT (ride_id, chauffeur_id) DO UPDATE
      SET price_da = EXCLUDED.price_da, status = 'offered',
          created_at = now(), expires_at = EXCLUDED.expires_at;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_demo_respond(uuid) TO service_role;

-- Les démos sans ligne de présence (Amina G., Walid Z.) en auront une dès leur
-- première réponse ; on les met tout de suite en ligne pour que l'écran
-- « chauffeurs disponibles » ne soit pas vide avant la 1re demande.
INSERT INTO public.chauffeur_presence (chauffeur_id, lat, lng, is_online, updated_at)
SELECT c.id, 36.7538, 3.0588, true, now()
  FROM public.chauffeurs c
 WHERE c.is_demo
ON CONFLICT (chauffeur_id) DO UPDATE
  SET is_online = true, updated_at = now();
