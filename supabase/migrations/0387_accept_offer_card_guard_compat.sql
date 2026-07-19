-- =============================================================================
-- 0387 — accept_ride_offer : garde carte COMPATIBLE avec l'ancien flux
-- =============================================================================
-- 0386 rejetait TOUTE course carte dans accept_ride_offer (card_pay_required),
-- ce qui casserait l'acceptation d'une course carte DÉJÀ prépayée servie par
-- le frontend encore déployé (transition). Correctif : ne rejeter que si la
-- course carte n'est PAS encore payée (nouveau flux « payer à l'acceptation »).
-- Une course carte déjà `online_paid_at` (ancien flux) s'accepte normalement.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.accept_ride_offer(p_offer_id uuid, p_operation_id text DEFAULT NULL::text)
RETURNS TABLE(ok boolean, reason text, ride_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Course CARTE NON PAYÉE : l'acceptation passe par le paiement à l'acceptation
  -- (drive_card_reserve_offer + webhook drive_card_accept_reserved). Une course
  -- carte déjà prépayée (ancien flux, online_paid_at) s'accepte normalement.
  IF v_ride.payment_method = 'card' AND v_ride.online_paid_at IS NULL THEN
    ok:=false; reason:='card_pay_required'; RETURN NEXT; RETURN;
  END IF;

  SELECT c.id INTO v_ch_lock FROM public.chauffeurs c WHERE c.id = v_offer.chauffeur_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.rides r WHERE r.chauffeur_id = v_offer.chauffeur_id
             AND r.status IN ('accepted','arriving','arrived','in_progress')) THEN
    UPDATE public.ride_offers SET status='expired' WHERE id = p_offer_id;
    ok:=false; reason:='chauffeur_busy'; RETURN NEXT; RETURN;
  END IF;
  IF public._drive_chauffeur_reserved_elsewhere(v_offer.chauffeur_id, v_ride.id) THEN
    ok:=false; reason:='chauffeur_busy'; RETURN NEXT; RETURN;
  END IF;

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
         end_code = CASE WHEN payment_method <> 'cash'
                         THEN COALESCE(end_code, lpad(floor(random() * 10000)::TEXT, 4, '0'))
                         ELSE end_code END
   WHERE id = v_ride.id;

  UPDATE public.ride_offers SET status = 'accepted', reserved_until = NULL WHERE id = p_offer_id;
  UPDATE public.ride_offers SET status = 'expired'
   WHERE ride_offers.ride_id = v_ride.id AND id <> p_offer_id AND status = 'offered';
  UPDATE public.ride_offers SET status = 'expired', reserved_until = NULL
   WHERE chauffeur_id = v_offer.chauffeur_id AND ride_offers.ride_id <> v_ride.id AND status = 'offered';

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (v_ride.id, 'searching', 'accepted', 'Chauffeur choisi'
    || CASE WHEN v_ride.payment_method = 'coligo_pay'
            THEN ' · séquestre ajusté à ' || v_target || ' DA'
              || CASE WHEN v_cash > 0 THEN ' + ' || v_cash || ' DA en espèces' ELSE '' END
            ELSE '' END);
  ok:=true; reason:=NULL; ride_id:=v_ride.id; RETURN NEXT;
END;
$function$;
