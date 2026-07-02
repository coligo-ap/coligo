-- =============================================================================
-- 0318 — Suite de l'audit anon (0317) : dernière policy fragile.
-- `platform_admins_write_owner` (cmd ALL → s'applique aussi au SELECT)
-- référence admin_is_owner(), non exécutable par `anon` → toute requête
-- anonyme touchant platform_admins échouerait en 401 au lieu d'être
-- simplement filtrée. Aucun flux anonyme connu ne lit cette table, mais on
-- ferme la classe de bug entièrement (même piège que 0272/0317).
-- SÛR : auth.uid() NULL → admin_is_owner() = false, aucun droit accordé.
-- =============================================================================

GRANT EXECUTE ON FUNCTION public.admin_is_owner() TO anon;
