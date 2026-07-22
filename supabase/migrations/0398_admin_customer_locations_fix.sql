-- =============================================================================
-- 0398 — Correctif `admin_customer_locations` (0397)
-- =============================================================================
-- PIÈGE PostgreSQL : dans un UNION, les noms de colonnes viennent des
-- EXPRESSIONS de la PREMIÈRE branche. Comme celles-ci étaient des `coalesce(…)`
-- sans alias, la sous-requête n'exposait aucun `seen_at` → « column t.seen_at
-- does not exist » au ORDER BY. On nomme donc explicitement chaque colonne de
-- la première branche.

create or replace function public.admin_customer_locations(
  p_customer_id uuid,
  p_limit integer default 40
)
returns table (
  kind text,
  label text,
  lat double precision,
  lng double precision,
  city text,
  seen_at timestamptz,
  detail text
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
DECLARE v_user UUID;
BEGIN
  PERFORM public._customers_require_admin();
  SELECT c.user_id INTO v_user FROM public.customers c WHERE c.id = p_customer_id;

  RETURN QUERY
  SELECT * FROM (
    -- Connexions (géo IP) — la « dernière localisation » la plus fraîche.
    SELECT 'device'::text                              AS kind,
           coalesce(l.city, l.country, 'Connexion')    AS label,
           l.lat                                       AS lat,
           l.lng                                       AS lng,
           l.city                                      AS city,
           l.last_seen_at                              AS seen_at,
           concat_ws(' · ', l.platform, l.ip)          AS detail
      FROM public.user_device_log l
     WHERE l.user_id = v_user AND l.lat IS NOT NULL

    UNION ALL
    -- Adresses enregistrées.
    SELECT 'address'::text, coalesce(a.label, 'Adresse'),
           a.lat, a.lng, null::text, a.updated_at, a.address_text
      FROM public.customer_addresses a
     WHERE a.customer_id = p_customer_id AND a.lat IS NOT NULL

    UNION ALL
    -- Livraisons réellement effectuées.
    SELECT 'delivery'::text, coalesce(o.delivery_commune, 'Livraison'),
           o.delivery_lat, o.delivery_lng, o.delivery_commune,
           coalesce(o.delivery_delivered_at, o.created_at),
           o.delivery_address_text
      FROM public.orders o
     WHERE o.customer_id = p_customer_id AND o.delivery_lat IS NOT NULL

    UNION ALL
    -- Départs de course Drive.
    SELECT 'ride'::text, 'Course', rd.pickup_lat, rd.pickup_lng, null::text,
           rd.created_at, rd.pickup_text
      FROM public.rides rd
     WHERE rd.customer_id = p_customer_id AND rd.pickup_lat IS NOT NULL
  ) t
  ORDER BY t.seen_at DESC NULLS LAST
  LIMIT LEAST(GREATEST(coalesce(p_limit, 40), 1), 200);
END $$;

grant execute on function public.admin_customer_locations(uuid, integer)
  to authenticated, service_role;
revoke execute on function public.admin_customer_locations(uuid, integer) from anon;
