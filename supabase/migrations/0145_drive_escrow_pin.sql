-- ============================================================
-- 0145 — Drive : paiement AVANT la demande + SÉQUESTRE + PIN au démarrage
-- Décisions ROU (2026-06-11) :
--  • CARTE (CIB/Dahabia) : le client paie AVANT que la demande soit
--    diffusée (gating webhook, comme mig 0068) ; prix FIXE — les
--    chauffeurs acceptent au prix payé, pas de contre-offre.
--  • COLIGO PAY : solde vérifié à la demande, montant RÉSERVÉ
--    immédiatement (débit wallet → séquestre) ; contre-offres permises,
--    la réservation s'ajuste à l'acceptation (débit/recrédit du delta).
--  • Annulation avant/après attribution (tant que non terminée) :
--    remboursement INTÉGRAL immédiat sur le portefeuille Coligo Pay
--    (y compris les paiements carte).
--  • SÉQUESTRE : l'argent reste bloqué (rides.escrow_da) ; à l'arrivée
--    le client communique son CODE PIN (4 chiffres), le chauffeur le
--    saisit → la course DÉMARRE ; libération au chauffeur uniquement
--    à la complétion (règles plateforme inchangées : commission/plan,
--    boost 100 % chauffeur, cashback financé par la commission).
-- ============================================================

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS escrow_da INTEGER NOT NULL DEFAULT 0 CHECK (escrow_da >= 0);

-- ---------------------------------------------------------------------------
-- Remboursement du séquestre sur le wallet (annulation / expiration TTL).
-- Idempotent par construction : escrow_da repasse à 0 dans la même transaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_refund_escrow(p_ride_id UUID, p_note TEXT DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_ride public.rides%ROWTYPE; v_amount INTEGER;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL OR v_ride.escrow_da <= 0 THEN RETURN 0; END IF;
  v_amount := v_ride.escrow_da;
  UPDATE public.rides SET escrow_da = 0 WHERE id = p_ride_id;
  INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
  VALUES (v_ride.customer_id, NULL, 'topup_credit', 'topup', v_amount,
          COALESCE(p_note, 'Remboursement course Drive annulée'));
  RETURN v_amount;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_refund_escrow(UUID, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- request_ride v3 — Coligo Pay : solde vérifié + RÉSERVATION immédiate.
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

  v_suggest := public.drive_recommended_price(p_distance_km, p_gamme);
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
-- Diffusion : une course CARTE non payée n'est PAS diffusée.
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
-- chauffeur_offer_ride v3 — carte = prix FIXE (déjà payé) : acceptation au
-- prix client uniquement ; pas de contre-offre. Carte non payée = pas ouverte.
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
     OR (v_ride.expires_at IS NOT NULL AND v_ride.expires_at < now())
     OR (v_ride.payment_method = 'card' AND v_ride.online_paid_at IS NULL) THEN
    ok:=false; reason:='ride_not_open'; RETURN NEXT; RETURN;
  END IF;

  -- Carte prépayée : montant déjà encaissé → prix fixe, pas de contre-offre.
  IF v_ride.payment_method = 'card'
     AND p_price <> v_ride.proposed_price_da + v_ride.boost_amount_da THEN
    ok:=false; reason:='prepaid_fixed_price'; RETURN NEXT; RETURN;
  END IF;

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
-- accept_ride_offer v4 — ajuste la RÉSERVATION Coligo Pay au prix convenu
-- (delta débité/recrédité) + PIN 4 chiffres pour les courses en ligne.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_ride_offer(p_offer_id UUID, p_operation_id TEXT DEFAULT NULL)
RETURNS TABLE(ok BOOLEAN, reason TEXT, ride_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer UUID; v_offer public.ride_offers%ROWTYPE; v_ride public.rides%ROWTYPE;
  v_ch_lock UUID; v_delta INTEGER; v_bal INTEGER;
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

  -- COLIGO PAY : la réservation s'ajuste au prix convenu (contre-offre).
  IF v_ride.payment_method = 'coligo_pay' THEN
    v_delta := v_offer.price_da - v_ride.escrow_da;
    IF v_delta > 0 THEN
      SELECT public.customer_topup_balance(v_customer) INTO v_bal;
      IF COALESCE(v_bal, 0) < v_delta THEN
        ok:=false; reason:='insufficient_coligo_pay'; RETURN NEXT; RETURN;
      END IF;
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
         escrow_da = CASE WHEN payment_method = 'coligo_pay' THEN v_offer.price_da ELSE escrow_da END,
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
            THEN ' · séquestre ajusté à ' || v_offer.price_da || ' DA' ELSE '' END);
  ok:=true; reason:=NULL; ride_id:=v_ride.id; RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- ride_set_status v2 — le DÉMARRAGE (in_progress) exige le CODE PIN du client
-- pour les courses en ligne (séquestre). L'argent reste bloqué.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.ride_set_status(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.ride_set_status(p_ride_id UUID, p_status TEXT, p_pin TEXT DEFAULT NULL)
RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_ch UUID; v_ride public.rides%ROWTYPE; v_next public.ride_status;
BEGIN
  SELECT id INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_ch IS NULL THEN ok:=false; reason:='not_a_chauffeur'; RETURN NEXT; RETURN; END IF;
  IF p_status NOT IN ('arriving','arrived','in_progress') THEN ok:=false; reason:='bad_status'; RETURN NEXT; RETURN; END IF;
  v_next := p_status::public.ride_status;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL OR v_ride.chauffeur_id <> v_ch THEN ok:=false; reason:='not_your_ride'; RETURN NEXT; RETURN; END IF;
  IF NOT (
       (v_next='arriving'    AND v_ride.status='accepted')
    OR (v_next='arrived'     AND v_ride.status IN ('accepted','arriving'))
    OR (v_next='in_progress' AND v_ride.status='arrived')
  ) THEN ok:=false; reason:='invalid_transition'; RETURN NEXT; RETURN; END IF;

  -- PIN au démarrage : le client le communique à l'arrivée ; validé = course
  -- démarrée, le montant RESTE bloqué en séquestre.
  IF v_next = 'in_progress' AND v_ride.payment_method <> 'cash' AND v_ride.end_code IS NOT NULL
     AND COALESCE(btrim(p_pin), '') <> v_ride.end_code THEN
    ok:=false; reason:='bad_pin'; RETURN NEXT; RETURN;
  END IF;

  UPDATE public.rides
     SET status = v_next,
         arrived_at = CASE WHEN v_next='arrived' THEN now() ELSE arrived_at END,
         started_at = CASE WHEN v_next='in_progress' THEN now() ELSE started_at END
   WHERE id = p_ride_id;
  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (p_ride_id, v_ride.status::text, v_next::text,
    CASE WHEN v_next='in_progress' AND v_ride.payment_method <> 'cash'
         THEN 'Code PIN validé — course démarrée (séquestre maintenu)' ELSE NULL END);
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ride_set_status(UUID, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- complete_ride v3 — plus AUCUN débit ni code à la fin : le séquestre est
-- LIBÉRÉ (payout net au chauffeur, commission plateforme, cashback).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.complete_ride(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE;
  v_ch UUID; v_ride public.rides%ROWTYPE;
  v_rate NUMERIC(5,4); v_F INTEGER; v_boost INTEGER; v_base INTEGER;
  v_c INTEGER; v_cb INTEGER; v_net INTEGER;
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

  -- En ligne : l'argent est DÉJÀ en séquestre (réservation cpay / carte payée
  -- avant diffusion) — rien à débiter ici, on libère.
  IF v_ride.payment_method <> 'cash' AND v_ride.escrow_da < v_F THEN
    ok:=false; reason:='escrow_missing'; RETURN NEXT; RETURN;
  END IF;

  UPDATE public.rides
     SET status='completed', completed_at=now(),
         commission_rate_applied=v_rate, commission_da=v_c,
         chauffeur_net_da=v_net, cashback_da=v_cb, escrow_da=0
   WHERE id = p_ride_id;

  IF v_ride.payment_method = 'cash' THEN
    INSERT INTO public.ride_ledger (chauffeur_id, ride_id, type, amount_da)
    VALUES (v_ch, p_ride_id, 'chauffeur_cash_collected', v_F),
           (v_ch, p_ride_id, 'chauffeur_owes_platform', v_c),
           (v_ch, p_ride_id, 'chauffeur_payout', v_net)
    ON CONFLICT (ride_id, type) DO NOTHING;
  ELSE
    INSERT INTO public.ride_ledger (chauffeur_id, ride_id, type, amount_da)
    VALUES (v_ch, p_ride_id, 'chauffeur_payout', v_net)
    ON CONFLICT (ride_id, type) DO NOTHING;
    IF v_c > 0 THEN
      INSERT INTO public.platform_ledger (order_id, type, amount_da)
      VALUES (NULL, 'vtc_commission_income', v_c);
    END IF;
  END IF;

  IF v_cb > 0 THEN
    INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
    VALUES (v_ride.customer_id, NULL, 'cashback_earned', 'cashback', v_cb, 'Cashback course Drive');
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NULL, 'cashback_expense', -v_cb);
  END IF;

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (p_ride_id, 'in_progress', 'completed',
    'Course terminée' || CASE WHEN v_ride.payment_method <> 'cash'
      THEN ' · séquestre libéré (' || v_net || ' DA chauffeur)' ELSE '' END);
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_ride(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- cancel_ride v2 — remboursement INTÉGRAL immédiat sur le wallet (cpay ET
-- carte payée), avant comme après attribution (jamais après démarrage).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_ride(p_ride_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ride public.rides%ROWTYPE; v_by TEXT; v_cust UUID; v_ch UUID; v_refund INTEGER;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN ok:=false; reason:='ride_not_found'; RETURN NEXT; RETURN; END IF;
  IF v_ride.status IN ('completed','cancelled') THEN ok:=false; reason:='already_terminal'; RETURN NEXT; RETURN; END IF;
  IF v_ride.status = 'in_progress' THEN ok:=false; reason:='already_started'; RETURN NEXT; RETURN; END IF;

  SELECT id INTO v_cust FROM public.customers WHERE user_id = auth.uid();
  SELECT id INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_cust IS NOT NULL AND v_ride.customer_id = v_cust THEN v_by := 'customer';
  ELSIF v_ch IS NOT NULL AND v_ride.chauffeur_id = v_ch THEN v_by := 'chauffeur';
  ELSE ok:=false; reason:='forbidden'; RETURN NEXT; RETURN; END IF;

  UPDATE public.rides SET status='cancelled', cancelled_at=now(), cancelled_by=v_by WHERE id=p_ride_id;
  UPDATE public.ride_offers SET status='expired' WHERE ride_id=p_ride_id AND status='offered';

  -- Séquestre → recrédit immédiat sur le portefeuille Coligo Pay.
  v_refund := public.drive_refund_escrow(p_ride_id,
    CASE WHEN v_ride.payment_method = 'card'
         THEN 'Remboursement course Drive annulée (paiement carte → Coligo Pay)'
         ELSE 'Remboursement course Drive annulée (réservation Coligo Pay)' END);

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (p_ride_id, v_ride.status::text, 'cancelled',
          'Annulée par ' || v_by || COALESCE(' — ' || NULLIF(btrim(p_reason),''), '')
          || CASE WHEN v_refund > 0 THEN ' · ' || v_refund || ' DA remboursés sur Coligo Pay' ELSE '' END);
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- ride_boost v2 — cpay : débite la différence (solde requis) ; carte : figé.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ride_boost(p_ride_id UUID, p_boost_da INTEGER)
RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE s public.platform_settings%ROWTYPE; v_cust UUID; v_ride public.rides%ROWTYPE;
        v_boost INTEGER; v_delta INTEGER; v_bal INTEGER;
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

  -- Coligo Pay : la réservation suit le nouveau total.
  IF v_ride.payment_method = 'coligo_pay' THEN
    v_delta := (v_ride.proposed_price_da + v_boost) - v_ride.escrow_da;
    IF v_delta > 0 THEN
      SELECT public.customer_topup_balance(v_cust) INTO v_bal;
      IF COALESCE(v_bal, 0) < v_delta THEN ok:=false; reason:='insufficient_coligo_pay'; RETURN NEXT; RETURN; END IF;
      INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
      VALUES (v_cust, NULL, 'topup_spent', 'topup', -v_delta, 'Réservation boost course Drive');
    ELSIF v_delta < 0 THEN
      INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
      VALUES (v_cust, NULL, 'topup_credit', 'topup', -v_delta, 'Recrédit boost course Drive');
    END IF;
    UPDATE public.rides SET boost_amount_da = v_boost, escrow_da = proposed_price_da + v_boost
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
-- drive_expire_stale v2 — l'expiration TTL rembourse aussi le séquestre.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_expire_stale()
RETURNS TABLE(expired_rides INTEGER, expired_offers INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_r INTEGER := 0; v_o INTEGER; rec RECORD;
BEGIN
  FOR rec IN
    SELECT r.id FROM public.rides r
    WHERE r.status='searching' AND r.expires_at IS NOT NULL AND r.expires_at < now()
    FOR UPDATE
  LOOP
    UPDATE public.rides SET status='cancelled', cancelled_at=now(), cancelled_by='system'
     WHERE id = rec.id;
    PERFORM public.drive_refund_escrow(rec.id, 'Remboursement course Drive expirée');
    INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
    VALUES (rec.id, 'searching', 'cancelled', 'Demande expirée (TTL) — séquestre remboursé');
    v_r := v_r + 1;
  END LOOP;
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

-- ---------------------------------------------------------------------------
-- Webhook carte : pose le séquestre — et si la course a été annulée entre
-- temps, rembourse immédiatement sur le wallet (service_role).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_card_paid(p_ride_id UUID, p_amount_da INTEGER, p_checkout_id TEXT)
RETURNS TABLE(ok BOOLEAN, refunded BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_ride public.rides%ROWTYPE;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN ok:=false; refunded:=false; RETURN NEXT; RETURN; END IF;
  -- Idempotence : déjà traité.
  IF v_ride.online_paid_at IS NOT NULL THEN ok:=true; refunded:=false; RETURN NEXT; RETURN; END IF;

  UPDATE public.rides
     SET online_paid_at = now(), chargily_checkout_id = p_checkout_id,
         escrow_da = GREATEST(escrow_da, p_amount_da)
   WHERE id = p_ride_id;

  -- Payée APRÈS annulation/expiration → recrédit immédiat sur le wallet.
  IF v_ride.status IN ('cancelled') THEN
    PERFORM public.drive_refund_escrow(p_ride_id,
      'Remboursement course Drive annulée (paiement carte → Coligo Pay)');
    ok:=true; refunded:=true; RETURN NEXT; RETURN;
  END IF;

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (p_ride_id, v_ride.status::text, v_ride.status::text,
          'Paiement carte confirmé (' || p_amount_da || ' DA en séquestre) — demande diffusée');
  ok:=true; refunded:=false; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_card_paid(UUID, INTEGER, TEXT) TO service_role;
