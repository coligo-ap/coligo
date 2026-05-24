-- =============================================================================
-- 0031 — Swap super-admin email : primefood69 → coligo.noreply
-- =============================================================================
-- La table `platform_admins` whitelist les emails ayant accès à /admin.
-- On retire l'ancien email perso et on ajoute le nouvel email applicatif.
-- Le second admin `gacinoufel@gmail.com` reste inchangé (filet de sécurité).
--
-- NB : ne crée PAS le compte auth.users associé. Pour pouvoir se connecter,
-- créer l'utilisateur `coligo.noreply@gmail.com` via :
--   1) Supabase Dashboard → Authentication → Users → Add user, OU
--   2) signup via /login (puis vérifier l'email).
-- =============================================================================

DELETE FROM public.platform_admins
WHERE email = 'primefood69@gmail.com';

INSERT INTO public.platform_admins (email)
VALUES ('coligo.noreply@gmail.com')
ON CONFLICT DO NOTHING;
