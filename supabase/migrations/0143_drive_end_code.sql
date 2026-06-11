-- ============================================================
-- 0143 — Drive : code de fin (2 chiffres) pour courses prépayées
-- Maquette : client « Course prépayée · Code de fin : X Y — donnez-le
-- au chauffeur à l'arrivée » / chauffeur « demandez le code de fin ».
-- Généré à l'attribution quand paiement ≠ espèces ; complete_ride
-- exige le code pour valider une course prépayée.
-- ============================================================

ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS end_code TEXT;

-- Génération du code à l'acceptation (paiement en ligne uniquement).
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

  UPDATE public.rides
     SET chauffeur_id = v_offer.chauffeur_id, agreed_price_da = v_offer.price_da,
         status = 'accepted', accepted_at = now(),
         share_token = COALESCE(share_token, substr(md5(gen_random_uuid()::text), 1, 8)),
         -- Code de fin (2 chiffres) pour les courses prépayées.
         end_code = CASE WHEN payment_method <> 'cash'
                         THEN COALESCE(end_code, lpad(floor(random() * 100)::TEXT, 2, '0'))
                         ELSE end_code END
   WHERE id = v_ride.id;

  UPDATE public.ride_offers SET status = 'accepted' WHERE id = p_offer_id;
  UPDATE public.ride_offers SET status = 'expired'
   WHERE ride_offers.ride_id = v_ride.id AND id <> p_offer_id AND status = 'offered';
  UPDATE public.ride_offers SET status = 'expired'
   WHERE chauffeur_id = v_offer.chauffeur_id AND ride_offers.ride_id <> v_ride.id AND status = 'offered';

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (v_ride.id, 'searching', 'accepted', 'Chauffeur choisi');
  ok:=true; reason:=NULL; ride_id:=v_ride.id; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.accept_ride_offer(UUID, TEXT) TO authenticated;

-- complete_ride : exige le code de fin pour une course prépayée.
DROP FUNCTION IF EXISTS public.complete_ride(UUID);
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID, p_end_code TEXT DEFAULT NULL)
RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE;
  v_ch UUID; v_ride public.rides%ROWTYPE;
  v_rate NUMERIC(5,4); v_F INTEGER; v_boost INTEGER; v_base INTEGER;
  v_c INTEGER; v_cb INTEGER; v_net INTEGER; v_bal INTEGER;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT id INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_ch IS NULL THEN ok:=false; reason:='not_a_chauffeur'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL OR v_ride.chauffeur_id <> v_ch THEN ok:=false; reason:='not_your_ride'; RETURN NEXT; RETURN; END IF;
  IF v_ride.status = 'completed' THEN ok:=true; reason:='already_completed'; RETURN NEXT; RETURN; END IF;
  IF v_ride.status <> 'in_progress' THEN ok:=false; reason:='not_in_progress'; RETURN NEXT; RETURN; END IF;

  -- Course prépayée : le code de fin du client valide la fin de course.
  IF v_ride.payment_method <> 'cash' AND v_ride.end_code IS NOT NULL
     AND COALESCE(btrim(p_end_code), '') <> v_ride.end_code THEN
    ok:=false; reason:='bad_end_code'; RETURN NEXT; RETURN;
  END IF;

  v_F     := GREATEST(0, COALESCE(v_ride.agreed_price_da, v_ride.proposed_price_da + v_ride.boost_amount_da, 0));
  v_boost := LEAST(GREATEST(0, v_ride.boost_amount_da), v_F);
  v_base  := v_F - v_boost;
  v_rate  := public.resolve_vtc_commission(v_ch);
  v_c     := round(v_base * v_rate)::INTEGER;
  v_cb    := LEAST(round(v_F * s.drive_cashback_rate)::INTEGER, v_c);
  v_net   := v_F - v_c;

  IF v_ride.payment_method = 'coligo_pay' THEN
    SELECT public.customer_topup_balance(v_ride.customer_id) INTO v_bal;
    IF COALESCE(v_bal,0) < v_F THEN ok:=false; reason:='insufficient_coligo_pay'; RETURN NEXT; RETURN; END IF;
    INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
    VALUES (v_ride.customer_id, NULL, 'topup_spent', 'topup', -v_F,
            'Course Drive — paiement Coligo Pay');
  ELSIF v_ride.payment_method = 'card' AND v_ride.online_paid_at IS NULL THEN
    ok:=false; reason:='card_not_paid'; RETURN NEXT; RETURN;
  END IF;

  UPDATE public.rides
     SET status='completed', completed_at=now(),
         commission_rate_applied=v_rate, commission_da=v_c,
         chauffeur_net_da=v_net, cashback_da=v_cb
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
  VALUES (p_ride_id, 'in_progress', 'completed', 'Course terminée');
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_ride(UUID, TEXT) TO authenticated;

-- my_active_ride : expose le code de fin (côté client uniquement).
DROP FUNCTION IF EXISTS public.my_active_ride();
CREATE OR REPLACE FUNCTION public.my_active_ride()
RETURNS TABLE(
  id UUID, status TEXT, pickup_text TEXT, dest_text TEXT,
  pickup_lat DOUBLE PRECISION, pickup_lng DOUBLE PRECISION,
  dest_lat DOUBLE PRECISION, dest_lng DOUBLE PRECISION,
  distance_km NUMERIC, proposed_price_da INTEGER, agreed_price_da INTEGER,
  boost_amount_da INTEGER, gamme TEXT, payment_method TEXT,
  female_only BOOLEAN, proxy_name TEXT, share_token TEXT, end_code TEXT,
  online_paid_at TIMESTAMPTZ,
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
         r.female_only, r.proxy_name, r.share_token, r.end_code,
         r.online_paid_at,
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
