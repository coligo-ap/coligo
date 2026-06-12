-- ============================================================
-- 0163 — Drive : Coligo Pay PARTIEL + échec paiement carte
--
-- A. COLIGO PAY PARTIEL (solde insuffisant ≠ blocage) :
--    • request_ride : on réserve LEAST(solde, total) en séquestre ; le
--      complément (cash_due_da) sera réglé EN ESPÈCES au chauffeur.
--    • accept_ride_offer / ride_boost : la réservation suit le nouveau
--      total, plafonnée par le solde — jamais d'échec « insuffisant ».
--    • complete_ride : règlement MIXTE réconcilié (SUM = 0) :
--        F = prix, E = séquestre (≤ F), C = F − E (espèces), c = commission
--        - chauffeur_payout            = F − c   (gain net, informatif)
--        - chauffeur_cash_collected    = C       (si C > 0)
--        - vtc_commission_income       = min(c, E)  (couverte par le séquestre)
--        - chauffeur_owes_platform     = c − E   (si c > E : à reverser)
--        - adjustment                  = E − c   (si C > 0 ET E > c : part en
--          ligne due au chauffeur — la plateforme détient E, garde c)
--      Cas purs inchangés : cash (E=0) et en ligne complet (C=0) produisent
--      EXACTEMENT les mêmes écritures qu'avant (tests préservés).
--
-- B. CARTE ÉCHOUÉE (Chargily checkout.failed / canceled) :
--    • rides.card_failed_at + RPC drive_card_failed (service_role) : la
--      demande encore « searching » non payée est ANNULÉE automatiquement
--      (aucun débit, séquestre = 0) — le client est ramené à l'écran de
--      choix de gamme avec un message inline, sans annulation manuelle.
-- ============================================================

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS cash_due_da    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS card_failed_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- request_ride v7 — Coligo Pay : réservation PARTIELLE (plafonnée au solde).
-- Solde vide (≤ 0) refusé : autant choisir « Espèces ».
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_ride(
  p_pickup_lat      DOUBLE PRECISION,
  p_pickup_lng      DOUBLE PRECISION,
  p_pickup_text     TEXT,
  p_dest_lat        DOUBLE PRECISION,
  p_dest_lng        DOUBLE PRECISION,
  p_dest_text       TEXT,
  p_distance_km     NUMERIC,
  p_proposed_price  INTEGER,
  p_payment_method  TEXT DEFAULT 'cash',
  p_gamme           TEXT DEFAULT 'classic',
  p_boost_da        INTEGER DEFAULT 0,
  p_female_only     BOOLEAN DEFAULT false,
  p_proxy_name      TEXT DEFAULT NULL,
  p_proxy_phone     TEXT DEFAULT NULL,
  p_operation_id    TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE;
  v_customer UUID; v_female_ok BOOLEAN; v_suggest INTEGER; v_floor INTEGER;
  v_boost INTEGER; v_ride UUID; v_existing UUID; v_total INTEGER; v_bal INTEGER;
  v_price INTEGER; v_escrow INTEGER; v_cash INTEGER;
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
  v_floor := public.drive_price_floor(p_distance_km, p_gamme);
  v_boost := GREATEST(0, COALESCE(p_boost_da, 0));
  IF v_boost > 0 THEN
    v_boost := GREATEST(s.drive_boost_min_da, round(v_boost::NUMERIC / s.drive_boost_step_da) * s.drive_boost_step_da)::INTEGER;
  END IF;
  v_price := GREATEST(v_floor, COALESCE(NULLIF(p_proposed_price, 0), v_suggest));
  v_total := v_price + v_boost;

  -- COLIGO PAY : réservation PARTIELLE — on bloque LEAST(solde, total),
  -- le complément sera réglé en espèces au chauffeur (cash_due_da).
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
$$;

-- ---------------------------------------------------------------------------
-- accept_ride_offer v5 — la réservation Coligo Pay suit le prix convenu,
-- PLAFONNÉE par le solde (jamais d'échec « insuffisant » : le reste = espèces).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_ride_offer(p_offer_id UUID, p_operation_id TEXT DEFAULT NULL)
RETURNS TABLE(ok BOOLEAN, reason TEXT, ride_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer UUID; v_offer public.ride_offers%ROWTYPE; v_ride public.rides%ROWTYPE;
  v_ch_lock UUID; v_delta INTEGER; v_bal INTEGER; v_target INTEGER; v_cash INTEGER;
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
    IF v_ride.status = 'accepted' AND v_ride.chauffeur_id = v_offer.chauffeur_id THEN
      ok:=true; reason:='already_accepted'; ride_id:=v_ride.id; RETURN NEXT; RETURN;
    END IF;
    ok:=false; reason:='ride_not_open'; RETURN NEXT; RETURN;
  END IF;

  SELECT c.id INTO v_ch_lock FROM public.chauffeurs c WHERE c.id = v_offer.chauffeur_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.rides r WHERE r.chauffeur_id = v_offer.chauffeur_id
             AND r.status IN ('accepted','arriving','arrived','in_progress')) THEN
    UPDATE public.ride_offers SET status='expired' WHERE id = p_offer_id;
    ok:=false; reason:='chauffeur_busy'; RETURN NEXT; RETURN;
  END IF;

  -- COLIGO PAY : réservation ajustée au prix convenu, dans la limite du solde
  -- (séquestre cible = LEAST(prix, séquestre + solde) ; complément = espèces).
  v_target := v_ride.escrow_da; v_cash := v_ride.cash_due_da;
  IF v_ride.payment_method = 'coligo_pay' THEN
    SELECT public.customer_topup_balance(v_customer) INTO v_bal;
    v_target := LEAST(v_offer.price_da, v_ride.escrow_da + GREATEST(COALESCE(v_bal, 0), 0));
    v_cash   := v_offer.price_da - v_target;
    v_delta  := v_target - v_ride.escrow_da;
    IF v_delta > 0 THEN
      INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
      VALUES (v_customer, NULL, 'topup_spent', 'topup', -v_delta,
              'Ajustement réservation course Drive (+' || v_delta || ' DA)');
    ELSIF v_delta < 0 THEN
      INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
      VALUES (v_customer, NULL, 'topup_credit', 'topup', -v_delta,
              'Ajustement réservation course Drive (recrédit ' || -v_delta || ' DA)');
    END IF;
  END IF;

  UPDATE public.rides
     SET chauffeur_id = v_offer.chauffeur_id, agreed_price_da = v_offer.price_da,
         status = 'accepted', accepted_at = now(),
         share_token = COALESCE(share_token, substr(md5(gen_random_uuid()::text), 1, 8)),
         escrow_da   = CASE WHEN payment_method = 'coligo_pay' THEN v_target ELSE escrow_da END,
         cash_due_da = CASE WHEN payment_method = 'coligo_pay' THEN v_cash ELSE cash_due_da END,
         -- CODE PIN (4 chiffres) : communiqué par le client à l'ARRIVÉE du
         -- chauffeur ; sa saisie DÉMARRE la course (paiements en ligne).
         end_code = CASE WHEN payment_method <> 'cash'
                         THEN COALESCE(end_code, lpad(floor(random() * 10000)::TEXT, 4, '0'))
                         ELSE end_code END
   WHERE id = v_ride.id;

  UPDATE public.ride_offers SET status = 'accepted' WHERE id = p_offer_id;
  UPDATE public.ride_offers SET status = 'expired'
   WHERE ride_offers.ride_id = v_ride.id AND id <> p_offer_id AND status = 'offered';
  UPDATE public.ride_offers SET status = 'expired'
   WHERE chauffeur_id = v_offer.chauffeur_id AND ride_offers.ride_id <> v_ride.id AND status = 'offered';

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (v_ride.id, 'searching', 'accepted', 'Chauffeur choisi'
    || CASE WHEN v_ride.payment_method = 'coligo_pay'
            THEN ' · séquestre ajusté à ' || v_target || ' DA'
              || CASE WHEN v_cash > 0 THEN ' + ' || v_cash || ' DA en espèces' ELSE '' END
            ELSE '' END);
  ok:=true; reason:=NULL; ride_id:=v_ride.id; RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- ride_boost v3 — Coligo Pay : la réservation suit le nouveau total dans la
-- limite du solde (le surplus passe en complément espèces, plus d'échec).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ride_boost(p_ride_id UUID, p_boost_da INTEGER)
RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE s public.platform_settings%ROWTYPE; v_cust UUID; v_ride public.rides%ROWTYPE;
        v_boost INTEGER; v_delta INTEGER; v_bal INTEGER; v_total INTEGER; v_target INTEGER;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT id INTO v_cust FROM public.customers WHERE user_id = auth.uid();
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL OR v_ride.customer_id IS DISTINCT FROM v_cust THEN
    ok:=false; reason:='not_your_ride'; RETURN NEXT; RETURN;
  END IF;
  IF v_ride.status <> 'searching' THEN ok:=false; reason:='ride_not_open'; RETURN NEXT; RETURN; END IF;
  -- Carte : montant déjà payé, le boost ne peut plus changer.
  IF v_ride.payment_method = 'card' THEN ok:=false; reason:='prepaid_fixed_price'; RETURN NEXT; RETURN; END IF;

  v_boost := GREATEST(s.drive_boost_min_da,
    round(GREATEST(0, COALESCE(p_boost_da,0))::NUMERIC / s.drive_boost_step_da) * s.drive_boost_step_da)::INTEGER;

  -- Coligo Pay : réservation plafonnée au solde, complément en espèces.
  IF v_ride.payment_method = 'coligo_pay' THEN
    v_total  := v_ride.proposed_price_da + v_boost;
    SELECT public.customer_topup_balance(v_cust) INTO v_bal;
    v_target := LEAST(v_total, v_ride.escrow_da + GREATEST(COALESCE(v_bal, 0), 0));
    v_delta  := v_target - v_ride.escrow_da;
    IF v_delta > 0 THEN
      INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
      VALUES (v_cust, NULL, 'topup_spent', 'topup', -v_delta, 'Réservation boost course Drive');
    ELSIF v_delta < 0 THEN
      INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
      VALUES (v_cust, NULL, 'topup_credit', 'topup', -v_delta, 'Recrédit boost course Drive');
    END IF;
    UPDATE public.rides SET boost_amount_da = v_boost, escrow_da = v_target,
           cash_due_da = v_total - v_target
     WHERE id = p_ride_id;
  ELSE
    UPDATE public.rides SET boost_amount_da = v_boost WHERE id = p_ride_id;
  END IF;

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (p_ride_id, 'searching', 'searching', 'Boost +' || v_boost || ' DA');
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- complete_ride v4 — règlement MIXTE Coligo Pay (séquestre partiel + espèces).
-- Cas purs (cash / en ligne complet) : écritures STRICTEMENT identiques à v3.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE;
  v_ch UUID; v_ride public.rides%ROWTYPE;
  v_rate NUMERIC(5,4); v_F INTEGER; v_boost INTEGER; v_base INTEGER;
  v_c INTEGER; v_cb INTEGER; v_net INTEGER;
  v_E INTEGER; v_cash INTEGER; v_cov INTEGER;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT id INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_ch IS NULL THEN ok:=false; reason:='not_a_chauffeur'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL OR v_ride.chauffeur_id <> v_ch THEN ok:=false; reason:='not_your_ride'; RETURN NEXT; RETURN; END IF;
  IF v_ride.status = 'completed' THEN ok:=true; reason:='already_completed'; RETURN NEXT; RETURN; END IF;
  IF v_ride.status <> 'in_progress' THEN ok:=false; reason:='not_in_progress'; RETURN NEXT; RETURN; END IF;

  v_F     := GREATEST(0, COALESCE(v_ride.agreed_price_da, v_ride.proposed_price_da + v_ride.boost_amount_da, 0));
  v_boost := LEAST(GREATEST(0, v_ride.boost_amount_da), v_F);
  v_base  := v_F - v_boost;
  v_rate  := public.resolve_vtc_commission(v_ch);
  v_c     := round(v_base * v_rate)::INTEGER;
  v_cb    := LEAST(round(v_F * s.drive_cashback_rate)::INTEGER, v_c);
  v_net   := v_F - v_c;

  -- Carte : prépayée INTÉGRALEMENT avant diffusion — séquestre complet requis.
  IF v_ride.payment_method = 'card' AND v_ride.escrow_da < v_F THEN
    ok:=false; reason:='escrow_missing'; RETURN NEXT; RETURN;
  END IF;

  -- E = part en ligne (séquestre), C = complément espèces (Coligo Pay partiel).
  v_E    := CASE WHEN v_ride.payment_method = 'cash' THEN 0 ELSE LEAST(GREATEST(v_ride.escrow_da, 0), v_F) END;
  v_cash := v_F - v_E;
  v_cov  := LEAST(v_c, v_E);  -- commission couverte par le séquestre

  UPDATE public.rides
     SET status='completed', completed_at=now(),
         commission_rate_applied=v_rate, commission_da=v_c,
         chauffeur_net_da=v_net, cashback_da=v_cb, escrow_da=0,
         cash_due_da = v_cash
   WHERE id = p_ride_id;

  -- Gain net (informatif, toutes formules) :
  INSERT INTO public.ride_ledger (chauffeur_id, ride_id, type, amount_da)
  VALUES (v_ch, p_ride_id, 'chauffeur_payout', v_net)
  ON CONFLICT (ride_id, type) DO NOTHING;
  -- Espèces encaissées par le chauffeur (cash pur OU complément mixte) :
  IF v_cash > 0 THEN
    INSERT INTO public.ride_ledger (chauffeur_id, ride_id, type, amount_da)
    VALUES (v_ch, p_ride_id, 'chauffeur_cash_collected', v_cash)
    ON CONFLICT (ride_id, type) DO NOTHING;
  END IF;
  -- Commission non couverte par le séquestre → dette chauffeur (à reverser) :
  IF v_c - v_cov > 0 THEN
    INSERT INTO public.ride_ledger (chauffeur_id, ride_id, type, amount_da)
    VALUES (v_ch, p_ride_id, 'chauffeur_owes_platform', v_c - v_cov)
    ON CONFLICT (ride_id, type) DO NOTHING;
  END IF;
  -- Commission couverte par le séquestre → recette immédiate plateforme :
  IF v_cov > 0 THEN
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NULL, 'vtc_commission_income', v_cov);
  END IF;
  -- Mixte uniquement : la plateforme détient E, garde c → doit E − c au
  -- chauffeur (en ligne complet, ce dû est déjà porté par chauffeur_payout).
  IF v_cash > 0 AND v_E - v_c > 0 THEN
    INSERT INTO public.ride_ledger (chauffeur_id, ride_id, type, amount_da, note)
    VALUES (v_ch, p_ride_id, 'adjustment', v_E - v_c,
            'Part Coligo Pay à verser au chauffeur (course mixte espèces + séquestre)')
    ON CONFLICT (ride_id, type) DO NOTHING;
  END IF;

  IF v_cb > 0 THEN
    INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
    VALUES (v_ride.customer_id, NULL, 'cashback_earned', 'cashback', v_cb, 'Cashback course Drive');
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NULL, 'cashback_expense', -v_cb);
  END IF;

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (p_ride_id, 'in_progress', 'completed',
    'Course terminée'
    || CASE WHEN v_E > 0 THEN ' · séquestre libéré (' || v_E || ' DA)' ELSE '' END
    || CASE WHEN v_E > 0 AND v_cash > 0 THEN ' + ' || v_cash || ' DA encaissés en espèces' ELSE '' END);
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_ride(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- drive_card_failed — webhook Chargily (checkout.failed / canceled) : la
-- demande carte non payée encore « searching » est annulée automatiquement.
-- Aucun débit n'a eu lieu (séquestre 0) → rien à rembourser. Idempotent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_card_failed(p_ride_id UUID)
RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_ride public.rides%ROWTYPE;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN ok:=false; reason:='ride_not_found'; RETURN NEXT; RETURN; END IF;
  -- Le paiement confirmé (webhook checkout.paid) prime toujours.
  IF v_ride.payment_method <> 'card' OR v_ride.online_paid_at IS NOT NULL THEN
    ok:=false; reason:='not_applicable'; RETURN NEXT; RETURN;
  END IF;

  UPDATE public.rides SET card_failed_at = COALESCE(card_failed_at, now()) WHERE id = p_ride_id;

  IF v_ride.status = 'searching' THEN
    UPDATE public.rides SET status='cancelled', cancelled_at=now(), cancelled_by='customer'
     WHERE id = p_ride_id;
    UPDATE public.ride_offers SET status='expired' WHERE ride_id = p_ride_id AND status='offered';
    INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
    VALUES (p_ride_id, v_ride.status::text, 'cancelled',
            'Paiement carte échoué — demande annulée automatiquement (aucun débit)');
  END IF;
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_card_failed(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- my_active_ride v4 : + escrow_da / cash_due_da (affichage du complément
-- espèces côté client) — colonnes ajoutées EN FIN (lecture par nom côté TS).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.my_active_ride();
CREATE OR REPLACE FUNCTION public.my_active_ride()
RETURNS TABLE(
  id UUID, status TEXT, pickup_text TEXT, dest_text TEXT,
  pickup_lat DOUBLE PRECISION, pickup_lng DOUBLE PRECISION,
  dest_lat DOUBLE PRECISION, dest_lng DOUBLE PRECISION,
  distance_km NUMERIC, proposed_price_da INTEGER, agreed_price_da INTEGER,
  boost_amount_da INTEGER, gamme TEXT, payment_method TEXT,
  female_only BOOLEAN, proxy_name TEXT, proxy_phone TEXT,
  share_token TEXT, end_code TEXT, online_paid_at TIMESTAMPTZ,
  chauffeur_id UUID, ch_name TEXT, ch_vehicle TEXT, ch_plate TEXT, ch_phone TEXT,
  ch_rating NUMERIC, ch_rides BIGINT, ch_is_female BOOLEAN, ch_is_premium BOOLEAN,
  ch_is_favorite BOOLEAN, ch_lat DOUBLE PRECISION, ch_lng DOUBLE PRECISION,
  created_at TIMESTAMPTZ, escrow_da INTEGER, cash_due_da INTEGER
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
         r.female_only, r.proxy_name, r.proxy_phone,
         r.share_token, r.end_code, r.online_paid_at,
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
         r.created_at, r.escrow_da, r.cash_due_da
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
