-- =============================================================================
-- 0208 — Restauration de l'escrow Coligo Pay dans request_ride (régression)
-- =============================================================================
-- BUG préexistant découvert : l'escrow Coligo Pay des courses (mig 0145/0150/0163)
-- a été PERDU quand les migrations zones (0169/0172/0174) ont recréé request_ride
-- SANS réintégrer le bloc de réservation. Conséquence : une course payée en
-- « coligo_pay » ne réservait plus aucun fonds (escrow_da=0, solde client intact)
-- → un client pouvait commander sans provision. Démasqué en débloquant le garde
-- de float chauffeur.
--
-- Ce correctif reprend la request_ride ACTUELLE (moteur de zones 0174 INTACT) et
-- y réinjecte le bloc escrow de 0163 :
--   • coligo_pay : refus si solde vide ; sinon escrow = LEAST(solde, total),
--     complément = espèces (cash_due_da) ; débit topup_spent du séquestre.
--   • accept_ride_offer / ride_boost / complete_ride (déjà OK) ajustent ensuite.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.request_ride(
  p_pickup_lat double precision, p_pickup_lng double precision, p_pickup_text text,
  p_dest_lat double precision, p_dest_lng double precision, p_dest_text text,
  p_distance_km numeric, p_proposed_price integer,
  p_payment_method text DEFAULT 'cash'::text, p_gamme text DEFAULT 'classic'::text,
  p_boost_da integer DEFAULT 0, p_female_only boolean DEFAULT false,
  p_proxy_name text DEFAULT NULL::text, p_proxy_phone text DEFAULT NULL::text,
  p_operation_id text DEFAULT NULL::text,
  p_pickup_wilaya text DEFAULT NULL::text, p_pickup_commune text DEFAULT NULL::text,
  p_dest_wilaya text DEFAULT NULL::text, p_dest_commune text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  s public.platform_settings%ROWTYPE;
  v_customer UUID; v_female_ok BOOLEAN; v_suggest INTEGER; v_floor INTEGER;
  v_boost INTEGER; v_ride UUID; v_existing UUID;
  v_org RECORD; v_dst RECORD; v_max_km NUMERIC; v_geo_km NUMERIC;
  v_price INTEGER; v_total INTEGER; v_bal INTEGER; v_escrow INTEGER; v_cash INTEGER;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT cu.id, cu.is_female_verified INTO v_customer, v_female_ok
    FROM public.customers cu WHERE cu.user_id = auth.uid();
  IF v_customer IS NULL THEN RAISE EXCEPTION 'Profil client introuvable.' USING ERRCODE='check_violation'; END IF;
  IF p_payment_method NOT IN ('cash','card','coligo_pay') THEN p_payment_method := 'cash'; END IF;
  IF p_gamme NOT IN ('classic','confort','moto') THEN p_gamme := 'classic'; END IF;

  -- Idempotence : même opération → renvoyer la course existante.
  IF p_operation_id IS NOT NULL THEN
    SELECT r.id INTO v_existing FROM public.rides r
     WHERE r.customer_id = v_customer AND r.client_operation_id = p_operation_id;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  END IF;

  -- Anti-spam : une seule course active à la fois par client.
  IF EXISTS (SELECT 1 FROM public.rides WHERE customer_id = v_customer
             AND status IN ('searching','accepted','arriving','arrived','in_progress')) THEN
    RAISE EXCEPTION 'Vous avez déjà une course en cours.' USING ERRCODE='check_violation';
  END IF;

  -- « Femme au volant » : flag plateforme + cliente au profil vérifié.
  IF p_female_only AND NOT (s.drive_female_filter_enabled AND COALESCE(v_female_ok, false)) THEN
    p_female_only := false;
  END IF;

  -- === MOTEUR DE ZONES (0169/0174) : couverture départ + arrivée ===
  SELECT * INTO v_org FROM public.evaluate_service_zone(
    'drive', p_pickup_lat, p_pickup_lng, p_pickup_wilaya, p_pickup_commune, 'origin');
  IF NOT v_org.allowed THEN
    RAISE EXCEPTION 'drive_zone_origin:%', COALESCE(v_org.reason, 'blocked') USING ERRCODE='check_violation';
  END IF;
  SELECT * INTO v_dst FROM public.evaluate_service_zone(
    'drive', p_dest_lat, p_dest_lng, p_dest_wilaya, p_dest_commune, 'destination');
  IF NOT v_dst.allowed THEN
    RAISE EXCEPTION 'drive_zone_dest:%', COALESCE(v_dst.reason, 'blocked') USING ERRCODE='check_violation';
  END IF;
  -- Distance max recalculée CÔTÉ SERVEUR (Haversine), jamais p_distance_km (0172).
  v_max_km := public.service_max_distance_km('drive');
  IF v_max_km IS NOT NULL THEN
    v_geo_km := 6371 * acos(LEAST(1, GREATEST(-1,
      cos(radians(p_pickup_lat)) * cos(radians(p_dest_lat)) *
        cos(radians(p_dest_lng) - radians(p_pickup_lng))
      + sin(radians(p_pickup_lat)) * sin(radians(p_dest_lat)))));
    IF v_geo_km IS NOT NULL AND v_geo_km > v_max_km THEN
      RAISE EXCEPTION 'drive_zone_maxdist:%', v_max_km USING ERRCODE='check_violation';
    END IF;
  END IF;
  -- ===========================================================================

  v_suggest := public.drive_recommended_price(p_distance_km, p_gamme);
  v_floor   := public.drive_price_floor(p_distance_km, p_gamme);
  v_boost := GREATEST(0, COALESCE(p_boost_da, 0));
  IF v_boost > 0 THEN
    v_boost := GREATEST(s.drive_boost_min_da, round(v_boost::NUMERIC / s.drive_boost_step_da) * s.drive_boost_step_da)::INTEGER;
  END IF;
  v_price := GREATEST(v_floor, COALESCE(NULLIF(p_proposed_price, 0), v_suggest));
  v_total := v_price + v_boost;

  -- COLIGO PAY (mig 0145/0163, restauré) : réservation PARTIELLE — on bloque
  -- LEAST(solde, total) ; le complément se règle en espèces (cash_due_da).
  v_escrow := 0; v_cash := 0;
  IF p_payment_method = 'coligo_pay' THEN
    SELECT public.customer_topup_balance(v_customer) INTO v_bal;
    IF COALESCE(v_bal, 0) <= 0 THEN
      RAISE EXCEPTION 'Solde Coligo Pay vide — choisissez un autre moyen de paiement.' USING ERRCODE='check_violation';
    END IF;
    v_escrow := LEAST(v_bal, v_total);
    v_cash   := v_total - v_escrow;
  END IF;

  INSERT INTO public.rides (customer_id, status, pickup_lat, pickup_lng, pickup_text,
    dest_lat, dest_lng, dest_text, distance_km, suggested_price_da, proposed_price_da,
    payment_method, gamme, boost_amount_da, female_only, proxy_name, proxy_phone,
    client_operation_id, expires_at, escrow_da, cash_due_da)
  VALUES (v_customer, 'searching', p_pickup_lat, p_pickup_lng, p_pickup_text,
    p_dest_lat, p_dest_lng, p_dest_text, GREATEST(0, p_distance_km), v_suggest,
    v_price, p_payment_method, p_gamme, v_boost, p_female_only,
    NULLIF(btrim(COALESCE(p_proxy_name,'')),''), NULLIF(btrim(COALESCE(p_proxy_phone,'')),''),
    p_operation_id, now() + make_interval(mins => s.drive_request_ttl_min),
    v_escrow, v_cash)
  RETURNING id INTO v_ride;

  IF p_payment_method = 'coligo_pay' THEN
    INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
    VALUES (v_customer, NULL, 'topup_spent', 'topup', -v_escrow,
            'Réservation course Drive (séquestre)');
  END IF;

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (v_ride, NULL, 'searching',
    'Course demandée · ' || p_gamme
    || CASE WHEN v_boost > 0 THEN ' · boost +' || v_boost || ' DA' ELSE '' END
    || CASE WHEN p_female_only THEN ' · femme au volant' ELSE '' END
    || CASE WHEN p_payment_method = 'coligo_pay' THEN ' · ' || v_escrow || ' DA réservés (Coligo Pay)'
            || CASE WHEN v_cash > 0 THEN ' + ' || v_cash || ' DA en espèces' ELSE '' END
            WHEN p_payment_method = 'card' THEN ' · en attente du paiement carte' ELSE '' END);
  RETURN v_ride;
END;
$function$;
