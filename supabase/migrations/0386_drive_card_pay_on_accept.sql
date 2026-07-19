-- =============================================================================
-- 0386 — Coligo Drive : paiement carte À L'ACCEPTATION (prix exact convenu)
-- =============================================================================
-- AVANT : le client PRÉPAYAIT son offre initiale AVANT diffusion ; si un
-- chauffeur acceptait à un AUTRE prix (négociation), l'escrow carte restait
-- figé sur le montant prépayé → le client ne payait pas le prix réel.
--
-- APRÈS (choix proprio) : la course carte est diffusée SANS prépaiement
-- (comme espèces). Quand le client CHOISIT un chauffeur, il paie EXACTEMENT le
-- prix de cette offre ; la course n'est confirmée qu'au paiement. Si le
-- paiement échoue/est abandonné, « comme si rien n'était » : l'offre
-- redevient disponible, la course reste en recherche.
--
-- Mécanique : RÉSERVATION courte du chauffeur (reserved_until, ~3 min) pendant
-- le paiement pour éviter « débité sans course ». Le webhook (Chargily/Stripe)
-- finalise l'acceptation (service_role) ; s'il ne peut plus accepter (chauffeur
-- pris entre-temps), le montant payé est RECRÉDITÉ sur le Coligo Pay du client
-- (refund uniforme et fiable, quel que soit le rail).
-- =============================================================================

-- 1) Réservation (sans nouvelle valeur d'enum : évite le piège ALTER TYPE en
--    transaction). Une offre est « réservée » si status='offered' ET
--    reserved_until > now().
ALTER TABLE public.ride_offers
  ADD COLUMN IF NOT EXISTS reserved_until timestamptz,
  ADD COLUMN IF NOT EXISTS reserved_by    uuid;

-- Session Stripe € rattachée à une OFFRE précise (release ciblé à l'abandon).
ALTER TABLE public.intl_payment_sessions
  ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES public.ride_offers(id);

-- Chauffeur « occupé » = a une réservation vivante sur une AUTRE course.
CREATE OR REPLACE FUNCTION public._drive_chauffeur_reserved_elsewhere(
  p_chauffeur uuid, p_ride uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ride_offers o
     WHERE o.chauffeur_id = p_chauffeur
       AND o.ride_id <> p_ride
       AND o.status = 'offered'
       AND o.reserved_until IS NOT NULL
       AND o.reserved_until > now()
  );
$$;

-- ---------------------------------------------------------------------------
-- 2) RÉSERVER une offre (client) → verrouille le chauffeur le temps du paiement
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_card_reserve_offer(p_offer_id uuid)
RETURNS TABLE (ok boolean, reason text, price_da integer, ride_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_customer uuid; v_offer public.ride_offers%ROWTYPE; v_ride public.rides%ROWTYPE;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN ok:=false; reason:='no_customer'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_offer FROM public.ride_offers WHERE id = p_offer_id FOR UPDATE;
  IF v_offer.id IS NULL THEN ok:=false; reason:='offer_not_found'; RETURN NEXT; RETURN; END IF;
  IF v_offer.status <> 'offered'
     OR (v_offer.expires_at IS NOT NULL AND v_offer.expires_at < now()) THEN
    ok:=false; reason:='offer_expired'; RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = v_offer.ride_id FOR UPDATE;
  IF v_ride.customer_id <> v_customer THEN ok:=false; reason:='not_your_ride'; RETURN NEXT; RETURN; END IF;
  IF v_ride.payment_method <> 'card' THEN ok:=false; reason:='not_card'; RETURN NEXT; RETURN; END IF;
  IF v_ride.online_paid_at IS NOT NULL THEN ok:=false; reason:='already_paid'; RETURN NEXT; RETURN; END IF;
  IF v_ride.status <> 'searching' THEN ok:=false; reason:='ride_not_open'; RETURN NEXT; RETURN; END IF;

  -- Chauffeur déjà en course active ? déjà réservé ailleurs ?
  PERFORM 1 FROM public.chauffeurs c WHERE c.id = v_offer.chauffeur_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.rides r WHERE r.chauffeur_id = v_offer.chauffeur_id
             AND r.status IN ('accepted','arriving','arrived','in_progress')) THEN
    ok:=false; reason:='chauffeur_busy'; RETURN NEXT; RETURN;
  END IF;
  IF public._drive_chauffeur_reserved_elsewhere(v_offer.chauffeur_id, v_ride.id) THEN
    ok:=false; reason:='chauffeur_busy'; RETURN NEXT; RETURN;
  END IF;

  -- Libère une éventuelle réservation précédente du même client sur CETTE course
  -- (il change de chauffeur) puis réserve celle-ci.
  UPDATE public.ride_offers SET reserved_until = NULL, reserved_by = NULL
   WHERE ride_offers.ride_id = v_ride.id AND id <> p_offer_id
     AND status = 'offered' AND reserved_by = v_customer;
  UPDATE public.ride_offers
     SET reserved_until = now() + interval '3 minutes', reserved_by = v_customer
   WHERE id = p_offer_id;

  ok:=true; reason:=NULL; price_da:=v_offer.price_da; ride_id:=v_ride.id; RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.drive_card_reserve_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.drive_card_reserve_offer(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) FINALISER au paiement (webhook, service_role) : accepte au prix EXACT ;
--    si le chauffeur n'est plus disponible → RECRÉDIT le Coligo Pay du client.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_card_accept_reserved(
  p_offer_id uuid, p_amount_da integer, p_checkout_id text
)
RETURNS TABLE (ok boolean, reason text, ride_id uuid, refunded boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_offer public.ride_offers%ROWTYPE; v_ride public.rides%ROWTYPE; v_op text;
BEGIN
  SELECT * INTO v_offer FROM public.ride_offers WHERE id = p_offer_id FOR UPDATE;
  IF v_offer.id IS NULL THEN ok:=false; reason:='offer_not_found'; refunded:=false; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = v_offer.ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN ok:=false; reason:='ride_not_found'; refunded:=false; RETURN NEXT; RETURN; END IF;

  -- Idempotence : déjà accepté pour CE chauffeur → succès (rejeu webhook).
  IF v_ride.status <> 'searching' THEN
    IF v_ride.status = 'accepted' AND v_ride.chauffeur_id = v_offer.chauffeur_id
       AND v_ride.online_paid_at IS NOT NULL THEN
      ok:=true; reason:='already_accepted'; ride_id:=v_ride.id; refunded:=false; RETURN NEXT; RETURN;
    END IF;
    -- Course prise/annulée entre-temps → on ne peut plus accepter : REFUND.
    v_op := 'drive_card_refund:' || p_checkout_id;
    IF NOT EXISTS (SELECT 1 FROM public.customer_wallet_entries
                   WHERE customer_id = v_ride.customer_id AND note = v_op) THEN
      INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
      VALUES (v_ride.customer_id, NULL, 'topup_credit', 'topup', p_amount_da, v_op);
    END IF;
    ok:=false; reason:='ride_not_open'; ride_id:=v_ride.id; refunded:=true; RETURN NEXT; RETURN;
  END IF;

  -- Chauffeur pris par une autre course active ? → REFUND (ne double-booke pas).
  IF EXISTS (SELECT 1 FROM public.rides r WHERE r.chauffeur_id = v_offer.chauffeur_id
             AND r.status IN ('accepted','arriving','arrived','in_progress')) THEN
    v_op := 'drive_card_refund:' || p_checkout_id;
    IF NOT EXISTS (SELECT 1 FROM public.customer_wallet_entries
                   WHERE customer_id = v_ride.customer_id AND note = v_op) THEN
      INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
      VALUES (v_ride.customer_id, NULL, 'topup_credit', 'topup', p_amount_da, v_op);
    END IF;
    UPDATE public.ride_offers SET status='expired' WHERE id = p_offer_id;
    ok:=false; reason:='chauffeur_busy'; ride_id:=v_ride.id; refunded:=true; RETURN NEXT; RETURN;
  END IF;

  -- ACCEPTATION au prix EXACT de l'offre (escrow = montant payé).
  UPDATE public.rides
     SET chauffeur_id = v_offer.chauffeur_id, agreed_price_da = v_offer.price_da,
         status = 'accepted', accepted_at = now(),
         online_paid_at = now(), chargily_checkout_id = p_checkout_id,
         escrow_da = p_amount_da, cash_due_da = 0,
         share_token = COALESCE(share_token, substr(md5(gen_random_uuid()::text), 1, 8)),
         end_code = COALESCE(end_code, lpad(floor(random() * 10000)::TEXT, 4, '0'))
   WHERE id = v_ride.id;

  UPDATE public.ride_offers SET status = 'accepted', reserved_until = NULL WHERE id = p_offer_id;
  UPDATE public.ride_offers SET status = 'expired'
   WHERE ride_offers.ride_id = v_ride.id AND id <> p_offer_id AND status = 'offered';
  -- Le chauffeur retenu : ses offres sur d'AUTRES courses tombent + réservations levées.
  UPDATE public.ride_offers SET status = 'expired', reserved_until = NULL
   WHERE chauffeur_id = v_offer.chauffeur_id AND ride_offers.ride_id <> v_ride.id AND status = 'offered';

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (v_ride.id, 'searching', 'accepted',
          'Chauffeur choisi · carte payée ' || p_amount_da || ' DA (prix convenu)');

  ok:=true; reason:=NULL; ride_id:=v_ride.id; refunded:=false; RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.drive_card_accept_reserved(uuid,integer,text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) LIBÉRER une réservation (paiement échoué/abandonné) — offre re-disponible
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_card_release_offer(p_offer_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.ride_offers
     SET reserved_until = NULL, reserved_by = NULL
   WHERE id = p_offer_id AND status = 'offered';
END;
$$;
REVOKE ALL ON FUNCTION public.drive_card_release_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.drive_card_release_offer(uuid) TO authenticated;

-- Nettoyage des réservations périmées (client parti pendant le paiement).
CREATE OR REPLACE FUNCTION public.drive_release_stale_reservations()
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  UPDATE public.ride_offers
     SET reserved_until = NULL, reserved_by = NULL
   WHERE status = 'offered' AND reserved_until IS NOT NULL AND reserved_until < now();
$$;
REVOKE ALL ON FUNCTION public.drive_release_stale_reservations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.drive_release_stale_reservations() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) accept_ride_offer : respecter les réservations carte en cours.
--    (Corps identique à l'existant + garde « réservé ailleurs » et levée des
--    réservations du chauffeur retenu.)
-- ---------------------------------------------------------------------------
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

  -- Course CARTE : l'acceptation passe par le paiement (drive_card_reserve_offer
  -- + webhook drive_card_accept_reserved), jamais par ici.
  IF v_ride.payment_method = 'card' THEN
    ok:=false; reason:='card_pay_required'; RETURN NEXT; RETURN;
  END IF;

  SELECT c.id INTO v_ch_lock FROM public.chauffeurs c WHERE c.id = v_offer.chauffeur_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.rides r WHERE r.chauffeur_id = v_offer.chauffeur_id
             AND r.status IN ('accepted','arriving','arrived','in_progress')) THEN
    UPDATE public.ride_offers SET status='expired' WHERE id = p_offer_id;
    ok:=false; reason:='chauffeur_busy'; RETURN NEXT; RETURN;
  END IF;
  -- NOUVEAU : chauffeur réservé (paiement carte en cours) sur une AUTRE course.
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
