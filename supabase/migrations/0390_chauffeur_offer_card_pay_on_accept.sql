-- =============================================================================
-- 0390 — chauffeur_offer_ride : offres carte comme espèces (payer à l'accept.)
-- =============================================================================
-- BUG (suite 0386/0388) : chauffeur_offer_ride — l'RPC par laquelle un
-- chauffeur PROPOSE un prix — gardait encore deux règles de l'ancien modèle
-- « payer avant diffusion » :
--   1. rejet si course carte non payée → reason 'ride_not_open' : sous le
--      paiement à l'acceptation, une course carte est NON payée en recherche,
--      donc AUCUN chauffeur ne pouvait proposer → course bloquée en recherche
--      (relance de diffusion en boucle = notifications répétées) ;
--   2. 'prepaid_fixed_price' : le prix carte devait égaler EXACTEMENT le prix
--      client → négociation impossible, alors que tout le modèle repose sur des
--      offres à prix variés (le client paie le prix EXACT de l'offre acceptée).
-- Correctif : la carte se négocie comme les espèces. Le paiement du prix exact
-- reste à l'ACCEPTATION (drive_card_reserve_offer + webhook). Le plancher de
-- prix (below_floor) continue de s'appliquer à tous les moyens de paiement.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.chauffeur_offer_ride(p_ride_id uuid, p_price integer)
 RETURNS TABLE(ok boolean, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  s public.platform_settings%ROWTYPE;
  v_ch public.chauffeurs%ROWTYPE; v_ride public.rides%ROWTYPE; v_floor INTEGER;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT * INTO v_ch FROM public.chauffeurs
    WHERE user_id = auth.uid() AND is_verified AND NOT is_frozen AND NOT is_blocked;
  IF v_ch.id IS NULL THEN ok:=false; reason:='not_a_verified_chauffeur'; RETURN NEXT; RETURN; END IF;
  IF p_price IS NULL OR p_price <= 0 THEN ok:=false; reason:='bad_price'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN ok:=false; reason:='ride_not_found'; RETURN NEXT; RETURN; END IF;
  -- Carte comprise : une course en recherche non expirée est ouverte aux offres
  -- (paiement du prix convenu à l'acceptation, mig 0386/0390).
  IF v_ride.status <> 'searching'
     OR (v_ride.expires_at IS NOT NULL AND v_ride.expires_at < now()) THEN
    ok:=false; reason:='ride_not_open'; RETURN NEXT; RETURN;
  END IF;

  IF public.priority_window_blocks('chauffeur', v_ch.id, v_ride.created_at)
     AND public.priority_candidate_near('drive', v_ride.pickup_lat, v_ride.pickup_lng,
                                        s.drive_dispatch_radius_km, v_ch.id) THEN
    ok:=false; reason:='priority_window'; RETURN NEXT; RETURN;
  END IF;

  -- (Plus de 'prepaid_fixed_price' : la carte se négocie comme les espèces.)

  v_floor := public.drive_price_floor(v_ride.distance_km, v_ride.gamme);
  IF p_price < v_floor THEN ok:=false; reason:='below_floor'; RETURN NEXT; RETURN; END IF;

  IF NOT (CASE v_ch.gamme
            WHEN 'confort' THEN v_ride.gamme IN ('classic','confort')
            WHEN 'classic' THEN v_ride.gamme = 'classic'
            ELSE v_ride.gamme = 'moto'
          END) THEN
    ok:=false; reason:='gamme_mismatch'; RETURN NEXT; RETURN;
  END IF;

  IF v_ride.female_only AND NOT v_ch.is_female_verified AND public.drive_female_online() THEN
    ok:=false; reason:='female_only'; RETURN NEXT; RETURN;
  END IF;

  INSERT INTO public.ride_offers (ride_id, chauffeur_id, price_da, status, expires_at)
  VALUES (p_ride_id, v_ch.id, p_price, 'offered', now() + make_interval(mins => s.drive_offer_ttl_min))
  ON CONFLICT (ride_id, chauffeur_id) DO UPDATE
    SET price_da = EXCLUDED.price_da, status = 'offered', created_at = now(),
        expires_at = EXCLUDED.expires_at;
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$function$;
