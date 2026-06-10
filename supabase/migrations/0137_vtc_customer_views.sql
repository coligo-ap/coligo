-- =============================================================================
-- 0137 — VTC : le client voit chauffeur/offres via RPC (fix récursion RLS 0136)
-- =============================================================================
-- La policy 0136 (chauffeurs visibles au client) créait une RÉCURSION RLS
-- (rides → chauffeurs → ride_offers → rides…). On la SUPPRIME et on expose les
-- données chauffeur au client via des RPC SECURITY DEFINER gardées (la course /
-- l'offre doivent appartenir au client appelant). Pas de cycle RLS.
-- =============================================================================

DROP POLICY IF EXISTS chauffeurs_visible_to_customer ON public.chauffeurs;

-- Course active du client + chauffeur attribué.
CREATE OR REPLACE FUNCTION public.my_active_ride()
RETURNS TABLE(
  id UUID, status TEXT, pickup_text TEXT, dest_text TEXT, distance_km NUMERIC,
  proposed_price_da INTEGER, agreed_price_da INTEGER, payment_method TEXT,
  ch_name TEXT, ch_vehicle TEXT, ch_plate TEXT, ch_phone TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_cust UUID;
BEGIN
  SELECT c.id INTO v_cust FROM public.customers c WHERE c.user_id = auth.uid();
  IF v_cust IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT r.id, r.status::text, r.pickup_text, r.dest_text, r.distance_km,
         r.proposed_price_da, r.agreed_price_da, r.payment_method,
         ch.full_name,
         NULLIF(btrim(concat_ws(' ', ch.vehicle_make, ch.vehicle_model)), ''),
         ch.vehicle_plate, ch.phone
  FROM public.rides r
  LEFT JOIN public.chauffeurs ch ON ch.id = r.chauffeur_id
  WHERE r.customer_id = v_cust
    AND r.status IN ('searching','accepted','arriving','arrived','in_progress')
  ORDER BY r.created_at DESC
  LIMIT 1;
END;
$$;
GRANT EXECUTE ON FUNCTION public.my_active_ride() TO authenticated;

-- Offres reçues sur une course du client (avec le chauffeur).
CREATE OR REPLACE FUNCTION public.my_ride_offers(p_ride_id UUID)
RETURNS TABLE(id UUID, price_da INTEGER, chauffeur_name TEXT, vehicle TEXT, plate TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_cust UUID;
BEGIN
  SELECT c.id INTO v_cust FROM public.customers c WHERE c.user_id = auth.uid();
  IF v_cust IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rides r WHERE r.id = p_ride_id AND r.customer_id = v_cust) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT o.id, o.price_da, ch.full_name,
         NULLIF(btrim(concat_ws(' ', ch.vehicle_make, ch.vehicle_model)), ''),
         ch.vehicle_plate
  FROM public.ride_offers o
  JOIN public.chauffeurs ch ON ch.id = o.chauffeur_id
  WHERE o.ride_id = p_ride_id AND o.status = 'offered'
  ORDER BY o.price_da ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.my_ride_offers(UUID) TO authenticated;
