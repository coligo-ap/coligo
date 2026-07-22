-- =============================================================================
-- 0402 — Le MÊME véhicule, du choix de gamme jusqu'au suivi de course
-- =============================================================================
-- Sur la carte des gammes / de recherche, le client voit des véhicules orientés
-- (mig 0400-0401). Une fois le chauffeur accepté, l'écran de suivi affichait
-- encore une pastille générique : le client perdait le repère visuel ET la
-- direction du véhicule qui vient le chercher.
--
-- `my_active_ride` renvoie donc maintenant la GAMME du chauffeur (voiture ou
-- moto — même visuel que sur la carte précédente) et son CAP (mig 0400), pour
-- que le suivi montre exactement le même véhicule, orienté dans son sens de
-- circulation.
--
-- ⚠️ Signature ÉLARGIE : `RETURNS TABLE` change → il faut DROP avant CREATE.

drop function if exists public.my_active_ride();

create or replace function public.my_active_ride()
returns table (
  id uuid, status text, pickup_text text, dest_text text,
  pickup_lat double precision, pickup_lng double precision,
  dest_lat double precision, dest_lng double precision,
  distance_km numeric, proposed_price_da integer, agreed_price_da integer,
  boost_amount_da integer, gamme text, payment_method text,
  female_only boolean, proxy_name text, proxy_phone text,
  share_token text, end_code text, online_paid_at timestamptz,
  chauffeur_id uuid, ch_name text, ch_vehicle text, ch_plate text,
  ch_phone text, ch_rating numeric, ch_rides bigint, ch_is_female boolean,
  ch_is_premium boolean, ch_is_favorite boolean,
  ch_lat double precision, ch_lng double precision,
  -- NOUVEAU (mig 0402) : de quoi dessiner le bon véhicule, bien orienté.
  ch_gamme text, ch_heading numeric,
  created_at timestamptz, escrow_da integer, cash_due_da integer,
  expires_at timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
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
         c.gamme, p.heading,
         r.created_at, r.escrow_da, r.cash_due_da, r.expires_at
  FROM public.rides r
  LEFT JOIN public.chauffeurs c ON c.id = r.chauffeur_id
  LEFT JOIN public.chauffeur_presence p ON p.chauffeur_id = c.id
  WHERE r.customer_id = v_customer
    AND r.status IN ('searching','accepted','arriving','arrived','in_progress')
  ORDER BY r.created_at DESC
  LIMIT 1;
END;
$$;

grant execute on function public.my_active_ride() to authenticated;
