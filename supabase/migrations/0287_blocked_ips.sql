-- =============================================================================
-- 0287 — Blocage d'IP + déconnexion forcée de sessions (anti-fraude/abus)
-- =============================================================================
-- CONTEXTE : l'alerte « IP partagées » (mig 0284) pointe vers /admin/devices.
-- Le super-admin doit pouvoir RÉAGIR : couper les sessions actives d'un appareil
-- et/ou bloquer une IP (avec ou sans message affiché à l'utilisateur bloqué).
--
-- Cette migration livre, de façon bypass-proof et tracée :
--   • Table `blocked_ips` (RLS super-admin) — liste des IP bannies + message.
--   • `is_ip_blocked(ip)` / `blocked_ip_message(ip)` — lecture (anon) pour
--     l'enforcement middleware + la page « accès bloqué ». N'exposent qu'un
--     booléen / le message d'UNE ip donnée (pas la liste complète).
--   • `admin_block_ip(ip, message)` / `admin_unblock_ip(ip)` — gestion (admin).
--   • `admin_disconnect_ip(ip)` / `admin_disconnect_user(user_id)` — suppriment
--     les sessions GoTrue (auth.sessions) → l'utilisateur est déconnecté au
--     prochain rafraîchissement. SECURITY DEFINER (accès au schéma auth), gardés
--     is_super_admin.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.blocked_ips (
  ip         TEXT PRIMARY KEY,
  reason     TEXT,
  message    TEXT,                       -- affiché à l'utilisateur (optionnel)
  blocked_by TEXT,                       -- email admin
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.blocked_ips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS blocked_ips_admin_all ON public.blocked_ips;
CREATE POLICY blocked_ips_admin_all ON public.blocked_ips
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- Lecture pour l'enforcement (middleware en rôle anon) — par IP seulement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_ip_blocked(p_ip text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_ip IS NOT NULL
     AND p_ip <> ''
     AND EXISTS (SELECT 1 FROM public.blocked_ips WHERE ip = p_ip);
$$;

CREATE OR REPLACE FUNCTION public.blocked_ip_message(p_ip text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT message FROM public.blocked_ips WHERE ip = p_ip;
$$;

REVOKE ALL ON FUNCTION public.is_ip_blocked(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.blocked_ip_message(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_ip_blocked(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.blocked_ip_message(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Gestion (super-admin)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_block_ip(p_ip text, p_message text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF p_ip IS NULL OR btrim(p_ip) = '' THEN
    RAISE EXCEPTION 'ip vide';
  END IF;
  INSERT INTO public.blocked_ips (ip, message, blocked_by)
  VALUES (btrim(p_ip), NULLIF(btrim(COALESCE(p_message, '')), ''),
          (auth.jwt() ->> 'email'))
  ON CONFLICT (ip) DO UPDATE
    SET message    = EXCLUDED.message,
        blocked_by = EXCLUDED.blocked_by,
        created_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_unblock_ip(p_ip text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  DELETE FROM public.blocked_ips WHERE ip = btrim(p_ip);
END;
$$;

-- Déconnexion : supprime les sessions GoTrue (le refresh token tombe en
-- cascade → plus de rafraîchissement possible).
CREATE OR REPLACE FUNCTION public.admin_disconnect_ip(p_ip text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  WITH del AS (
    DELETE FROM auth.sessions s
     WHERE s.user_id IN (
       SELECT DISTINCT user_id FROM public.user_device_log WHERE ip = btrim(p_ip)
     )
    RETURNING 1
  )
  SELECT count(*)::int INTO v_n FROM del;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_disconnect_user(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  WITH del AS (
    DELETE FROM auth.sessions s WHERE s.user_id = p_user_id RETURNING 1
  )
  SELECT count(*)::int INTO v_n FROM del;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_block_ip(text, text)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_unblock_ip(text)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_disconnect_ip(text)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_disconnect_user(uuid)     FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_block_ip(text, text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unblock_ip(text)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_disconnect_ip(text)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_disconnect_user(uuid)  TO authenticated;
