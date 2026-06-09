-- =============================================================================
-- 0109 — Kill-switch : déconnexion FORCÉE des sessions d'un livreur
-- =============================================================================
-- Au BLOCAGE d'un livreur, on veut couper sa session ACTIVE immédiatement (pas
-- seulement au prochain rendu). On révoque ses sessions GoTrue : suppression de
-- `auth.sessions` (+ `auth.refresh_tokens`) pour son `user_id`. Dès la requête
-- suivante, `auth.getUser()` (appelé par le middleware) échoue → l'utilisateur
-- est considéré déconnecté → renvoyé vers /driver/login (puis écran « bloqué »).
--
-- SECURITY DEFINER (propriétaire = rôle de migration, accès au schéma auth) +
-- garde `is_super_admin()`. Réservé au super-admin.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_force_driver_signout(p_driver_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
DECLARE
  v_user uuid;
  v_count integer := 0;
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT user_id INTO v_user FROM public.drivers WHERE id = p_driver_id;
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_user');
  END IF;

  -- Révoque les refresh tokens puis les sessions (ordre FK-safe).
  DELETE FROM auth.refresh_tokens WHERE user_id = v_user::text;
  DELETE FROM auth.sessions WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'sessions_killed', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_force_driver_signout(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_force_driver_signout(uuid) TO authenticated;

-- =============================================================================
-- VÉRIF : SELECT public.admin_force_driver_signout('00000000-...');  -- forbidden
-- =============================================================================
