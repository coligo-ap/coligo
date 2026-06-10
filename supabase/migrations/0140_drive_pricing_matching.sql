-- ============================================================
-- 0140 — Coligo Drive : prix par gamme, matching, négociation v2
-- • Prix recommandé par gamme + nuit 22h–6h (≤ +20 %, JAMAIS affichée)
-- • Plancher silencieux (clamp algorithmique, jamais une option UI)
-- • Matching gammes : Confort reçoit Classic+Confort · Classic→Classic ·
--   Moto↔Moto · Femme au volant (repli si aucune conductrice en ligne)
-- • Anti double-engagement : un chauffeur verrouillé sur UNE course,
--   première acceptation gagne, ses autres propositions s'annulent
-- • TTL demandes/propositions · partage t/{token} · favoris · notation ·
--   signalements · « je rentre chez moi » (2/jour) · back-to-back
-- ============================================================

-- Champ anti-spam « conductrice en ligne » (notification de repli)
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS female_notified_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- Prix recommandé par gamme (base + DA/km, nuit ≤ +20 % silencieuse, pas de 5)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_recommended_price(
  p_distance_km NUMERIC, p_gamme TEXT DEFAULT 'classic', p_at TIMESTAMPTZ DEFAULT now()
) RETURNS INTEGER LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE;
  g JSONB; v_base NUMERIC; v_pkm NUMERIC; v_min NUMERIC; v_px NUMERIC; v_h INTEGER;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  g := s.drive_pricing -> COALESCE(NULLIF(p_gamme,''), 'classic');
  IF g IS NULL THEN g := s.drive_pricing -> 'classic'; END IF;
  v_base := COALESCE((g->>'base')::NUMERIC, s.vtc_base_da);
  v_pkm  := COALESCE((g->>'per_km')::NUMERIC, s.vtc_per_km_da);
  v_min  := COALESCE((g->>'min')::NUMERIC, s.vtc_min_da);
  v_px := v_base + GREATEST(0, COALESCE(p_distance_km,0)) * v_pkm;
  -- Majoration nuit (Africa/Algiers), plafonnée, jamais montrée au client.
  v_h := EXTRACT(HOUR FROM (p_at AT TIME ZONE 'Africa/Algiers'))::INTEGER;
  IF (s.drive_night_start_h > s.drive_night_end_h AND (v_h >= s.drive_night_start_h OR v_h < s.drive_night_end_h))
     OR (s.drive_night_start_h <= s.drive_night_end_h AND v_h >= s.drive_night_start_h AND v_h < s.drive_night_end_h) THEN
    v_px := v_px * (1 + LEAST(s.drive_night_coef, 0.20));
  END IF;
  RETURN GREATEST(v_min, round(v_px / 5) * 5)::INTEGER;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_recommended_price(NUMERIC, TEXT, TIMESTAMPTZ) TO authenticated, anon;

-- Plancher silencieux : max(plancher gamme, coef × prix recommandé de jour).
CREATE OR REPLACE FUNCTION public.drive_price_floor(
  p_distance_km NUMERIC, p_gamme TEXT DEFAULT 'classic'
) RETURNS INTEGER LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE; g JSONB; v_min NUMERIC; v_day NUMERIC;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  g := s.drive_pricing -> COALESCE(NULLIF(p_gamme,''), 'classic');
  IF g IS NULL THEN g := s.drive_pricing -> 'classic'; END IF;
  v_min := COALESCE((g->>'min')::NUMERIC, s.vtc_min_da);
  v_day := COALESCE((g->>'base')::NUMERIC, s.vtc_base_da)
           + GREATEST(0, COALESCE(p_distance_km,0)) * COALESCE((g->>'per_km')::NUMERIC, s.vtc_per_km_da);
  RETURN GREATEST(v_min, round(v_day * s.drive_floor_rate / 5) * 5)::INTEGER;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_price_floor(NUMERIC, TEXT) TO authenticated, anon;

-- Fourchette « Courses similaires : X–Y DA » (courses réelles, repli barème).
CREATE OR REPLACE FUNCTION public.drive_similar_range(
  p_distance_km NUMERIC, p_gamme TEXT DEFAULT 'classic'
) RETURNS TABLE(low_da INTEGER, high_da INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_lo INTEGER; v_hi INTEGER; v_reco INTEGER;
BEGIN
  SELECT (round(percentile_cont(0.25) WITHIN GROUP (ORDER BY r.agreed_price_da) / 5) * 5)::INTEGER,
         (round(percentile_cont(0.75) WITHIN GROUP (ORDER BY r.agreed_price_da) / 5) * 5)::INTEGER
    INTO v_lo, v_hi
  FROM public.rides r
  WHERE r.status = 'completed' AND r.gamme = COALESCE(NULLIF(p_gamme,''),'classic')
    AND r.agreed_price_da IS NOT NULL
    AND r.distance_km BETWEEN GREATEST(0, p_distance_km) * 0.7 AND GREATEST(0.1, p_distance_km) * 1.3
    AND r.completed_at > now() - INTERVAL '60 days';
  IF v_lo IS NULL OR v_hi IS NULL OR v_hi <= 0 THEN
    v_reco := public.drive_recommended_price(p_distance_km, p_gamme);
    v_lo := (round(v_reco * 0.90 / 5) * 5)::INTEGER;
    v_hi := (round(v_reco * 1.10 / 5) * 5)::INTEGER;
  END IF;
  low_da := v_lo; high_da := v_hi; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_similar_range(NUMERIC, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Plan d'abonnement effectif d'un chauffeur (free / pro / premium)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_drive_plan(p_chauffeur_id UUID)
RETURNS TABLE(plan TEXT, rate NUMERIC, fee_da INTEGER, period_end TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE s public.platform_settings%ROWTYPE; v_sub public.chauffeur_subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT * INTO v_sub FROM public.chauffeur_subscriptions cs
   WHERE cs.chauffeur_id = p_chauffeur_id AND cs.status = 'active' AND cs.period_end >= now()
   ORDER BY cs.period_end DESC LIMIT 1;
  IF v_sub.id IS NULL THEN
    plan := 'free'; rate := s.vtc_commission_rate; fee_da := 0; period_end := NULL;
  ELSIF v_sub.plan = 'premium' THEN
    plan := 'premium'; rate := s.drive_plan_premium_rate; fee_da := s.drive_plan_premium_fee_da; period_end := v_sub.period_end;
  ELSE
    plan := 'pro'; rate := s.drive_plan_pro_rate; fee_da := s.drive_plan_pro_fee_da; period_end := v_sub.period_end;
  END IF;
  RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_drive_plan(UUID) TO authenticated;

-- La commission VTC effective lit désormais le plan.
CREATE OR REPLACE FUNCTION public.resolve_vtc_commission(p_chauffeur_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT rate FROM public.resolve_drive_plan(p_chauffeur_id);
$$;

-- ---------------------------------------------------------------------------
-- Conductrices en ligne ? (pour le filtre « Femme au volant » + repli)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_female_online()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chauffeur_presence p
    JOIN public.chauffeurs c ON c.id = p.chauffeur_id
    WHERE p.is_online AND p.updated_at > now() - INTERVAL '3 minutes'
      AND c.is_female_verified AND c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked
  );
$$;
GRANT EXECUTE ON FUNCTION public.drive_female_online() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- request_ride v2 — gamme, boost, conductrice, proche, idempotence, TTL.
-- (ancienne signature supprimée pour éviter l'ambiguïté PostgREST)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.request_ride(DOUBLE PRECISION,DOUBLE PRECISION,TEXT,DOUBLE PRECISION,DOUBLE PRECISION,TEXT,NUMERIC,INTEGER,TEXT);
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
  v_boost INTEGER; v_ride UUID; v_existing UUID;
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

  v_suggest := public.drive_recommended_price(p_distance_km, p_gamme);
  v_floor   := public.drive_price_floor(p_distance_km, p_gamme);
  -- Boost : min config, pas de 5, jamais négatif.
  v_boost := GREATEST(0, COALESCE(p_boost_da, 0));
  IF v_boost > 0 THEN
    v_boost := GREATEST(s.drive_boost_min_da, round(v_boost::NUMERIC / s.drive_boost_step_da) * s.drive_boost_step_da)::INTEGER;
  END IF;

  INSERT INTO public.rides (customer_id, status, pickup_lat, pickup_lng, pickup_text,
    dest_lat, dest_lng, dest_text, distance_km, suggested_price_da, proposed_price_da,
    payment_method, gamme, boost_amount_da, female_only, proxy_name, proxy_phone,
    client_operation_id, expires_at)
  VALUES (v_customer, 'searching', p_pickup_lat, p_pickup_lng, p_pickup_text,
    p_dest_lat, p_dest_lng, p_dest_text, GREATEST(0, p_distance_km), v_suggest,
    -- Clamp PLANCHER silencieux (jamais affiché comme option côté client).
    GREATEST(v_floor, COALESCE(NULLIF(p_proposed_price, 0), v_suggest)),
    p_payment_method, p_gamme, v_boost, p_female_only,
    NULLIF(btrim(COALESCE(p_proxy_name,'')),''), NULLIF(btrim(COALESCE(p_proxy_phone,'')),''),
    p_operation_id, now() + make_interval(mins => s.drive_request_ttl_min))
  RETURNING id INTO v_ride;

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (v_ride, NULL, 'searching',
    'Course demandée · ' || p_gamme
    || CASE WHEN v_boost > 0 THEN ' · boost +' || v_boost || ' DA' ELSE '' END
    || CASE WHEN p_female_only THEN ' · femme au volant' ELSE '' END);
  RETURN v_ride;
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_ride(DOUBLE PRECISION,DOUBLE PRECISION,TEXT,DOUBLE PRECISION,DOUBLE PRECISION,TEXT,NUMERIC,INTEGER,TEXT,TEXT,INTEGER,BOOLEAN,TEXT,TEXT,TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- ride_boost — booster (ou re-booster) pendant la recherche.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ride_boost(p_ride_id UUID, p_boost_da INTEGER)
RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE s public.platform_settings%ROWTYPE; v_cust UUID; v_ride public.rides%ROWTYPE; v_boost INTEGER;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT id INTO v_cust FROM public.customers WHERE user_id = auth.uid();
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL OR v_ride.customer_id IS DISTINCT FROM v_cust THEN
    ok:=false; reason:='not_your_ride'; RETURN NEXT; RETURN;
  END IF;
  IF v_ride.status <> 'searching' THEN ok:=false; reason:='ride_not_open'; RETURN NEXT; RETURN; END IF;
  v_boost := GREATEST(s.drive_boost_min_da,
    round(GREATEST(0, COALESCE(p_boost_da,0))::NUMERIC / s.drive_boost_step_da) * s.drive_boost_step_da)::INTEGER;
  UPDATE public.rides SET boost_amount_da = v_boost WHERE id = p_ride_id;
  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (p_ride_id, 'searching', 'searching', 'Boost +' || v_boost || ' DA');
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ride_boost(UUID, INTEGER) TO authenticated;

-- ---------------------------------------------------------------------------
-- chauffeur_offer_ride v2 — matching gammes + conductrice + TTL proposition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chauffeur_offer_ride(
  p_ride_id UUID, p_price INTEGER
) RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE;
  v_ch public.chauffeurs%ROWTYPE; v_ride public.rides%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT * INTO v_ch FROM public.chauffeurs
    WHERE user_id = auth.uid() AND is_verified AND NOT is_frozen AND NOT is_blocked;
  IF v_ch.id IS NULL THEN ok:=false; reason:='not_a_verified_chauffeur'; RETURN NEXT; RETURN; END IF;
  IF p_price IS NULL OR p_price <= 0 THEN ok:=false; reason:='bad_price'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN ok:=false; reason:='ride_not_found'; RETURN NEXT; RETURN; END IF;
  IF v_ride.status <> 'searching'
     OR (v_ride.expires_at IS NOT NULL AND v_ride.expires_at < now()) THEN
    ok:=false; reason:='ride_not_open'; RETURN NEXT; RETURN;
  END IF;

  -- Matching gammes (règles dures) : Confort → Classic+Confort · Classic →
  -- Classic · Moto ↔ Moto.
  IF NOT (CASE v_ch.gamme
            WHEN 'confort' THEN v_ride.gamme IN ('classic','confort')
            WHEN 'classic' THEN v_ride.gamme = 'classic'
            ELSE v_ride.gamme = 'moto'
          END) THEN
    ok:=false; reason:='gamme_mismatch'; RETURN NEXT; RETURN;
  END IF;

  -- Femme au volant : seules les conductrices vérifiées, sauf repli
  -- (aucune conductrice en ligne).
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

-- ---------------------------------------------------------------------------
-- accept_ride_offer v2 — anti double-engagement (lock transactionnel) +
-- token de partage + idempotence.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.accept_ride_offer(UUID);
CREATE OR REPLACE FUNCTION public.accept_ride_offer(p_offer_id UUID, p_operation_id TEXT DEFAULT NULL)
RETURNS TABLE(ok BOOLEAN, reason TEXT, ride_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer UUID; v_offer public.ride_offers%ROWTYPE; v_ride public.rides%ROWTYPE;
  v_ch_lock UUID;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN ok:=false; reason:='no_customer'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_offer FROM public.ride_offers WHERE id = p_offer_id;
  IF v_offer.id IS NULL THEN ok:=false; reason:='offer_not_found'; RETURN NEXT; RETURN; END IF;
  IF v_offer.status <> 'offered'
     OR (v_offer.expires_at IS NOT NULL AND v_offer.expires_at < now()) THEN
    ok:=false; reason:='offer_expired'; RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = v_offer.ride_id FOR UPDATE;
  IF v_ride.customer_id <> v_customer THEN ok:=false; reason:='not_your_ride'; RETURN NEXT; RETURN; END IF;
  IF v_ride.status <> 'searching' THEN
    -- Idempotence : même client, même chauffeur déjà attribué → succès.
    IF v_ride.status = 'accepted' AND v_ride.chauffeur_id = v_offer.chauffeur_id THEN
      ok:=true; reason:='already_accepted'; ride_id:=v_ride.id; RETURN NEXT; RETURN;
    END IF;
    ok:=false; reason:='ride_not_open'; RETURN NEXT; RETURN;
  END IF;

  -- ANTI DOUBLE-ENGAGEMENT : verrou sur le chauffeur — il ne peut être
  -- verrouillé que sur UNE course (la première acceptation gagne).
  SELECT c.id INTO v_ch_lock FROM public.chauffeurs c WHERE c.id = v_offer.chauffeur_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.rides r WHERE r.chauffeur_id = v_offer.chauffeur_id
             AND r.status IN ('accepted','arriving','arrived','in_progress')) THEN
    -- Déjà pris ailleurs : son offre ici expire.
    UPDATE public.ride_offers SET status='expired' WHERE id = p_offer_id;
    ok:=false; reason:='chauffeur_busy'; RETURN NEXT; RETURN;
  END IF;

  UPDATE public.rides
     SET chauffeur_id = v_offer.chauffeur_id, agreed_price_da = v_offer.price_da,
         status = 'accepted', accepted_at = now(),
         share_token = COALESCE(share_token, substr(md5(gen_random_uuid()::text), 1, 8))
   WHERE id = v_ride.id;

  UPDATE public.ride_offers SET status = 'accepted' WHERE id = p_offer_id;
  -- Les autres offres de CETTE course expirent…
  UPDATE public.ride_offers SET status = 'expired'
   WHERE ride_offers.ride_id = v_ride.id AND id <> p_offer_id AND status = 'offered';
  -- …et les AUTRES propositions de CE chauffeur (sur d'autres demandes) s'annulent.
  UPDATE public.ride_offers SET status = 'expired'
   WHERE chauffeur_id = v_offer.chauffeur_id AND ride_offers.ride_id <> v_ride.id AND status = 'offered';

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (v_ride.id, 'searching', 'accepted', 'Chauffeur choisi');
  ok:=true; reason:=NULL; ride_id:=v_ride.id; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.accept_ride_offer(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- chauffeurs_present_near v2 — + gamme/conductrice/premium/favori pour la
-- priorité de diffusion : boost > Premium > favoris du client > distance.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.chauffeurs_present_near(DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, INTEGER);
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
    AND p.updated_at > now() - make_interval(mins => GREATEST(1, p_within_min))
    AND ch.user_id IS NOT NULL
    AND COALESCE(ch.is_verified, false) = true
    AND COALESCE(ch.is_frozen, false) = false
    AND COALESCE(ch.is_blocked, false) = false
    -- Matching gammes (si la gamme de la demande est fournie)
    AND (p_gamme IS NULL OR (CASE ch.gamme
          WHEN 'confort' THEN p_gamme IN ('classic','confort')
          WHEN 'classic' THEN p_gamme = 'classic'
          ELSE p_gamme = 'moto' END))
    -- Femme au volant : conductrices seulement, repli si aucune en ligne
    AND (NOT COALESCE(p_female_only,false) OR ch.is_female_verified OR NOT v_female_online)
    AND p_lat IS NOT NULL AND p_lng IS NOT NULL
    AND (6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(p_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(p.lat))
        )))) <= GREATEST(0.5, LEAST(COALESCE(p_radius_km, 6), 30))
  -- Positionnel (4=premium, 5=favori, 3=distance) : un alias serait capturé
  -- par les variables OUT en plpgsql.
  ORDER BY 4 DESC, 5 DESC, 3 ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chauffeurs_present_near(DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, INTEGER, TEXT, BOOLEAN, UUID)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- chauffeur_nearby_rides v2 — gamme matching, boostées en premier, infos
-- client (note, ancienneté), badge Confort, conductrice, « je rentre chez moi ».
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.chauffeur_nearby_rides(DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC);
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
    -- Matching gammes
    AND (CASE v_ch.gamme
          WHEN 'confort' THEN r.gamme IN ('classic','confort')
          WHEN 'classic' THEN r.gamme = 'classic'
          ELSE r.gamme = 'moto' END)
    -- Femme au volant (repli si aucune conductrice en ligne)
    AND (NOT r.female_only OR v_ch.is_female_verified OR NOT v_female_online)
    AND (6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(p_lat)) * cos(radians(r.pickup_lat)) * cos(radians(r.pickup_lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(r.pickup_lat)))))) <= GREATEST(0.5, LEAST(COALESCE(p_radius_km, 8), 30))
  ORDER BY (r.boost_amount_da > 0) DESC, r.created_at DESC
  LIMIT 30;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chauffeur_nearby_rides(DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC) TO authenticated;

-- ---------------------------------------------------------------------------
-- my_ride_offers v2 — note/expérience/conductrice/premium/favori + ETA.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.my_ride_offers(UUID);
CREATE OR REPLACE FUNCTION public.my_ride_offers(p_ride_id UUID)
RETURNS TABLE(
  id UUID, price_da INTEGER, chauffeur_id UUID, chauffeur_name TEXT,
  vehicle TEXT, plate TEXT, rating NUMERIC, rides_count BIGINT,
  is_female BOOLEAN, is_premium BOOLEAN, is_favorite BOOLEAN,
  eta_km NUMERIC, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_customer UUID; v_ride public.rides%ROWTYPE;
BEGIN
  SELECT cu.id INTO v_customer FROM public.customers cu WHERE cu.user_id = auth.uid();
  SELECT * INTO v_ride FROM public.rides r WHERE r.id = p_ride_id;
  IF v_customer IS NULL OR v_ride.customer_id IS DISTINCT FROM v_customer THEN RETURN; END IF;

  RETURN QUERY
  SELECT o.id, o.price_da, c.id,
         COALESCE(NULLIF(c.first_name,''), split_part(c.full_name,' ',1)) AS chauffeur_name,
         NULLIF(btrim(COALESCE(c.vehicle_make,'') || ' ' || COALESCE(c.vehicle_model,'')
           || CASE WHEN COALESCE(c.vehicle_color,'') <> '' THEN ' · ' || c.vehicle_color ELSE '' END), '') AS vehicle,
         c.vehicle_plate AS plate,
         (SELECT round(avg(r2.chauffeur_rating)::NUMERIC, 1) FROM public.rides r2
           WHERE r2.chauffeur_id = c.id AND r2.chauffeur_rating IS NOT NULL) AS rating,
         (SELECT count(*) FROM public.rides r3
           WHERE r3.chauffeur_id = c.id AND r3.status = 'completed') AS rides_count,
         c.is_female_verified AS is_female,
         (rp.plan = 'premium') AS is_premium,
         EXISTS (SELECT 1 FROM public.customer_favorite_chauffeurs f
           WHERE f.customer_id = v_customer AND f.chauffeur_id = c.id) AS is_favorite,
         (SELECT (6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(v_ride.pickup_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(v_ride.pickup_lng))
            + sin(radians(v_ride.pickup_lat)) * sin(radians(p.lat))))))::NUMERIC
          FROM public.chauffeur_presence p WHERE p.chauffeur_id = c.id) AS eta_km,
         o.created_at
  FROM public.ride_offers o
  JOIN public.chauffeurs c ON c.id = o.chauffeur_id
  CROSS JOIN LATERAL public.resolve_drive_plan(c.id) rp
  WHERE o.ride_id = p_ride_id AND o.status = 'offered'
    AND (o.expires_at IS NULL OR o.expires_at > now())
  ORDER BY o.price_da ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.my_ride_offers(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- my_active_ride v2 — + gamme, boost, partage, proche, fiche chauffeur v3.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.my_active_ride();
CREATE OR REPLACE FUNCTION public.my_active_ride()
RETURNS TABLE(
  id UUID, status TEXT, pickup_text TEXT, dest_text TEXT,
  pickup_lat DOUBLE PRECISION, pickup_lng DOUBLE PRECISION,
  dest_lat DOUBLE PRECISION, dest_lng DOUBLE PRECISION,
  distance_km NUMERIC, proposed_price_da INTEGER, agreed_price_da INTEGER,
  boost_amount_da INTEGER, gamme TEXT, payment_method TEXT,
  female_only BOOLEAN, proxy_name TEXT, share_token TEXT,
  chauffeur_id UUID, ch_name TEXT, ch_vehicle TEXT, ch_plate TEXT, ch_phone TEXT,
  ch_rating NUMERIC, ch_rides BIGINT, ch_is_female BOOLEAN, ch_is_premium BOOLEAN,
  ch_is_favorite BOOLEAN, ch_lat DOUBLE PRECISION, ch_lng DOUBLE PRECISION,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_customer UUID;
BEGIN
  SELECT cu.id INTO v_customer FROM public.customers cu WHERE cu.user_id = auth.uid();
  IF v_customer IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT r.id, r.status::TEXT, r.pickup_text, r.dest_text,
         r.pickup_lat, r.pickup_lng, r.dest_lat, r.dest_lng,
         r.distance_km, r.proposed_price_da, r.agreed_price_da,
         r.boost_amount_da, r.gamme, r.payment_method,
         r.female_only, r.proxy_name, r.share_token,
         c.id,
         COALESCE(NULLIF(c.first_name,''), split_part(c.full_name,' ',1)),
         NULLIF(btrim(COALESCE(c.vehicle_make,'') || ' ' || COALESCE(c.vehicle_model,'')
           || CASE WHEN COALESCE(c.vehicle_color,'') <> '' THEN ' · ' || c.vehicle_color ELSE '' END), ''),
         c.vehicle_plate, c.phone,
         (SELECT round(avg(r2.chauffeur_rating)::NUMERIC, 1) FROM public.rides r2
           WHERE r2.chauffeur_id = c.id AND r2.chauffeur_rating IS NOT NULL),
         (SELECT count(*) FROM public.rides r3 WHERE r3.chauffeur_id = c.id AND r3.status = 'completed'),
         c.is_female_verified,
         (c.id IS NOT NULL AND (SELECT rp.plan FROM public.resolve_drive_plan(c.id) rp) = 'premium'),
         (c.id IS NOT NULL AND EXISTS (SELECT 1 FROM public.customer_favorite_chauffeurs f
            WHERE f.customer_id = v_customer AND f.chauffeur_id = c.id)),
         p.lat, p.lng,
         r.created_at
  FROM public.rides r
  LEFT JOIN public.chauffeurs c ON c.id = r.chauffeur_id
  LEFT JOIN public.chauffeur_presence p ON p.chauffeur_id = c.id
  WHERE r.customer_id = v_customer
    AND r.status IN ('searching','accepted','arriving','arrived','in_progress')
  ORDER BY r.created_at DESC
  LIMIT 1;
END;
$$;
GRANT EXECUTE ON FUNCTION public.my_active_ride() TO authenticated;

-- ---------------------------------------------------------------------------
-- Partage de trajet — lien public coligo.app/t/{token} (sans compte).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ride_by_share_token(p_token TEXT)
RETURNS TABLE(
  status TEXT, pickup_text TEXT, dest_text TEXT,
  dest_lat DOUBLE PRECISION, dest_lng DOUBLE PRECISION,
  ch_name TEXT, ch_vehicle TEXT, ch_plate TEXT, ch_rating NUMERIC,
  ch_lat DOUBLE PRECISION, ch_lng DOUBLE PRECISION,
  distance_km NUMERIC, started_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT r.status::TEXT, r.pickup_text, r.dest_text, r.dest_lat, r.dest_lng,
         COALESCE(NULLIF(c.first_name,''), split_part(c.full_name,' ',1)),
         NULLIF(btrim(COALESCE(c.vehicle_make,'') || ' ' || COALESCE(c.vehicle_model,'')
           || CASE WHEN COALESCE(c.vehicle_color,'') <> '' THEN ' · ' || c.vehicle_color ELSE '' END), ''),
         c.vehicle_plate,
         (SELECT round(avg(r2.chauffeur_rating)::NUMERIC, 1) FROM public.rides r2
           WHERE r2.chauffeur_id = c.id AND r2.chauffeur_rating IS NOT NULL),
         p.lat, p.lng, r.distance_km, r.started_at, p.updated_at
  FROM public.rides r
  LEFT JOIN public.chauffeurs c ON c.id = r.chauffeur_id
  LEFT JOIN public.chauffeur_presence p ON p.chauffeur_id = c.id
  WHERE r.share_token = p_token
    AND r.status IN ('accepted','arriving','arrived','in_progress','completed')
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.ride_by_share_token(TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Notation réciproque (5★) après complétion.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rate_ride(p_ride_id UUID, p_rating INTEGER)
RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_ride public.rides%ROWTYPE; v_cust UUID; v_ch UUID;
BEGIN
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN ok:=false; reason:='bad_rating'; RETURN NEXT; RETURN; END IF;
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL OR v_ride.status <> 'completed' THEN ok:=false; reason:='not_completed'; RETURN NEXT; RETURN; END IF;
  SELECT id INTO v_cust FROM public.customers WHERE user_id = auth.uid();
  SELECT id INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_cust IS NOT NULL AND v_ride.customer_id = v_cust THEN
    UPDATE public.rides SET chauffeur_rating = p_rating WHERE id = p_ride_id;  -- note reçue par le chauffeur
  ELSIF v_ch IS NOT NULL AND v_ride.chauffeur_id = v_ch THEN
    UPDATE public.rides SET client_rating = p_rating WHERE id = p_ride_id;     -- note reçue par le client
  ELSE ok:=false; reason:='forbidden'; RETURN NEXT; RETURN; END IF;
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.rate_ride(UUID, INTEGER) TO authenticated;

-- ---------------------------------------------------------------------------
-- Signalement (2 côtés) — examiné sous 24 h par les équipes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_ride(p_ride_id UUID, p_reason TEXT)
RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_ride public.rides%ROWTYPE; v_cust UUID; v_ch UUID; v_side TEXT;
BEGIN
  IF COALESCE(btrim(p_reason),'') = '' THEN ok:=false; reason:='bad_reason'; RETURN NEXT; RETURN; END IF;
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride.id IS NULL THEN ok:=false; reason:='ride_not_found'; RETURN NEXT; RETURN; END IF;
  SELECT id INTO v_cust FROM public.customers WHERE user_id = auth.uid();
  SELECT id INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_cust IS NOT NULL AND v_ride.customer_id = v_cust THEN v_side := 'customer';
  ELSIF v_ch IS NOT NULL AND v_ride.chauffeur_id = v_ch THEN v_side := 'chauffeur';
  ELSE ok:=false; reason:='forbidden'; RETURN NEXT; RETURN; END IF;
  INSERT INTO public.ride_reports (ride_id, reporter, reason)
  VALUES (p_ride_id, v_side, btrim(p_reason))
  ON CONFLICT (ride_id, reporter) DO UPDATE SET reason = EXCLUDED.reason, created_at = now(), status = 'open';
  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (p_ride_id, v_ride.status::text, v_ride.status::text, 'Signalement (' || v_side || ') : ' || btrim(p_reason));
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.report_ride(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- SOS — tracé en ride_events (position + détails joints automatiquement).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ride_sos(p_ride_id UUID, p_kind TEXT, p_lat DOUBLE PRECISION DEFAULT NULL, p_lng DOUBLE PRECISION DEFAULT NULL)
RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_ride public.rides%ROWTYPE; v_cust UUID; v_ch UUID; v_side TEXT;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride.id IS NULL THEN ok:=false; reason:='ride_not_found'; RETURN NEXT; RETURN; END IF;
  SELECT id INTO v_cust FROM public.customers WHERE user_id = auth.uid();
  SELECT id INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_cust IS NOT NULL AND v_ride.customer_id = v_cust THEN v_side := 'customer';
  ELSIF v_ch IS NOT NULL AND v_ride.chauffeur_id = v_ch THEN v_side := 'chauffeur';
  ELSE ok:=false; reason:='forbidden'; RETURN NEXT; RETURN; END IF;
  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (p_ride_id, v_ride.status::text, v_ride.status::text,
    'SOS (' || v_side || ') · ' || COALESCE(NULLIF(btrim(p_kind),''),'alerte')
    || CASE WHEN p_lat IS NOT NULL THEN ' · ' || round(p_lat::NUMERIC,5) || ',' || round(p_lng::NUMERIC,5) ELSE '' END);
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ride_sos(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

-- ---------------------------------------------------------------------------
-- « Je rentre chez moi » — adresse + activation limitée (2/jour, config).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chauffeur_set_home(p_addr TEXT, p_lat DOUBLE PRECISION DEFAULT NULL, p_lng DOUBLE PRECISION DEFAULT NULL)
RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_ch UUID;
BEGIN
  SELECT id INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_ch IS NULL THEN ok:=false; reason:='not_a_chauffeur'; RETURN NEXT; RETURN; END IF;
  UPDATE public.chauffeurs
     SET home_addr_text = NULLIF(btrim(COALESCE(p_addr,'')),''), home_lat = p_lat, home_lng = p_lng
   WHERE id = v_ch;
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chauffeur_set_home(TEXT, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

CREATE OR REPLACE FUNCTION public.chauffeur_home_dir_activate()
RETURNS TABLE(ok BOOLEAN, reason TEXT, remaining INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE s public.platform_settings%ROWTYPE; v_ch public.chauffeurs%ROWTYPE; v_today DATE; v_count INTEGER;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT * INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid() FOR UPDATE;
  IF v_ch.id IS NULL THEN ok:=false; reason:='not_a_chauffeur'; remaining:=0; RETURN NEXT; RETURN; END IF;
  IF v_ch.home_addr_text IS NULL THEN ok:=false; reason:='no_home_addr'; remaining:=0; RETURN NEXT; RETURN; END IF;
  v_today := (now() AT TIME ZONE 'Africa/Algiers')::DATE;
  v_count := CASE WHEN v_ch.home_dir_date = v_today THEN v_ch.home_dir_count ELSE 0 END;
  IF v_count >= s.drive_home_dir_max_per_day THEN
    ok:=false; reason:='daily_limit'; remaining:=0; RETURN NEXT; RETURN;
  END IF;
  UPDATE public.chauffeurs SET home_dir_date = v_today, home_dir_count = v_count + 1 WHERE id = v_ch.id;
  ok:=true; reason:=NULL; remaining := s.drive_home_dir_max_per_day - v_count - 1; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chauffeur_home_dir_activate() TO authenticated;

-- ---------------------------------------------------------------------------
-- Back-to-back — course suivante proche du POINT DE DÉPOSE (file de 1 max).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_b2b_next(p_ride_id UUID)
RETURNS TABLE(
  id UUID, pickup_text TEXT, dest_text TEXT, distance_km NUMERIC,
  proposed_price_da INTEGER, boost_amount_da INTEGER, gamme TEXT,
  pickup_dist_km NUMERIC, customer_name TEXT, customer_rating NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE s public.platform_settings%ROWTYPE; v_ch public.chauffeurs%ROWTYPE; v_ride public.rides%ROWTYPE; v_female_online BOOLEAN;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT c.* INTO v_ch FROM public.chauffeurs c
   WHERE c.user_id = auth.uid() AND c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked;
  IF v_ch.id IS NULL THEN RETURN; END IF;
  SELECT * INTO v_ride FROM public.rides r WHERE r.id = p_ride_id AND r.chauffeur_id = v_ch.id AND r.status = 'in_progress';
  IF v_ride.id IS NULL OR v_ride.dest_lat IS NULL THEN RETURN; END IF;
  v_female_online := public.drive_female_online();

  RETURN QUERY
  SELECT r.id, r.pickup_text, r.dest_text, r.distance_km, r.proposed_price_da,
         r.boost_amount_da, r.gamme,
         (6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(v_ride.dest_lat)) * cos(radians(r.pickup_lat)) * cos(radians(r.pickup_lng) - radians(v_ride.dest_lng))
            + sin(radians(v_ride.dest_lat)) * sin(radians(r.pickup_lat))))))::NUMERIC,
         COALESCE(NULLIF(split_part(cu.full_name, ' ', 1), ''), 'Client'),
         (SELECT round(avg(r2.client_rating)::NUMERIC, 1) FROM public.rides r2
           WHERE r2.customer_id = r.customer_id AND r2.client_rating IS NOT NULL)
  FROM public.rides r
  JOIN public.customers cu ON cu.id = r.customer_id
  WHERE r.status = 'searching'
    AND (r.expires_at IS NULL OR r.expires_at > now())
    AND r.customer_id <> v_ride.customer_id
    AND (CASE v_ch.gamme
          WHEN 'confort' THEN r.gamme IN ('classic','confort')
          WHEN 'classic' THEN r.gamme = 'classic'
          ELSE r.gamme = 'moto' END)
    AND (NOT r.female_only OR v_ch.is_female_verified OR NOT v_female_online)
    AND (6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(v_ride.dest_lat)) * cos(radians(r.pickup_lat)) * cos(radians(r.pickup_lng) - radians(v_ride.dest_lng))
          + sin(radians(v_ride.dest_lat)) * sin(radians(r.pickup_lat)))))) <= s.drive_b2b_radius_km
  ORDER BY (r.boost_amount_da > 0) DESC, 8 ASC
  LIMIT 1;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_b2b_next(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Repli « Femme au volant » : clientes à prévenir quand une conductrice se
-- connecte (appelé par l'action heartbeat ; marque pour ne notifier qu'une fois).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_female_waiting_customers()
RETURNS TABLE(ride_id UUID, customer_user_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.rides r
     SET female_notified_at = now()
    FROM public.customers cu
   WHERE cu.id = r.customer_id
     AND r.status = 'searching' AND r.female_only
     AND (r.expires_at IS NULL OR r.expires_at > now())
     AND r.female_notified_at IS NULL
  RETURNING r.id, cu.user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_female_waiting_customers() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Nettoyage TTL — demandes expirées annulées, propositions expirées retirées.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_expire_stale()
RETURNS TABLE(expired_rides INTEGER, expired_offers INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_r INTEGER; v_o INTEGER;
BEGIN
  WITH upd AS (
    UPDATE public.rides SET status='cancelled', cancelled_at=now(), cancelled_by='system'
    WHERE status='searching' AND expires_at IS NOT NULL AND expires_at < now()
    RETURNING id
  )
  SELECT count(*) INTO v_r FROM upd;
  UPDATE public.ride_offers o SET status='expired'
   WHERE o.status='offered' AND (
     (o.expires_at IS NOT NULL AND o.expires_at < now())
     OR EXISTS (SELECT 1 FROM public.rides r WHERE r.id=o.ride_id AND r.status NOT IN ('searching')
                AND NOT (r.status='accepted' AND r.chauffeur_id=o.chauffeur_id)));
  GET DIAGNOSTICS v_o = ROW_COUNT;
  expired_rides := v_r; expired_offers := v_o; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_expire_stale() TO service_role;
