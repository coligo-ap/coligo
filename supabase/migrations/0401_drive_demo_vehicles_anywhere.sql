-- =============================================================================
-- 0401 — Bots de démonstration VISIBLES autour de n'importe quelle adresse
-- =============================================================================
-- Les chauffeurs de démonstration (`is_demo`, mig 0395) répondent déjà partout —
-- ils sont « téléportés » au moment du dispatch. Mais la carte, elle, ne montrait
-- que les présences RÉELLES : impossible de tester l'affichage des véhicules
-- (voiture/moto, orientation, phares, glissement) sans un vrai chauffeur en
-- ligne au bon endroit.
--
-- Ici, `drive_nearby_vehicles` complète la liste réelle avec les bots, placés
-- AUTOUR DU POINT DEMANDÉ. Deux propriétés voulues :
--   - ils SUIVENT l'adresse testée (n'importe où, y compris à l'étranger) ;
--   - ils BOUGENT : chaque bot parcourt lentement un cercle (4 à 8 min le tour),
--     et son cap est la TANGENTE de sa trajectoire — donc le sprite pointe
--     vraiment là où il va, ce qui permet de vérifier rotation et phares.
-- Tout est DÉTERMINISTE (dérivé de l'id du bot + de l'horloge) : aucune écriture,
-- deux clients au même endroit voient la même scène, et le marqueur garde son
-- identité d'un relevé à l'autre.
--
-- ⚠️ INTERRUPTEUR : `platform_settings.drive_demo_vehicles`. À l'ouverture au
-- public, le passer à FALSE — afficher de faux véhicules à de vrais clients
-- serait un mensonge. Les bots restent alors utilisables pour le dispatch.

alter table public.platform_settings
  add column if not exists drive_demo_vehicles boolean not null default true;

comment on column public.platform_settings.drive_demo_vehicles is
  'Affiche les chauffeurs de DÉMONSTRATION sur la carte client, autour du point demandé (aide au test). METTRE À FALSE à l''ouverture publique.';

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
           LEAST(GREATEST(COALESCE(p_limit, 14), 1), 30) AS max_rows,
           (now() AT TIME ZONE 'Africa/Algiers')::date AS today,
           extract(epoch from now()) AS t,
           COALESCE(
             (SELECT s.drive_demo_vehicles FROM public.platform_settings s WHERE s.id),
             false
           ) AS demo_on
  ),
  -- 1) Véhicules RÉELS : présence fraîche, chauffeur en règle, hors course.
  reels AS (
    SELECT
      left(md5(c.id::text || '|' || params.today::text), 12) AS token,
      round(pr.lat::numeric, 4)::double precision AS lat,
      round(pr.lng::numeric, 4)::double precision AS lng,
      pr.heading,
      CASE WHEN c.gamme = 'moto' THEN 'moto' ELSE 'car' END AS kind,
      round((ST_Distance(
        pr.geog, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
      ) / 1000)::numeric, 2) AS distance_km,
      0 AS prio
    FROM public.chauffeur_presence pr
    JOIN public.chauffeurs c ON c.id = pr.chauffeur_id
    CROSS JOIN params
    WHERE pr.is_online
      AND pr.geog IS NOT NULL
      AND pr.updated_at > now() - interval '3 minutes'
      AND c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked
      AND (p_gamme IS NULL OR c.gamme = p_gamme)
      AND ST_DWithin(
        pr.geog,
        ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
        params.radius_km * 1000
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.rides r
         WHERE r.chauffeur_id = c.id
           AND r.status IN ('accepted', 'arriving', 'arrived', 'in_progress')
      )
  ),
  -- 2) Bots de DÉMONSTRATION, placés autour du point demandé.
  demo_base AS (
    SELECT
      c.id,
      c.gamme,
      -- Graine stable par bot : angle de départ, rayon, période de tour.
      (abs(('x' || substr(md5(c.id::text), 1, 8))::bit(32)::int) % 360)::numeric AS a0,
      (250 + abs(('x' || substr(md5(c.id::text || 'r'), 1, 8))::bit(32)::int) % 900)::numeric AS radius_m,
      (240 + abs(('x' || substr(md5(c.id::text || 'p'), 1, 8))::bit(32)::int) % 240)::numeric AS period_s
    FROM public.chauffeurs c
    CROSS JOIN params
    WHERE params.demo_on
      AND c.is_demo
      AND c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked
      AND (p_gamme IS NULL OR c.gamme = p_gamme)
      -- Un bot EN COURSE n'est plus disponible : il disparaît de la carte,
      -- exactement comme un vrai chauffeur.
      AND NOT EXISTS (
        SELECT 1 FROM public.rides r
         WHERE r.chauffeur_id = c.id
           AND r.status IN ('accepted', 'arriving', 'arrived', 'in_progress')
      )
  ),
  demo AS (
    SELECT
      left(md5(d.id::text || '|' || params.today::text), 12) AS token,
      -- Position sur le cercle : composante nord = cos, est = sin.
      round((p_lat + (d.radius_m / 111320.0)
             * cos(radians(ang.deg)))::numeric, 4)::double precision AS lat,
      round((p_lng + (d.radius_m
             / (111320.0 * GREATEST(cos(radians(p_lat)), 0.2)))
             * sin(radians(ang.deg)))::numeric, 4)::double precision AS lng,
      -- Cap = TANGENTE du cercle (sens horaire) → le véhicule pointe là où il va.
      round(((ang.deg + 90)::numeric % 360), 1) AS heading,
      CASE WHEN d.gamme = 'moto' THEN 'moto' ELSE 'car' END AS kind,
      round((d.radius_m / 1000)::numeric, 2) AS distance_km,
      1 AS prio
    FROM demo_base d
    CROSS JOIN params
    CROSS JOIN LATERAL (
      SELECT ((d.a0 + 360 * (params.t / d.period_s))::numeric % 360) AS deg
    ) ang
    WHERE d.radius_m / 1000.0 <= params.radius_km
  )
  SELECT token, lat, lng, heading, kind, distance_km
  FROM (
    SELECT * FROM reels
    UNION ALL
    SELECT * FROM demo
  ) v
  -- Les vrais chauffeurs d'abord (prio 0), puis les bots, du plus proche au plus
  -- loin — un vrai véhicule ne doit jamais être évincé par un bot.
  ORDER BY v.prio, v.distance_km
  LIMIT (SELECT max_rows FROM params);
$$;

comment on function public.drive_nearby_vehicles is
  'Véhicules disponibles autour d''un point, ANONYMISÉS (jeton du jour, position arrondie ~11 m). Complété par les bots de démonstration en orbite lente autour du point demandé quand platform_settings.drive_demo_vehicles est actif.';

grant execute on function public.drive_nearby_vehicles(double precision, double precision, numeric, text, integer)
  to authenticated;
revoke execute on function public.drive_nearby_vehicles(double precision, double precision, numeric, text, integer)
  from anon;
