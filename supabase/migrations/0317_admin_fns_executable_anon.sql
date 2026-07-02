-- =============================================================================
-- 0317 — FIX marketplace ANONYME : « permission denied for function admin_can ».
-- L'overlay RLS du RBAC super-admin (mig 0302) référence admin_can() /
-- current_admin() dans des policies de tables PUBLIQUES (ex. products) ; ces
-- fonctions n'étaient exécutables que par `authenticated` → TOUTE lecture
-- anonyme de ces tables échouait en 401 (produits/catalogue invisibles sans
-- connexion). Même famille de piège que la mig 0272 (EXECUTE requis pour que
-- la policy s'évalue).
--
-- SÛR : pour un anonyme, auth.uid() est NULL → admin_can() renvoie false et
-- current_admin() une ligne vide — aucun privilège accordé, la policy
-- s'évalue simplement au lieu de tout faire échouer.
-- =============================================================================

GRANT EXECUTE ON FUNCTION public.admin_can(text) TO anon;
GRANT EXECUTE ON FUNCTION public.current_admin() TO anon;
