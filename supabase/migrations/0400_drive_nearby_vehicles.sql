-- =============================================================================
-- 0400 — Chauffeurs à proximité, VISIBLES sur la carte client (façon Uber/Bolt)
-- =============================================================================
-- Deux besoins : afficher les véhicules disponibles autour du point de départ
-- (écran des gammes ET écran de recherche), et les ORIENTER dans leur sens de
-- circulation. Il manquait donc un CAP.
--
-- CONFIDENTIALITÉ — un flux « positions des chauffeurs » ouvert à tout client
-- serait un outil de filature. Trois garde-fous, dans la RPC :
--   1. AUCUN identifiant réel : chaque véhicule reçoit un jeton pseudonyme qui
--      CHANGE CHAQUE JOUR (stable dans la journée pour que le marqueur garde
--      son identité entre deux relevés, non corrélable d'un jour à l'autre) ;
--   2. position ARRONDIE à ~11 m (4 décimales) : suffisant pour « il y a une
--      voiture dans ma rue », inutilisable pour suivre quelqu'un ;
--   3. rayon et nombre PLAFONNÉS côté serveur, présence fraîche uniquement,
--      et les chauffeurs EN COURSE sont exclus (ils ne sont pas disponibles).
-- Aucune donnée nominative ne sort : ni nom, ni plaque, ni id.

-- -----------------------------------------------------------------------------
-- 1) Cap (direction de circulation)
-- -----------------------------------------------------------------------------
alter table public.chauffeur_presence
  add column if not exists heading numeric;

comment on column public.chauffeur_presence.heading is
  'Cap en degrés (0 = nord, sens horaire), remonté par le GPS du chauffeur. NULL si indisponible — le client déduit alors la direction du déplacement.';

-- Le heartbeat transporte désormais le cap. L'ancienne signature à 3 arguments
-- est SUPPRIMÉE : la garder rendrait l'appel à 3 arguments AMBIGU (il
-- correspondrait à la fois à l'ancienne et à la nouvelle avec défaut).
drop function if exists public.chauffeur_heartbeat(double precision, double precision, boolean);

create or replace function public.chauffeur_heartbeat(
  p_lat double precision,
  p_lng double precision,
  p_online boolean default true,
  p_heading numeric default null
)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
DECLARE
  v_ch UUID; v_prev public.chauffeur_presence%ROWTYPE;
  v_today DATE; v_delta INTEGER := 0; v_heading NUMERIC;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN
    RETURN;
  END IF;
  SELECT id INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_ch IS NULL THEN RETURN; END IF;

  -- Cap normalisé dans [0,360[. Hors bornes / absent ⇒ on GARDE le dernier cap
  -- connu (un GPS ne renvoie pas de cap à l'arrêt : sans ça le véhicule
  -- pivoterait au nord à chaque feu rouge).
  v_heading := CASE
    WHEN p_heading IS NULL THEN NULL
    ELSE ((p_heading::numeric % 360) + 360) % 360
  END;

  v_today := (now() AT TIME ZONE 'Africa/Algiers')::DATE;
  SELECT * INTO v_prev FROM public.chauffeur_presence WHERE chauffeur_id = v_ch;
  IF v_prev.chauffeur_id IS NOT NULL AND v_prev.is_online AND p_online THEN
    v_delta := LEAST(3, GREATEST(0,
      floor(EXTRACT(EPOCH FROM (now() - v_prev.updated_at)) / 60)))::INTEGER;
  END IF;

  INSERT INTO public.chauffeur_presence
    (chauffeur_id, lat, lng, is_online, updated_at, online_minutes_date,
     online_minutes, heading)
  VALUES (v_ch, p_lat, p_lng, COALESCE(p_online, true), now(), v_today, 0,
          v_heading)
  ON CONFLICT (chauffeur_id) DO UPDATE SET
    lat = EXCLUDED.lat,
    lng = EXCLUDED.lng,
    is_online = EXCLUDED.is_online,
    updated_at = now(),
    heading = COALESCE(EXCLUDED.heading, public.chauffeur_presence.heading),
    online_minutes = CASE
      WHEN public.chauffeur_presence.online_minutes_date IS DISTINCT FROM v_today THEN v_delta
      ELSE public.chauffeur_presence.online_minutes + v_delta END,
    online_minutes_date = v_today;
END;
$$;

grant execute on function public.chauffeur_heartbeat(double precision, double precision, boolean, numeric)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 2) Véhicules disponibles autour d'un point (client)
-- -----------------------------------------------------------------------------
create or replace function public.drive_nearby_vehicles(
  p_lat double precision,
  p_lng double precision,
  p_radius_km numeric default 4,
  p_gamme text default null,
  p_limit integer default 14
)
returns table (
  token text,
  lat double precision,
  lng double precision,
  heading numeric,
  kind text,
  distance_km numeric
)
language sql stable security definer set search_path = public, extensions, pg_temp
as $$
  WITH params AS (
    SELECT LEAST(GREATEST(COALESCE(p_radius_km, 4), 0.5), 12) AS radius_km,
           LEAST(GREATEST(COALESCE(p_limit, 14), 1), 30) AS max_rows
  )
  SELECT
    -- Jeton pseudonyme : stable dans la JOURNÉE (le marqueur garde son
    -- identité entre deux relevés), non corrélable d'un jour sur l'autre.
    left(md5(c.id::text || '|' || (now() AT TIME ZONE 'Africa/Algiers')::date::text), 12) AS token,
    round(pr.lat::numeric, 4)::double precision AS lat,
    round(pr.lng::numeric, 4)::double precision AS lng,
    pr.heading,
    CASE WHEN c.gamme = 'moto' THEN 'moto' ELSE 'car' END AS kind,
    round((ST_Distance(
      pr.geog, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
    ) / 1000)::numeric, 2) AS distance_km
  FROM public.chauffeur_presence pr
  JOIN public.chauffeurs c ON c.id = pr.chauffeur_id
  CROSS JOIN params
  WHERE pr.is_online
    AND pr.geog IS NOT NULL
    -- Présence FRAÎCHE : un chauffeur dont l'app dort n'est pas « à proximité ».
    AND pr.updated_at > now() - interval '3 minutes'
    AND c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked
    AND (p_gamme IS NULL OR c.gamme = p_gamme)
    AND ST_DWithin(
      pr.geog,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      params.radius_km * 1000
    )
    -- Déjà en course = indisponible : l'afficher ferait espérer pour rien.
    AND NOT EXISTS (
      SELECT 1 FROM public.rides r
       WHERE r.chauffeur_id = c.id
         AND r.status IN ('accepted', 'arriving', 'arrived', 'in_progress')
    )
  ORDER BY pr.geog <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  LIMIT (SELECT max_rows FROM params);
$$;

comment on function public.drive_nearby_vehicles is
  'Véhicules disponibles autour d''un point, ANONYMISÉS (jeton du jour, position arrondie ~11 m) pour la carte client. Aucune donnée nominative.';

grant execute on function public.drive_nearby_vehicles(double precision, double precision, numeric, text, integer)
  to authenticated;
revoke execute on function public.drive_nearby_vehicles(double precision, double precision, numeric, text, integer)
  from anon;
