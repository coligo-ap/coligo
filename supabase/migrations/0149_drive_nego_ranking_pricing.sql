-- ============================================================
-- 0149 — Coligo Drive : négociation temps réel style Indrive,
-- classement intelligent des chauffeurs, tarification dynamique.
-- • Realtime sur rides + ride_offers (propositions instantanées)
-- • Favoris : ajout possible UNIQUEMENT après une course terminée
--   avec ce chauffeur (RLS) — plus d'ajout depuis l'écran d'offres
-- • chauffeur_decline_ride : refus explicite (la demande disparaît
--   pour lui, son éventuelle offre est retirée chez le client)
-- • Contre-offre chauffeur libre (au-dessus OU en dessous du prix
--   client) mais jamais sous le plancher silencieux
-- • drive_chauffeur_stats + drive_rank_score : volume, note,
--   satisfaction, taux d'acceptation (offres retenues), annulation,
--   ponctualité, signalements, ancienneté, proximité/ETA,
--   coefficient Premium/Pro (surclassement sans écraser)
-- • drive_smart_quote : mini / recommandé / rapide — base + distance
--   + temps + heure de pointe + week-end + demande/offre locale +
--   météo/événement (coefs admin) + apprentissage des prix réellement
--   acceptés, puis remise de lancement 5–12 % (stratégie 70 % client)
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. Realtime : offres et courses (négociation instantanée des 2 côtés).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_offers;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Favoris : un chauffeur ne peut devenir favori qu'après une course
--    TERMINÉE avec ce client (l'écran des offres n'affiche plus le cœur).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS customer_favorite_chauffeurs_self ON public.customer_favorite_chauffeurs;
DROP POLICY IF EXISTS customer_favorite_chauffeurs_select ON public.customer_favorite_chauffeurs;
DROP POLICY IF EXISTS customer_favorite_chauffeurs_insert ON public.customer_favorite_chauffeurs;
DROP POLICY IF EXISTS customer_favorite_chauffeurs_update ON public.customer_favorite_chauffeurs;
DROP POLICY IF EXISTS customer_favorite_chauffeurs_delete ON public.customer_favorite_chauffeurs;
CREATE POLICY customer_favorite_chauffeurs_select ON public.customer_favorite_chauffeurs
  FOR SELECT USING (
    customer_id IN (SELECT cu.id FROM public.customers cu WHERE cu.user_id = auth.uid())
  );
CREATE POLICY customer_favorite_chauffeurs_delete ON public.customer_favorite_chauffeurs
  FOR DELETE USING (
    customer_id IN (SELECT cu.id FROM public.customers cu WHERE cu.user_id = auth.uid())
  );
CREATE POLICY customer_favorite_chauffeurs_insert ON public.customer_favorite_chauffeurs
  FOR INSERT WITH CHECK (
    customer_id IN (SELECT cu.id FROM public.customers cu WHERE cu.user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.customer_id = customer_favorite_chauffeurs.customer_id
        AND r.chauffeur_id = customer_favorite_chauffeurs.chauffeur_id
        AND r.status = 'completed'
    )
  );
-- (upsert : la branche UPDATE de ON CONFLICT reste possible sur sa propre ligne)
CREATE POLICY customer_favorite_chauffeurs_update ON public.customer_favorite_chauffeurs
  FOR UPDATE USING (
    customer_id IN (SELECT cu.id FROM public.customers cu WHERE cu.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 3. Réglages tarification dynamique (modifiables par le super-admin).
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS drive_launch_discount_rate NUMERIC NOT NULL DEFAULT 0.08, -- remise lancement (clampée 5–12 %)
  ADD COLUMN IF NOT EXISTS drive_rush_coef           NUMERIC NOT NULL DEFAULT 0.10, -- heures de pointe 7-9h / 16-19h
  ADD COLUMN IF NOT EXISTS drive_weekend_coef        NUMERIC NOT NULL DEFAULT 0.04, -- vendredi/samedi (DZ)
  ADD COLUMN IF NOT EXISTS drive_weather_coef        NUMERIC NOT NULL DEFAULT 0.00, -- météo (pluie…) — coef manuel admin
  ADD COLUMN IF NOT EXISTS drive_event_coef          NUMERIC NOT NULL DEFAULT 0.00, -- événement local — coef manuel admin
  ADD COLUMN IF NOT EXISTS drive_surge_max           NUMERIC NOT NULL DEFAULT 0.25, -- plafond ajustement demande/offre
  ADD COLUMN IF NOT EXISTS drive_mini_rate           NUMERIC NOT NULL DEFAULT 0.12, -- mini = reco × (1 − taux)
  ADD COLUMN IF NOT EXISTS drive_fast_rate           NUMERIC NOT NULL DEFAULT 0.15, -- rapide = reco × (1 + taux)
  ADD COLUMN IF NOT EXISTS drive_avg_speed_kmh       NUMERIC NOT NULL DEFAULT 26;   -- vitesse urbaine moyenne (coût temps)

-- ---------------------------------------------------------------------------
-- 4. Apprentissage : coefficient appris des prix réellement conclus.
--    Ratio moyen (prix convenu / prix suggéré au moment de la demande) sur
--    45 jours, par gamme et bande horaire — le marché corrige le barème.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_learning_coef(
  p_gamme TEXT DEFAULT 'classic', p_at TIMESTAMPTZ DEFAULT now()
) RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_h INTEGER; v_band INT4RANGE; v_ratio NUMERIC; v_n BIGINT;
BEGIN
  v_h := EXTRACT(HOUR FROM (p_at AT TIME ZONE 'Africa/Algiers'))::INTEGER;
  v_band := CASE
    WHEN v_h BETWEEN 7 AND 9   THEN int4range(7, 10)
    WHEN v_h BETWEEN 10 AND 15 THEN int4range(10, 16)
    WHEN v_h BETWEEN 16 AND 19 THEN int4range(16, 20)
    WHEN v_h BETWEEN 20 AND 23 THEN int4range(20, 24)
    ELSE int4range(0, 7)
  END;
  SELECT avg(r.agreed_price_da::NUMERIC / NULLIF(r.suggested_price_da, 0)), count(*)
    INTO v_ratio, v_n
  FROM public.rides r
  WHERE r.status = 'completed'
    AND r.gamme = COALESCE(NULLIF(p_gamme, ''), 'classic')
    AND r.agreed_price_da IS NOT NULL AND r.suggested_price_da IS NOT NULL
    AND r.completed_at > now() - INTERVAL '45 days'
    AND v_band @> EXTRACT(HOUR FROM (r.created_at AT TIME ZONE 'Africa/Algiers'))::INTEGER;
  IF v_n IS NULL OR v_n < 8 OR v_ratio IS NULL THEN RETURN 1; END IF;
  RETURN LEAST(1.12, GREATEST(0.92, round(v_ratio, 3)));
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_learning_coef(TEXT, TIMESTAMPTZ) TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- 5. Devis intelligent — mini / recommandé / rapide.
--    raw = (reco barème incl. nuit + coût temps) × (1+pointe) × (1+week-end)
--          × (1+demande/offre locale) × (1+météo+événement) × apprentissage
--    reco = raw × (1 − remise lancement 5–12 %) — stratégie volume client.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_smart_quote(
  p_distance_km NUMERIC,
  p_gamme       TEXT DEFAULT 'classic',
  p_pickup_lat  DOUBLE PRECISION DEFAULT NULL,
  p_pickup_lng  DOUBLE PRECISION DEFAULT NULL,
  p_at          TIMESTAMPTZ DEFAULT now()
) RETURNS TABLE(
  floor_da INTEGER, mini_da INTEGER, reco_da INTEGER, fast_da INTEGER,
  demand_n INTEGER, supply_n INTEGER, surge NUMERIC, learn NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE;
  g JSONB; v_base INTEGER; v_floor INTEGER;
  v_per_min NUMERIC; v_minutes NUMERIC; v_time_cost NUMERIC;
  v_h INTEGER; v_dow INTEGER; v_rush NUMERIC := 0; v_wk NUMERIC := 0;
  v_demand INTEGER := 0; v_supply INTEGER := 0; v_surge NUMERIC := 0;
  v_learn NUMERIC; v_discount NUMERIC; v_raw NUMERIC; v_reco INTEGER;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  g := s.drive_pricing -> COALESCE(NULLIF(p_gamme, ''), 'classic');
  IF g IS NULL THEN g := s.drive_pricing -> 'classic'; END IF;

  -- Barème (inclut majoration nuit silencieuse) + plancher.
  v_base  := public.drive_recommended_price(p_distance_km, p_gamme, p_at);
  v_floor := public.drive_price_floor(p_distance_km, p_gamme);

  -- Coût temps estimé (DA/min configurable par gamme, 0 par défaut).
  v_per_min := COALESCE((g->>'per_min')::NUMERIC, 0);
  v_minutes := GREATEST(0, COALESCE(p_distance_km, 0)) / GREATEST(10, s.drive_avg_speed_kmh) * 60;
  v_time_cost := v_per_min * v_minutes;

  -- Heure de pointe (jours ouvrés DZ : dimanche→jeudi) + week-end (ven/sam).
  v_h   := EXTRACT(HOUR   FROM (p_at AT TIME ZONE 'Africa/Algiers'))::INTEGER;
  v_dow := EXTRACT(ISODOW FROM (p_at AT TIME ZONE 'Africa/Algiers'))::INTEGER; -- lun=1…dim=7
  IF v_dow IN (5, 6) THEN
    v_wk := s.drive_weekend_coef;
  ELSIF (v_h BETWEEN 7 AND 9) OR (v_h BETWEEN 16 AND 19) THEN
    v_rush := s.drive_rush_coef;
  END IF;

  -- Demande / offre locales (4 km autour du départ) : la circulation et les
  -- zones tendues se traduisent en demandes en recherche vs chauffeurs en ligne.
  IF p_pickup_lat IS NOT NULL AND p_pickup_lng IS NOT NULL THEN
    SELECT count(*)::INTEGER INTO v_demand
    FROM public.rides r
    WHERE r.status = 'searching'
      AND r.created_at > now() - INTERVAL '15 minutes'
      AND r.pickup_lat IS NOT NULL
      AND (6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(p_pickup_lat)) * cos(radians(r.pickup_lat)) * cos(radians(r.pickup_lng) - radians(p_pickup_lng))
            + sin(radians(p_pickup_lat)) * sin(radians(r.pickup_lat)))))) <= 4;
    SELECT count(*)::INTEGER INTO v_supply
    FROM public.chauffeur_presence p
    JOIN public.chauffeurs c ON c.id = p.chauffeur_id
    WHERE p.is_online AND p.updated_at > now() - INTERVAL '3 minutes'
      AND c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked
      AND (CASE c.gamme
            WHEN 'confort' THEN COALESCE(NULLIF(p_gamme,''),'classic') IN ('classic','confort')
            WHEN 'classic' THEN COALESCE(NULLIF(p_gamme,''),'classic') = 'classic'
            ELSE COALESCE(NULLIF(p_gamme,''),'classic') = 'moto' END)
      AND (6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(p_pickup_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(p_pickup_lng))
            + sin(radians(p_pickup_lat)) * sin(radians(p.lat)))))) <= 4;
    -- Tension = (demande − offre) / offre, amortie, bornée [−5 %, plafond].
    v_surge := LEAST(s.drive_surge_max, GREATEST(-0.05,
      (v_demand - v_supply)::NUMERIC / GREATEST(1, v_supply) * 0.10));
  END IF;

  v_learn := public.drive_learning_coef(p_gamme, p_at);
  v_discount := LEAST(0.12, GREATEST(0.05, s.drive_launch_discount_rate));

  v_raw := (v_base + v_time_cost)
           * (1 + v_rush) * (1 + v_wk) * (1 + v_surge)
           * (1 + LEAST(0.20, GREATEST(0, s.drive_weather_coef) + GREATEST(0, s.drive_event_coef)))
           * v_learn;
  v_reco := GREATEST(v_floor, (round(v_raw * (1 - v_discount) / 5) * 5))::INTEGER;

  floor_da := v_floor;
  reco_da  := v_reco;
  mini_da  := GREATEST(v_floor, (round(v_reco * (1 - s.drive_mini_rate) / 5) * 5))::INTEGER;
  fast_da  := (round(v_reco * (1 + s.drive_fast_rate) / 5) * 5)::INTEGER;
  demand_n := v_demand; supply_n := v_supply; surge := v_surge; learn := v_learn;
  RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_smart_quote(NUMERIC, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ) TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- 6. request_ride v3 — le prix suggéré stocké devient le prix INTELLIGENT
--    (même signature ; le plancher silencieux reste inchangé).
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
  v_boost INTEGER; v_ride UUID; v_existing UUID;
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

  -- Prix suggéré INTELLIGENT (sert aussi de référence à l'apprentissage).
  SELECT q.reco_da INTO v_suggest
    FROM public.drive_smart_quote(p_distance_km, p_gamme, p_pickup_lat, p_pickup_lng) q;
  v_floor := public.drive_price_floor(p_distance_km, p_gamme);
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

-- ---------------------------------------------------------------------------
-- 7. chauffeur_offer_ride v3 — contre-offre libre (au-dessus OU en dessous du
--    prix client) mais jamais sous le plancher silencieux de la course.
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
     OR (v_ride.expires_at IS NOT NULL AND v_ride.expires_at < now()) THEN
    ok:=false; reason:='ride_not_open'; RETURN NEXT; RETURN;
  END IF;

  -- Plancher silencieux : une contre-offre peut descendre SOUS le prix
  -- client, jamais sous le plancher (anti-bradage des 2 côtés).
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

-- ---------------------------------------------------------------------------
-- 8. chauffeur_decline_ride — refus explicite : la demande disparaît pour ce
--    chauffeur et son éventuelle offre est retirée de l'écran du client.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chauffeur_decline_ride(p_ride_id UUID)
RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_ch UUID; v_ride public.rides%ROWTYPE;
BEGIN
  SELECT id INTO v_ch FROM public.chauffeurs
   WHERE user_id = auth.uid() AND is_verified AND NOT is_frozen AND NOT is_blocked;
  IF v_ch IS NULL THEN ok:=false; reason:='not_a_verified_chauffeur'; RETURN NEXT; RETURN; END IF;
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride.id IS NULL THEN ok:=false; reason:='ride_not_found'; RETURN NEXT; RETURN; END IF;
  INSERT INTO public.ride_offers (ride_id, chauffeur_id, price_da, status)
  VALUES (p_ride_id, v_ch, GREATEST(1, COALESCE(v_ride.proposed_price_da, 1)), 'declined')
  ON CONFLICT (ride_id, chauffeur_id) DO UPDATE SET status = 'declined';
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chauffeur_decline_ride(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. chauffeur_nearby_rides v3 — les demandes refusées disparaissent.
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
-- 10. Statistiques chauffeur (fenêtre 90 j pour les taux, global pour le
--     volume/la note) — alimentent le score de classement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_chauffeur_stats(p_chauffeur_id UUID)
RETURNS TABLE(
  rides_done BIGINT,        -- courses terminées (tout temps)
  rating NUMERIC,           -- note moyenne ★
  satisfaction NUMERIC,     -- part de notes ≥ 4 (taux de satisfaction)
  win_rate NUMERIC,         -- offres retenues par les clients / offres émises
  cancel_rate NUMERIC,      -- annulations chauffeur / courses engagées
  punctuality NUMERIC,      -- part de prises en charge ≤ 15 min après accord
  clean_rate NUMERIC,       -- part de courses sans signalement client
  seniority_days INTEGER    -- ancienneté sur la plateforme
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_since TIMESTAMPTZ := now() - INTERVAL '90 days';
  v_offers BIGINT; v_won BIGINT; v_done90 BIGINT; v_cancel90 BIGINT;
  v_punct_n BIGINT; v_punct_ok BIGINT; v_reports BIGINT;
BEGIN
  -- avg ignore les NULL : les courses non notées ne comptent pas.
  SELECT count(*) FILTER (WHERE r.status = 'completed'),
         round(avg(r.chauffeur_rating)::NUMERIC, 2),
         round(avg((r.chauffeur_rating >= 4)::INT)::NUMERIC, 3)
    INTO rides_done, rating, satisfaction
  FROM public.rides r WHERE r.chauffeur_id = p_chauffeur_id;

  SELECT count(*), count(*) FILTER (WHERE o.status = 'accepted')
    INTO v_offers, v_won
  FROM public.ride_offers o
  WHERE o.chauffeur_id = p_chauffeur_id AND o.status <> 'declined' AND o.created_at > v_since;
  win_rate := CASE WHEN COALESCE(v_offers,0) >= 5 THEN round(v_won::NUMERIC / v_offers, 3) ELSE NULL END;

  SELECT count(*) FILTER (WHERE r.status = 'completed'),
         count(*) FILTER (WHERE r.status = 'cancelled' AND r.cancelled_by = 'chauffeur')
    INTO v_done90, v_cancel90
  FROM public.rides r
  WHERE r.chauffeur_id = p_chauffeur_id AND r.created_at > v_since;
  cancel_rate := CASE WHEN v_done90 + v_cancel90 >= 3
                      THEN round(v_cancel90::NUMERIC / (v_done90 + v_cancel90), 3) ELSE NULL END;

  -- Ponctualité : accord → « arrivé » en ≤ 15 min (ride_events).
  SELECT count(*),
         count(*) FILTER (WHERE arr.t - acc.t <= INTERVAL '15 minutes')
    INTO v_punct_n, v_punct_ok
  FROM (SELECT e.ride_id, min(e.created_at) AS t FROM public.ride_events e
        JOIN public.rides r ON r.id = e.ride_id AND r.chauffeur_id = p_chauffeur_id
        WHERE e.to_status = 'accepted' AND e.created_at > v_since GROUP BY e.ride_id) acc
  JOIN (SELECT e.ride_id, min(e.created_at) AS t FROM public.ride_events e
        WHERE e.to_status = 'arrived' GROUP BY e.ride_id) arr USING (ride_id);
  punctuality := CASE WHEN COALESCE(v_punct_n,0) >= 3
                      THEN round(v_punct_ok::NUMERIC / v_punct_n, 3) ELSE NULL END;

  SELECT count(DISTINCT rep.ride_id) INTO v_reports
  FROM public.ride_reports rep
  JOIN public.rides r ON r.id = rep.ride_id
  WHERE r.chauffeur_id = p_chauffeur_id AND rep.reporter = 'customer' AND rep.created_at > v_since;
  clean_rate := CASE WHEN COALESCE(v_done90,0) >= 3
                     THEN round(1 - LEAST(1, v_reports::NUMERIC / v_done90), 3) ELSE NULL END;

  SELECT GREATEST(0, EXTRACT(DAY FROM now() - c.created_at))::INTEGER
    INTO seniority_days
  FROM public.chauffeurs c WHERE c.id = p_chauffeur_id;
  RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_chauffeur_stats(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11. Score de classement 0–~115 (pondération adaptée au marché DZ).
--     Les valeurs neutres (COALESCE) évitent d'enterrer les nouveaux
--     chauffeurs ; Premium ×1,15 / Pro ×1,06 = surclassement SANS écraser
--     un chauffeur mieux noté ou nettement plus proche.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_rank_score(
  p_chauffeur_id UUID, p_eta_km NUMERIC DEFAULT NULL
) RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  st RECORD; v_plan TEXT; v_online BOOLEAN; v_score NUMERIC;
BEGIN
  SELECT * INTO st FROM public.drive_chauffeur_stats(p_chauffeur_id);
  SELECT rp.plan INTO v_plan FROM public.resolve_drive_plan(p_chauffeur_id) rp;
  SELECT (p.is_online AND p.updated_at > now() - INTERVAL '2 minutes') INTO v_online
    FROM public.chauffeur_presence p WHERE p.chauffeur_id = p_chauffeur_id;

  v_score :=
      0.22 * LEAST(1, GREATEST(0, (COALESCE(st.rating, 4.2) - 3) / 2))        -- note moyenne
    + 0.12 * COALESCE(st.satisfaction, 0.75)                                  -- taux de satisfaction
    + 0.08 * COALESCE(st.win_rate, 0.50)                                      -- taux d'acceptation (offres retenues)
    + 0.10 * (1 - COALESCE(st.cancel_rate, 0.05))                             -- fiabilité (annulations)
    + 0.10 * COALESCE(st.punctuality, 0.75)                                   -- ponctualité
    + 0.06 * COALESCE(st.clean_rate, 1)                                       -- qualité (sans signalement)
    + 0.08 * LEAST(1, ln(1 + COALESCE(st.rides_done, 0)) / ln(301))           -- expérience (log, sature à ~300)
    + 0.05 * LEAST(1, COALESCE(st.seniority_days, 0) / 365.0)                 -- ancienneté
    + 0.14 * CASE WHEN p_eta_km IS NULL THEN 0.5
                  ELSE GREATEST(0, 1 - LEAST(p_eta_km, 8) / 8) END            -- proximité / ETA
    + 0.05 * CASE WHEN COALESCE(v_online, false) THEN 1 ELSE 0.4 END;         -- disponibilité temps réel

  v_score := v_score * CASE COALESCE(v_plan, 'free')
    WHEN 'premium' THEN 1.15 WHEN 'pro' THEN 1.06 ELSE 1.0 END;
  RETURN round(v_score * 100, 1);
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_rank_score(UUID, NUMERIC) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12. my_ride_offers v3 — + rank_score (tri « Recommandés » côté client).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.my_ride_offers(UUID);
CREATE OR REPLACE FUNCTION public.my_ride_offers(p_ride_id UUID)
RETURNS TABLE(
  id UUID, price_da INTEGER, chauffeur_id UUID, chauffeur_name TEXT,
  vehicle TEXT, plate TEXT, rating NUMERIC, rides_count BIGINT,
  is_female BOOLEAN, is_premium BOOLEAN, is_favorite BOOLEAN,
  eta_km NUMERIC, rank_score NUMERIC, created_at TIMESTAMPTZ
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
         dist.km AS eta_km,
         public.drive_rank_score(c.id, dist.km) AS rank_score,
         o.created_at
  FROM public.ride_offers o
  JOIN public.chauffeurs c ON c.id = o.chauffeur_id
  CROSS JOIN LATERAL public.resolve_drive_plan(c.id) rp
  CROSS JOIN LATERAL (
    SELECT (SELECT (6371 * acos(LEAST(1, GREATEST(-1,
        cos(radians(v_ride.pickup_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(v_ride.pickup_lng))
        + sin(radians(v_ride.pickup_lat)) * sin(radians(p.lat))))))::NUMERIC
      FROM public.chauffeur_presence p WHERE p.chauffeur_id = c.id) AS km
  ) dist
  WHERE o.ride_id = p_ride_id AND o.status = 'offered'
    AND (o.expires_at IS NULL OR o.expires_at > now())
  -- Positionnel (13=rank_score, 2=prix) : un alias serait capturé par les
  -- variables OUT en plpgsql.
  ORDER BY 13 DESC, 2 ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.my_ride_offers(UUID) TO authenticated;
