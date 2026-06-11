-- ============================================================
-- 0150 — CORRECTIF : la mig 0149 avait recréé request_ride /
-- chauffeur_offer_ride / chauffeur_nearby_rides depuis la version
-- 0140, écrasant la logique séquestre/carte de la mig 0145.
-- Ici : fusion 0145 (Coligo Pay réservé, carte payée avant
-- diffusion, prix fixe carte) + 0149 (prix suggéré intelligent,
-- plancher de contre-offre, refus chauffeur).
-- ============================================================

-- ---------------------------------------------------------------------------
-- request_ride v4 — séquestre Coligo Pay (0145) + suggestion intelligente (0149).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_ride(
  p_pickup_lat   DOUBLE PRECISION,
  p_pickup_lng   DOUBLE PRECISION,
  p_pickup_text  TEXT,
  p_dest_lat     DOUBLE PRECISION,
  p_dest_lng     DOUBLE PRECISION,
  p_dest_text    TEXT,
  p_distance_km  NUMERIC,
  p_proposed_price INTEGER,
  p_payment_method TEXT DEFAULT 'cash',
  p_gamme        TEXT DEFAULT 'classic',
  p_boost_da     INTEGER DEFAULT 0,
  p_female_only  BOOLEAN DEFAULT false,
  p_proxy_name   TEXT DEFAULT NULL,
  p_proxy_phone  TEXT DEFAULT NULL,
  p_operation_id TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE;
  v_customer UUID; v_female_ok BOOLEAN; v_suggest INTEGER; v_floor INTEGER;
  v_boost INTEGER; v_ride UUID; v_existing UUID; v_total INTEGER; v_bal INTEGER;
  v_price INTEGER;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT cu.id, cu.is_female_verified INTO v_customer, v_female_ok
    FROM public.customers cu WHERE cu.user_id = auth.uid();
  IF v_customer IS NULL THEN RAISE EXCEPTION 'Profil client introuvable.' USING ERRCODE='check_violation'; END IF;
  IF p_payment_method NOT IN ('cash','card','coligo_pay') THEN p_payment_method := 'cash'; END IF;
  IF p_gamme NOT IN ('classic','confort','moto') THEN p_gamme := 'classic'; END IF;

  IF p_operation_id IS NOT NULL THEN
    SELECT r.id INTO v_existing FROM public.rides r
     WHERE r.customer_id = v_customer AND r.client_operation_id = p_operation_id;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.rides WHERE customer_id = v_customer
             AND status IN ('searching','accepted','arriving','arrived','in_progress')) THEN
    RAISE EXCEPTION 'Vous avez déjà une course en cours.' USING ERRCODE='check_violation';
  END IF;

  IF p_female_only AND NOT (s.drive_female_filter_enabled AND COALESCE(v_female_ok, false)) THEN
    p_female_only := false;
  END IF;

  -- Prix suggéré INTELLIGENT (mig 0149) — sert de référence à l'apprentissage.
  SELECT q.reco_da INTO v_suggest
    FROM public.drive_smart_quote(p_distance_km, p_gamme, p_pickup_lat, p_pickup_lng) q;
  v_floor   := public.drive_price_floor(p_distance_km, p_gamme);
  v_boost := GREATEST(0, COALESCE(p_boost_da, 0));
  IF v_boost > 0 THEN
    v_boost := GREATEST(s.drive_boost_min_da, round(v_boost::NUMERIC / s.drive_boost_step_da) * s.drive_boost_step_da)::INTEGER;
  END IF;
  v_price := GREATEST(v_floor, COALESCE(NULLIF(p_proposed_price, 0), v_suggest));
  v_total := v_price + v_boost;

  -- COLIGO PAY : solde vérifié AVANT validation, montant réservé immédiatement.
  IF p_payment_method = 'coligo_pay' THEN
    SELECT public.customer_topup_balance(v_customer) INTO v_bal;
    IF COALESCE(v_bal, 0) < v_total THEN
      RAISE EXCEPTION 'Solde Coligo Pay insuffisant (% DA requis).', v_total USING ERRCODE='check_violation';
    END IF;
  END IF;

  INSERT INTO public.rides (customer_id, status, pickup_lat, pickup_lng, pickup_text,
    dest_lat, dest_lng, dest_text, distance_km, suggested_price_da, proposed_price_da,
    payment_method, gamme, boost_amount_da, female_only, proxy_name, proxy_phone,
    client_operation_id, expires_at, escrow_da)
  VALUES (v_customer, 'searching', p_pickup_lat, p_pickup_lng, p_pickup_text,
    p_dest_lat, p_dest_lng, p_dest_text, GREATEST(0, p_distance_km), v_suggest,
    v_price, p_payment_method, p_gamme, v_boost, p_female_only,
    NULLIF(btrim(COALESCE(p_proxy_name,'')),''), NULLIF(btrim(COALESCE(p_proxy_phone,'')),''),
    p_operation_id, now() + make_interval(mins => s.drive_request_ttl_min),
    CASE WHEN p_payment_method = 'coligo_pay' THEN v_total ELSE 0 END)
  RETURNING id INTO v_ride;

  IF p_payment_method = 'coligo_pay' THEN
    INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
    VALUES (v_customer, NULL, 'topup_spent', 'topup', -v_total,
            'Réservation course Drive (séquestre)');
  END IF;

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (v_ride, NULL, 'searching',
    'Course demandée · ' || p_gamme
    || CASE WHEN v_boost > 0 THEN ' · boost +' || v_boost || ' DA' ELSE '' END
    || CASE WHEN p_female_only THEN ' · femme au volant' ELSE '' END
    || CASE WHEN p_payment_method = 'coligo_pay' THEN ' · ' || v_total || ' DA réservés (Coligo Pay)'
            WHEN p_payment_method = 'card' THEN ' · en attente du paiement carte' ELSE '' END);
  RETURN v_ride;
END;
$$;

-- ---------------------------------------------------------------------------
-- chauffeur_nearby_rides v5 — carte payée avant diffusion (0145) +
-- demandes refusées masquées (0149).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chauffeur_nearby_rides(
  p_lat       DOUBLE PRECISION,
  p_lng       DOUBLE PRECISION,
  p_radius_km NUMERIC DEFAULT 8
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
BEGIN
  SELECT c.* INTO v_ch FROM public.chauffeurs c
  WHERE c.user_id = auth.uid()
    AND c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked;
  IF v_ch.id IS NULL OR p_lat IS NULL OR p_lng IS NULL THEN RETURN; END IF;
  v_female_online := public.drive_female_online();

  RETURN QUERY
  SELECT r.id, r.pickup_text, r.dest_text,
         r.pickup_lat, r.pickup_lng, r.dest_lat, r.dest_lng,
         r.distance_km, r.proposed_price_da, r.suggested_price_da,
         r.boost_amount_da, r.gamme, r.female_only, r.payment_method,
         (6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(p_lat)) * cos(radians(r.pickup_lat)) * cos(radians(r.pickup_lng) - radians(p_lng))
            + sin(radians(p_lat)) * sin(radians(r.pickup_lat))))))::NUMERIC AS pickup_dist_km,
         r.created_at,
         (SELECT o.price_da FROM public.ride_offers o
           WHERE o.ride_id = r.id AND o.chauffeur_id = v_ch.id AND o.status = 'offered') AS my_offer_da,
         COALESCE(NULLIF(split_part(cu.full_name, ' ', 1), ''), 'Client') AS customer_name,
         (SELECT round(avg(r2.client_rating)::NUMERIC, 1) FROM public.rides r2
           WHERE r2.customer_id = r.customer_id AND r2.client_rating IS NOT NULL) AS customer_rating,
         cu.created_at AS customer_since
  FROM public.rides r
  JOIN public.customers cu ON cu.id = r.customer_id
  WHERE r.status = 'searching'
    AND (r.expires_at IS NULL OR r.expires_at > now())
    -- Carte : payée AVANT diffusion (le webhook seul fait foi).
    AND (r.payment_method <> 'card' OR r.online_paid_at IS NOT NULL)
    -- Refusée par ce chauffeur → ne plus la lui montrer.
    AND NOT EXISTS (SELECT 1 FROM public.ride_offers od
                    WHERE od.ride_id = r.id AND od.chauffeur_id = v_ch.id AND od.status = 'declined')
    AND (CASE v_ch.gamme
          WHEN 'confort' THEN r.gamme IN ('classic','confort')
          WHEN 'classic' THEN r.gamme = 'classic'
          ELSE r.gamme = 'moto' END)
    AND (NOT r.female_only OR v_ch.is_female_verified OR NOT v_female_online)
    AND (6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(p_lat)) * cos(radians(r.pickup_lat)) * cos(radians(r.pickup_lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(r.pickup_lat)))))) <= GREATEST(0.5, LEAST(COALESCE(p_radius_km, 8), 30))
  ORDER BY (r.boost_amount_da > 0) DESC, r.created_at DESC
  LIMIT 30;
END;
$$;

-- ---------------------------------------------------------------------------
-- chauffeur_offer_ride v5 — carte = prix fixe (0145) + plancher silencieux
-- des contre-offres (0149 : libre au-dessus OU en dessous, jamais sous floor).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chauffeur_offer_ride(
  p_ride_id UUID, p_price INTEGER
) RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
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

  -- Carte prépayée : montant déjà encaissé → prix fixe, pas de contre-offre.
  IF v_ride.payment_method = 'card'
     AND p_price <> v_ride.proposed_price_da + v_ride.boost_amount_da THEN
    ok:=false; reason:='prepaid_fixed_price'; RETURN NEXT; RETURN;
  END IF;

  -- Plancher silencieux : la contre-offre peut descendre SOUS le prix client,
  -- jamais sous le plancher (anti-bradage des 2 côtés).
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
$$;
