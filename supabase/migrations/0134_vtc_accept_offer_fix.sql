-- =============================================================================
-- 0134 — VTC : fix ambiguïté `ride_id` dans accept_ride_offer
-- =============================================================================
-- Le paramètre de SORTIE `ride_id` masquait la colonne `ride_offers.ride_id`
-- (« column reference ride_id is ambiguous »). On qualifie la colonne.
-- =============================================================================

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
   WHERE ride_offers.ride_id = v_ride.id AND id <> p_offer_id AND status = 'offered';

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (v_ride.id, 'searching', 'accepted', 'Chauffeur choisi');
  ok:=true; reason:=NULL; ride_id:=v_ride.id; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.accept_ride_offer(UUID) TO authenticated;
