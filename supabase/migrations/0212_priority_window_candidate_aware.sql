-- =============================================================================
-- 0212 — Priorité dispatch « candidate-aware » : pas de délai inutile
-- =============================================================================
-- CORRECTION de correction : la fenêtre de priorité (0210) bloquait TOUT
-- non-prioritaire pendant N secondes, même quand AUCUN abonné Prioritaire n'était
-- en ligne à proximité → au lancement (peu/pas d'abonnés), chaque course subissait
-- un délai mort de N s pour rien.
--
-- Nouvelle règle : on ne réserve l'offre aux Prioritaires QUE si un candidat
-- prioritaire est réellement éligible (en ligne, à portée du dispatch). Sinon,
-- ouverture immédiate à tous. La priorité accélère pour les abonnés, ne pénalise
-- personne quand il n'y en a pas. Définition « en ligne à proximité » alignée sur
-- providers_online_near (présence < 5 min, rayon dispatch, non gelé/bloqué).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Existe-t-il un candidat PRIORITAIRE en ligne à proximité ? (hors p_exclude)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.priority_candidate_near(
  p_service text, p_lat double precision, p_lng double precision,
  p_radius_km numeric, p_exclude uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_radius NUMERIC := GREATEST(0.5, LEAST(COALESCE(p_radius_km, 8), 30));
  v_excl   UUID := COALESCE(p_exclude, '00000000-0000-0000-0000-000000000000');
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN false; END IF;

  IF p_service = 'drive' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.chauffeur_presence p
      JOIN public.chauffeurs c ON c.id = p.chauffeur_id
      WHERE p.is_online = true
        AND p.updated_at > now() - interval '5 minutes'
        AND c.id <> v_excl
        AND COALESCE(c.is_verified, false) = true
        AND COALESCE(c.is_frozen, false) = false
        AND COALESCE(c.is_blocked, false) = false
        AND public.is_priority('chauffeur', c.id)
        AND (6371 * acos(LEAST(1, GREATEST(-1,
              cos(radians(p_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(p_lng))
              + sin(radians(p_lat)) * sin(radians(p.lat)))))) <= v_radius
    );
  ELSIF p_service IN ('express', 'tour') THEN
    RETURN EXISTS (
      SELECT 1 FROM public.driver_presence p
      JOIN public.drivers d ON d.id = p.driver_id
      WHERE p.updated_at > now() - interval '5 minutes'
        AND d.id <> v_excl
        AND COALESCE(d.is_frozen, false) = false
        AND COALESCE(d.is_blocked, false) = false
        AND public.is_priority('driver', d.id)
        AND (6371 * acos(LEAST(1, GREATEST(-1,
              cos(radians(p_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(p_lng))
              + sin(radians(p_lat)) * sin(radians(p.lat)))))) <= v_radius
    );
  END IF;
  RETURN false;
END;
$$;
GRANT EXECUTE ON FUNCTION public.priority_candidate_near(text, double precision, double precision, numeric, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. OFFRE CHAUFFEUR (Drive) — garde candidate-aware.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chauffeur_offer_ride(p_ride_id uuid, p_price integer)
RETURNS TABLE(ok boolean, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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
  IF v_ride.status <> 'searching'
     OR (v_ride.expires_at IS NOT NULL AND v_ride.expires_at < now())
     OR (v_ride.payment_method = 'card' AND v_ride.online_paid_at IS NULL) THEN
    ok:=false; reason:='ride_not_open'; RETURN NEXT; RETURN;
  END IF;

  -- PRIORITÉ : réservé aux Prioritaires SEULEMENT si un candidat prioritaire est
  -- en ligne à proximité ET qu'on est encore dans la fenêtre. Sinon, ouvert.
  IF public.priority_window_blocks('chauffeur', v_ch.id, v_ride.created_at)
     AND public.priority_candidate_near('drive', v_ride.pickup_lat, v_ride.pickup_lng,
                                        s.drive_dispatch_radius_km, v_ch.id) THEN
    ok:=false; reason:='priority_window'; RETURN NEXT; RETURN;
  END IF;

  IF v_ride.payment_method = 'card'
     AND p_price <> v_ride.proposed_price_da + v_ride.boost_amount_da THEN
    ok:=false; reason:='prepaid_fixed_price'; RETURN NEXT; RETURN;
  END IF;

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

-- ----------------------------------------------------------------------------
-- 3. ASSIGNATION LIVREUR (express) — garde candidate-aware (proximité = marchand).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_gate_driver_assign()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_mlat DOUBLE PRECISION; v_mlng DOUBLE PRECISION; v_radius NUMERIC;
BEGIN
  IF NEW.delivery_driver_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.delivery_driver_id IS DISTINCT FROM OLD.delivery_driver_id) THEN
    -- Float (0186).
    IF NOT public.operator_can_operate_owner('driver', NEW.delivery_driver_id) THEN
      RAISE EXCEPTION 'Solde insuffisant : rechargez votre portefeuille pour accepter des livraisons.'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Priorité dispatch (express uniquement). Réservé aux Prioritaires SEULEMENT
    -- si un livreur prioritaire est en ligne près du marchand ET dans la fenêtre.
    IF NEW.delivery_mode = 'express'
       AND public.priority_window_blocks('driver', NEW.delivery_driver_id, NEW.created_at) THEN
      SELECT m.latitude, m.longitude INTO v_mlat, v_mlng
        FROM public.merchants m WHERE m.id = NEW.merchant_id;
      SELECT express_dispatch_radius_km INTO v_radius FROM public.platform_settings WHERE id = true;
      IF public.priority_candidate_near('express', v_mlat, v_mlng, v_radius, NEW.delivery_driver_id) THEN
        RAISE EXCEPTION 'Course réservée aux livreurs Prioritaires quelques secondes — réessayez.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
