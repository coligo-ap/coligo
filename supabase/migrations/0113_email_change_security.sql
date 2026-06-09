-- =============================================================================
-- 0113 — Sécurité du changement d'email client (anti-fraude / anti-bruteforce)
-- =============================================================================
-- 1. Throttle des tentatives de validation du code : 3 essais échoués → blocage
--    10 min ; blocage suivant → 20 min (escalade). Évite le brute-force du code.
-- 2. `email_already_used()` : interdit de basculer vers un email DÉJÀ associé à
--    un autre compte (auth.users), quelle que soit la méthode d'inscription
--    (email/mot de passe OU Google).
-- NB : la longueur du code OTP est fixée par Supabase (min 6) — on aligne juste
--    le champ client sur la vraie longueur (6 ou 8). 4 chiffres impossible côté
--    Supabase Auth.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.email_change_throttle (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  fails        INTEGER NOT NULL DEFAULT 0,
  lock_level   INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- RLS activée SANS policy → table accessible UNIQUEMENT via service-role
-- (les Server Actions « admin »). Aucun accès direct client.
ALTER TABLE public.email_change_throttle ENABLE ROW LEVEL SECURITY;

-- Email déjà utilisé par un AUTRE compte ? (SECURITY DEFINER → lit auth.users)
CREATE OR REPLACE FUNCTION public.email_already_used(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE lower(email) = lower(btrim(p_email))
      AND id <> auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.email_already_used(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.email_already_used(text) TO authenticated;

-- =============================================================================
-- VÉRIF : SELECT public.email_already_used('test@x.com');
-- =============================================================================
