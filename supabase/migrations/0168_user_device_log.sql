-- ============================================================
-- 0168 — Traçage appareils / IP / localisation des utilisateurs.
--
-- Un « ping » léger est envoyé par le client connecté (toutes les ~6 h par
-- appareil, cf. /api/telemetry/ping) : IP + géo approximative (headers
-- Vercel), user-agent, plateforme, mode PWA installée. Une ligne par
-- (user, rôle, ip, ua) avec compteur — sert au super-admin pour la
-- recherche, la maîtrise des appareils et l'anti-fraude (IP partagées
-- entre plusieurs comptes, pays inhabituels, multi-comptes par appareil).
--
-- RLS activé SANS policy : table accessible uniquement en service_role
-- (écriture via RPC definer, lecture via RPCs admin ci-dessous).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_device_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'customer',
  ip            TEXT NOT NULL,
  ua            TEXT NOT NULL DEFAULT '',
  platform      TEXT,             -- android / ios / windows / macos / linux / other
  is_standalone BOOLEAN,          -- PWA installée (ou APK) au moment du ping
  country       TEXT,
  region        TEXT,
  city          TEXT,
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  hits          INT NOT NULL DEFAULT 1,
  UNIQUE (user_id, role, ip, ua)
);

CREATE INDEX IF NOT EXISTS user_device_log_user_idx ON public.user_device_log (user_id);
CREATE INDEX IF NOT EXISTS user_device_log_ip_idx   ON public.user_device_log (ip);
CREATE INDEX IF NOT EXISTS user_device_log_seen_idx ON public.user_device_log (last_seen_at DESC);

ALTER TABLE public.user_device_log ENABLE ROW LEVEL SECURITY;

-- Upsert + compteur (appelé par l'API route en service_role).
CREATE OR REPLACE FUNCTION public.log_device_ping(
  p_user_id UUID,
  p_role TEXT,
  p_ip TEXT,
  p_ua TEXT,
  p_platform TEXT,
  p_standalone BOOLEAN,
  p_country TEXT,
  p_region TEXT,
  p_city TEXT,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION
) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.user_device_log AS l
    (user_id, role, ip, ua, platform, is_standalone,
     country, region, city, lat, lng)
  VALUES
    (p_user_id, coalesce(p_role, 'customer'), p_ip, coalesce(p_ua, ''),
     p_platform, p_standalone, p_country, p_region, p_city, p_lat, p_lng)
  ON CONFLICT (user_id, role, ip, ua) DO UPDATE SET
    last_seen_at  = now(),
    hits          = l.hits + 1,
    platform      = COALESCE(EXCLUDED.platform, l.platform),
    is_standalone = COALESCE(EXCLUDED.is_standalone, l.is_standalone),
    country       = COALESCE(EXCLUDED.country, l.country),
    region        = COALESCE(EXCLUDED.region, l.region),
    city          = COALESCE(EXCLUDED.city, l.city),
    lat           = COALESCE(EXCLUDED.lat, l.lat),
    lng           = COALESCE(EXCLUDED.lng, l.lng);
$$;
REVOKE ALL ON FUNCTION public.log_device_ping(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;

-- Recherche admin : email / IP / ville / pays, avec l'email joint (auth.users).
CREATE OR REPLACE FUNCTION public.admin_device_rows(
  p_q TEXT DEFAULT NULL,
  p_limit INT DEFAULT 120
) RETURNS TABLE (
  user_id UUID, email TEXT, role TEXT, ip TEXT, ua TEXT, platform TEXT,
  is_standalone BOOLEAN, country TEXT, region TEXT, city TEXT,
  lat DOUBLE PRECISION, lng DOUBLE PRECISION,
  first_seen_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ, hits INT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT l.user_id, u.email::text, l.role, l.ip, l.ua, l.platform,
         l.is_standalone, l.country, l.region, l.city, l.lat, l.lng,
         l.first_seen_at, l.last_seen_at, l.hits
  FROM public.user_device_log l
  JOIN auth.users u ON u.id = l.user_id
  WHERE p_q IS NULL OR p_q = ''
     OR u.email ILIKE '%' || p_q || '%'
     OR l.ip ILIKE p_q || '%'
     OR l.city ILIKE '%' || p_q || '%'
     OR l.country ILIKE p_q || '%'
  ORDER BY l.last_seen_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;
REVOKE ALL ON FUNCTION public.admin_device_rows(TEXT, INT) FROM PUBLIC, anon, authenticated;

-- Anti-fraude : IP utilisées par PLUSIEURS comptes (multi-comptes probables).
CREATE OR REPLACE FUNCTION public.admin_shared_ips(p_limit INT DEFAULT 50)
RETURNS TABLE (
  ip TEXT, user_count BIGINT, emails TEXT[], roles TEXT[],
  city TEXT, country TEXT, last_seen_at TIMESTAMPTZ
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT l.ip,
         count(DISTINCT l.user_id) AS user_count,
         array_agg(DISTINCT u.email::text) AS emails,
         array_agg(DISTINCT l.role) AS roles,
         max(l.city) AS city,
         max(l.country) AS country,
         max(l.last_seen_at) AS last_seen_at
  FROM public.user_device_log l
  JOIN auth.users u ON u.id = l.user_id
  GROUP BY l.ip
  HAVING count(DISTINCT l.user_id) > 1
  ORDER BY user_count DESC, last_seen_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$$;
REVOKE ALL ON FUNCTION public.admin_shared_ips(INT) FROM PUBLIC, anon, authenticated;
