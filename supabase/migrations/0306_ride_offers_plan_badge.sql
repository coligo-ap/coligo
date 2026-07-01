-- =============================================================================
-- 0306 — Badge de plan dans les offres client : couleur/label du plan du chauffeur
-- -----------------------------------------------------------------------------
-- Le passager voit le plan du chauffeur sous forme d'ANNEAU COLORÉ autour de sa
-- photo (pas de card). my_ride_offers renvoie désormais badge_label + badge_color
-- issus de drive_plans (0304), résolus côté serveur via resolve_drive_plan.
-- Signature étendue → DROP + CREATE (corps identique à 0211 + LEFT JOIN drive_plans).
-- =============================================================================

DROP FUNCTION IF EXISTS public.my_ride_offers(uuid);

CREATE OR REPLACE FUNCTION public.my_ride_offers(p_ride_id uuid)
RETURNS TABLE(
  id uuid, price_da integer, chauffeur_id uuid, chauffeur_name text, vehicle text,
  plate text, rating numeric, rides_count bigint, is_female boolean, is_premium boolean,
  is_favorite boolean, eta_km numeric, rank_score numeric, created_at timestamp with time zone,
  is_priority boolean, badge_label text, badge_color text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
         (COALESCE(dp.display_rank, 0) > 0) AS is_premium,
         EXISTS (SELECT 1 FROM public.customer_favorite_chauffeurs f
           WHERE f.customer_id = v_customer AND f.chauffeur_id = c.id) AS is_favorite,
         dist.km AS eta_km,
         public.drive_rank_score(c.id, dist.km) AS rank_score,
         o.created_at,
         public.is_priority('chauffeur', c.id) AS is_priority,
         dp.badge_label AS badge_label,
         dp.badge_color AS badge_color
  FROM public.ride_offers o
  JOIN public.chauffeurs c ON c.id = o.chauffeur_id
  CROSS JOIN LATERAL public.resolve_drive_plan(c.id) rp
  LEFT JOIN public.drive_plans dp ON dp.code = rp.plan
  CROSS JOIN LATERAL (
    SELECT (SELECT (6371 * acos(LEAST(1, GREATEST(-1,
        cos(radians(v_ride.pickup_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(v_ride.pickup_lng))
        + sin(radians(v_ride.pickup_lat)) * sin(radians(p.lat))))))::NUMERIC
      FROM public.chauffeur_presence p WHERE p.chauffeur_id = c.id) AS km
  ) dist
  WHERE o.ride_id = p_ride_id AND o.status = 'offered'
    AND (o.expires_at IS NULL OR o.expires_at > now())
  ORDER BY 13 DESC, 2 ASC;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.my_ride_offers(uuid) TO authenticated;
