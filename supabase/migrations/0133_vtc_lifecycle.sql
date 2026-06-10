-- =============================================================================
-- 0133 — VTC : cycle de vie d'une course + argent (réconcilié SUM=0)
-- =============================================================================
-- Négociation : request_ride (client) → chauffeur_offer_ride (accept/contre) →
-- accept_ride_offer (client choisit) → ride_set_status (en route/arrivé/à bord) →
-- complete_ride (argent) / cancel_ride.
--
-- Argent (aligné sur le modèle livraison) :
--   • ESPÈCES  : chauffeur custodian. ride_ledger : cash_collected=F,
--     owes_platform=c, payout=F−c. Résidu = F − c − (F−c) = 0. Pas de platform_ledger
--     (commission reconnue au reversement, comme le COD livraison).
--   • COLIGO PAY : client débité F (wallet). platform_ledger vtc_commission_income=c.
--     ride_ledger payout=F−c (dû au chauffeur). Global : −F + (F−c) + c = 0.
-- Commission = round(F × resolve_vtc_commission(chauffeur)) — 8 % (abonnements Phase 2).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Prix suggéré (barème) + taux de commission effectif.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vtc_suggested_price(p_distance_km NUMERIC)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(
    s.vtc_min_da,
    round(s.vtc_base_da + GREATEST(0, p_distance_km) * s.vtc_per_km_da)::INTEGER
  )
  FROM public.platform_settings s WHERE s.id = true;
$$;
GRANT EXECUTE ON FUNCTION public.vtc_suggested_price(NUMERIC) TO authenticated, anon;

-- Phase 1 : taux plat (abonnements chauffeur en Phase 2 surchargeront ici).
CREATE OR REPLACE FUNCTION public.resolve_vtc_commission(p_chauffeur_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT vtc_commission_rate FROM public.platform_settings WHERE id = true;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_vtc_commission(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- request_ride — le client demande une course (status searching).
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
  p_payment_method TEXT DEFAULT 'cash'
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer UUID;
  v_suggest  INTEGER;
  v_ride     UUID;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN RAISE EXCEPTION 'Profil client introuvable.' USING ERRCODE='check_violation'; END IF;
  IF p_payment_method NOT IN ('cash','coligo_pay') THEN p_payment_method := 'cash'; END IF;

  -- Anti-spam : une seule course active à la fois par client.
  IF EXISTS (SELECT 1 FROM public.rides WHERE customer_id = v_customer
             AND status IN ('searching','accepted','arriving','arrived','in_progress')) THEN
    RAISE EXCEPTION 'Vous avez déjà une course en cours.' USING ERRCODE='check_violation';
  END IF;

  v_suggest := public.vtc_suggested_price(p_distance_km);

  INSERT INTO public.rides (customer_id, status, pickup_lat, pickup_lng, pickup_text,
    dest_lat, dest_lng, dest_text, distance_km, suggested_price_da, proposed_price_da, payment_method)
  VALUES (v_customer, 'searching', p_pickup_lat, p_pickup_lng, p_pickup_text,
    p_dest_lat, p_dest_lng, p_dest_text, GREATEST(0, p_distance_km), v_suggest,
    GREATEST(v_suggest / 2, COALESCE(NULLIF(p_proposed_price, 0), v_suggest)), p_payment_method)
  RETURNING id INTO v_ride;

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (v_ride, NULL, 'searching', 'Course demandée');
  RETURN v_ride;
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_ride(DOUBLE PRECISION,DOUBLE PRECISION,TEXT,DOUBLE PRECISION,DOUBLE PRECISION,TEXT,NUMERIC,INTEGER,TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- chauffeur_offer_ride — le chauffeur accepte au prix proposé OU contre-propose.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chauffeur_offer_ride(
  p_ride_id UUID, p_price INTEGER
) RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_ch UUID; v_status public.ride_status;
BEGIN
  SELECT id INTO v_ch FROM public.chauffeurs
    WHERE user_id = auth.uid() AND is_verified AND NOT is_frozen AND NOT is_blocked;
  IF v_ch IS NULL THEN ok:=false; reason:='not_a_verified_chauffeur'; RETURN NEXT; RETURN; END IF;
  IF p_price IS NULL OR p_price <= 0 THEN ok:=false; reason:='bad_price'; RETURN NEXT; RETURN; END IF;

  SELECT status INTO v_status FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_status IS NULL THEN ok:=false; reason:='ride_not_found'; RETURN NEXT; RETURN; END IF;
  IF v_status <> 'searching' THEN ok:=false; reason:='ride_not_open'; RETURN NEXT; RETURN; END IF;

  INSERT INTO public.ride_offers (ride_id, chauffeur_id, price_da, status)
  VALUES (p_ride_id, v_ch, p_price, 'offered')
  ON CONFLICT (ride_id, chauffeur_id) DO UPDATE
    SET price_da = EXCLUDED.price_da, status = 'offered', created_at = now();
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chauffeur_offer_ride(UUID, INTEGER) TO authenticated;

-- ---------------------------------------------------------------------------
-- accept_ride_offer — le client choisit une offre → attribue le chauffeur.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_ride_offer(p_offer_id UUID)
RETURNS TABLE(ok BOOLEAN, reason TEXT, ride_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer UUID; v_offer public.ride_offers%ROWTYPE; v_ride public.rides%ROWTYPE;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN ok:=false; reason:='no_customer'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_offer FROM public.ride_offers WHERE id = p_offer_id;
  IF v_offer.id IS NULL THEN ok:=false; reason:='offer_not_found'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = v_offer.ride_id FOR UPDATE;
  IF v_ride.customer_id <> v_customer THEN ok:=false; reason:='not_your_ride'; RETURN NEXT; RETURN; END IF;
  IF v_ride.status <> 'searching' THEN ok:=false; reason:='ride_not_open'; RETURN NEXT; RETURN; END IF;

  UPDATE public.rides
     SET chauffeur_id = v_offer.chauffeur_id, agreed_price_da = v_offer.price_da,
         status = 'accepted', accepted_at = now()
   WHERE id = v_ride.id;

  UPDATE public.ride_offers SET status = 'accepted' WHERE id = p_offer_id;
  UPDATE public.ride_offers SET status = 'expired'
   WHERE ride_id = v_ride.id AND id <> p_offer_id AND status = 'offered';

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (v_ride.id, 'searching', 'accepted', 'Chauffeur choisi');
  ok:=true; reason:=NULL; ride_id:=v_ride.id; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.accept_ride_offer(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- ride_set_status — le chauffeur attribué avance : arriving / arrived / in_progress.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ride_set_status(p_ride_id UUID, p_status TEXT)
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
  -- Transitions valides uniquement (accepted→arriving→arrived→in_progress).
  IF NOT (
       (v_next='arriving'    AND v_ride.status='accepted')
    OR (v_next='arrived'     AND v_ride.status IN ('accepted','arriving'))
    OR (v_next='in_progress' AND v_ride.status='arrived')
  ) THEN ok:=false; reason:='invalid_transition'; RETURN NEXT; RETURN; END IF;

  UPDATE public.rides
     SET status = v_next,
         arrived_at = CASE WHEN v_next='arrived' THEN now() ELSE arrived_at END,
         started_at = CASE WHEN v_next='in_progress' THEN now() ELSE started_at END
   WHERE id = p_ride_id;
  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (p_ride_id, v_ride.status::text, v_next::text, NULL);
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ride_set_status(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- complete_ride — fin de course + ARGENT (réconcilié).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ch UUID; v_ride public.rides%ROWTYPE;
  v_rate NUMERIC(5,4); v_F INTEGER; v_c INTEGER; v_net INTEGER; v_bal INTEGER;
BEGIN
  SELECT id INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_ch IS NULL THEN ok:=false; reason:='not_a_chauffeur'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL OR v_ride.chauffeur_id <> v_ch THEN ok:=false; reason:='not_your_ride'; RETURN NEXT; RETURN; END IF;
  IF v_ride.status = 'completed' THEN ok:=true; reason:='already_completed'; RETURN NEXT; RETURN; END IF;
  IF v_ride.status <> 'in_progress' THEN ok:=false; reason:='not_in_progress'; RETURN NEXT; RETURN; END IF;

  v_F := GREATEST(0, COALESCE(v_ride.agreed_price_da, v_ride.proposed_price_da, 0));
  v_rate := public.resolve_vtc_commission(v_ch);
  v_c := round(v_F * v_rate)::INTEGER;
  v_net := v_F - v_c;

  -- COLIGO PAY : débiter le client (solde requis).
  IF v_ride.payment_method = 'coligo_pay' THEN
    SELECT public.customer_topup_balance(v_ride.customer_id) INTO v_bal;
    IF COALESCE(v_bal,0) < v_F THEN ok:=false; reason:='insufficient_coligo_pay'; RETURN NEXT; RETURN; END IF;
    INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
    VALUES (v_ride.customer_id, NULL, 'topup_spent', 'topup', -v_F,
            'Course VTC — paiement Coligo Pay');
  END IF;

  UPDATE public.rides
     SET status='completed', completed_at=now(),
         commission_rate_applied=v_rate, commission_da=v_c, chauffeur_net_da=v_net
   WHERE id = p_ride_id;

  IF v_ride.payment_method = 'cash' THEN
    -- Chauffeur custodian : encaisse F, garde net, doit c à la plateforme.
    INSERT INTO public.ride_ledger (chauffeur_id, ride_id, type, amount_da)
    VALUES (v_ch, p_ride_id, 'chauffeur_cash_collected', v_F),
           (v_ch, p_ride_id, 'chauffeur_owes_platform', v_c),
           (v_ch, p_ride_id, 'chauffeur_payout', v_net)
    ON CONFLICT (ride_id, type) DO NOTHING;
  ELSE
    -- Coligo Pay : la plateforme détient F, doit net au chauffeur, garde c.
    INSERT INTO public.ride_ledger (chauffeur_id, ride_id, type, amount_da)
    VALUES (v_ch, p_ride_id, 'chauffeur_payout', v_net)
    ON CONFLICT (ride_id, type) DO NOTHING;
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NULL, 'vtc_commission_income', v_c);
  END IF;

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (p_ride_id, 'in_progress', 'completed', 'Course terminée');
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_ride(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- cancel_ride — client OU chauffeur attribué, AVANT prise en charge (in_progress).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_ride(p_ride_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ride public.rides%ROWTYPE; v_by TEXT; v_cust UUID; v_ch UUID;
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
  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (p_ride_id, v_ride.status::text, 'cancelled',
          'Annulée par ' || v_by || COALESCE(' — ' || NULLIF(btrim(p_reason),''), ''));
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cancel_ride(UUID, TEXT) TO authenticated;
