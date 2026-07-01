-- =============================================================================
-- 0301 — RBAC super-admin par DOMAINE (owner + staff scopés)
-- =============================================================================
-- Jusqu'ici l'accès /admin était BINAIRE : un email présent dans
-- `platform_admins` était super-admin TOTAL via `is_super_admin()` (câblée dans
-- ~117 endroits : RLS, gardes RPC, layout, middleware, server actions).
--
-- On introduit un modèle à deux niveaux :
--   • OWNER  : pouvoir total + SEUL habilité à gérer les autres admins.
--   • STAFF  : accès restreint à 1..N DOMAINES parmi les 8 clés fonctionnelles
--              (les mêmes que le moteur d'alertes / ADMIN_DOMAINS).
--
-- Compatibilité : `platform_admins.email` reste la PK. `is_super_admin()` GARDE
-- sa signature et reste « est un admin actif (owner OU staff) » → aucune des
-- policies/gardes existantes ne casse. Le cloisonnement fin se fait via les
-- nouvelles fonctions `admin_can()` / `admin_is_owner()` (mig 0302/0303 pour la
-- RLS + les gardes RPC, et les gates serveur côté Next).
--
-- Les 2 emails déjà présents deviennent role='owner' (défaut) → zéro régression.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Colonnes RBAC sur platform_admins
-- -----------------------------------------------------------------------------
ALTER TABLE public.platform_admins
  ADD COLUMN IF NOT EXISTS role       text        NOT NULL DEFAULT 'owner'
    CHECK (role IN ('owner', 'staff')),
  ADD COLUMN IF NOT EXISTS domains    text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_active  boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS label      text,
  ADD COLUMN IF NOT EXISTS created_by text,
  -- user_id auth : renseigné à la création d'un staff (via service-role) ;
  -- backfillé pour les owners existants. Sert au reset mot de passe / révocation.
  ADD COLUMN IF NOT EXISTS user_id    uuid;
-- (created_at existe déjà depuis mig 0010.)

-- Backfill de l'id auth pour les admins déjà présents (jointure par email).
UPDATE public.platform_admins pa
   SET user_id = u.id
  FROM auth.users u
 WHERE lower(u.email) = lower(pa.email)
   AND pa.user_id IS NULL;

-- Contrainte : chaque domaine attribué DOIT appartenir à la liste des 8 clés
-- stables. `<@` (array contenu dans) est IMMUTABLE → utilisable en CHECK.
ALTER TABLE public.platform_admins
  DROP CONSTRAINT IF EXISTS platform_admins_domains_valid;
ALTER TABLE public.platform_admins
  ADD CONSTRAINT platform_admins_domains_valid CHECK (
    domains <@ ARRAY[
      'pilotage','commercants','livraison','drive',
      'finances','confiance','plateforme','marketing'
    ]::text[]
  );

-- Les owners existants n'ont pas besoin de domaines (bypass total).
UPDATE public.platform_admins
   SET role = 'owner'
 WHERE role IS NULL;

-- -----------------------------------------------------------------------------
-- 2. Fonctions d'autorisation (SECURITY DEFINER, search_path figé)
-- -----------------------------------------------------------------------------

-- is_super_admin() : REDÉFINIE = « est un admin ACTIF (owner ou staff) ».
-- Signature inchangée → tous les sites existants continuent de fonctionner.
-- Ajoute uniquement le filtre is_active (un admin suspendu perd tout accès).
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
     WHERE email = (auth.jwt() ->> 'email')
       AND is_active
  );
$$;

-- admin_is_owner() : true UNIQUEMENT pour un owner actif. Garde la gestion des
-- admins (création/attribution) et tout ce qui est intrinsèquement transversal.
CREATE OR REPLACE FUNCTION public.admin_is_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
     WHERE email = (auth.jwt() ->> 'email')
       AND is_active
       AND role = 'owner'
  );
$$;

-- admin_can(domain) : cœur du RBAC. owner ⇒ true ; staff ⇒ domaine dans sa
-- liste. Fail-closed (email absent / suspendu / domaine hors liste ⇒ false).
CREATE OR REPLACE FUNCTION public.admin_can(p_domain text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
     WHERE email = (auth.jwt() ->> 'email')
       AND is_active
       AND (role = 'owner' OR p_domain = ANY(domains))
  );
$$;

-- current_admin() : contexte de la session courante en 1 aller-retour (consommé
-- par le layout /admin + les gates serveur, mémoïsé côté Next via React cache).
CREATE OR REPLACE FUNCTION public.current_admin()
RETURNS TABLE (
  is_admin  boolean,
  is_owner  boolean,
  is_active boolean,
  domains   text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (pa.email IS NOT NULL)                              AS is_admin,
    COALESCE(pa.role = 'owner', false)                  AS is_owner,
    COALESCE(pa.is_active, false)                       AS is_active,
    COALESCE(
      CASE WHEN pa.role = 'owner' THEN ARRAY[
        'pilotage','commercants','livraison','drive',
        'finances','confiance','plateforme','marketing'
      ]::text[] ELSE pa.domains END,
      '{}'::text[]
    )                                                   AS domains
  FROM (SELECT (auth.jwt() ->> 'email') AS jwt_email) j
  LEFT JOIN public.platform_admins pa
    ON pa.email = j.jwt_email AND pa.is_active;
$$;

-- -----------------------------------------------------------------------------
-- 3. Garde-fou : ne JAMAIS supprimer/rétrograder le DERNIER owner actif.
-- -----------------------------------------------------------------------------
-- Un back-office sans owner serait ingérable (personne ne peut plus créer
-- d'admins). Le trigger bloque DELETE ou passage owner→staff / désactivation du
-- dernier owner restant. (Vérifié aussi côté serveur, mais la base fait foi.)
CREATE OR REPLACE FUNCTION public.assert_last_owner_kept()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  remaining int;
BEGIN
  -- On ne s'intéresse qu'aux cas qui RETIRENT un owner actif.
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'owner' AND OLD.is_active THEN
      SELECT count(*) INTO remaining
        FROM public.platform_admins
       WHERE role = 'owner' AND is_active AND email <> OLD.email;
      IF remaining = 0 THEN
        RAISE EXCEPTION 'Impossible de supprimer le dernier owner actif.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE : owner actif qui devient staff OU inactif.
  IF OLD.role = 'owner' AND OLD.is_active
     AND (NEW.role <> 'owner' OR NEW.is_active = false) THEN
    SELECT count(*) INTO remaining
      FROM public.platform_admins
     WHERE role = 'owner' AND is_active AND email <> OLD.email;
    IF remaining = 0 THEN
      RAISE EXCEPTION 'Impossible de retirer le dernier owner actif.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assert_last_owner ON public.platform_admins;
CREATE TRIGGER trg_assert_last_owner
  BEFORE UPDATE OR DELETE ON public.platform_admins
  FOR EACH ROW EXECUTE FUNCTION public.assert_last_owner_kept();

-- -----------------------------------------------------------------------------
-- 4. RLS : la gestion des admins (écriture) est OWNER-ONLY. La lecture reste
--    réservée aux admins (déjà en place : platform_admins_select_admin).
--    Les écritures applicatives passent de toute façon par le service_role
--    (createAdminClient) — mais on verrouille aussi la RLS par prudence.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "platform_admins_write_owner" ON public.platform_admins;
CREATE POLICY "platform_admins_write_owner" ON public.platform_admins
  FOR ALL USING (public.admin_is_owner())
  WITH CHECK (public.admin_is_owner());

-- -----------------------------------------------------------------------------
-- 5. GRANTS : appelables par la session admin (authenticated), garde interne.
--    (cf. piège mig 0272 : REVOKE authenticated rendrait la fonction
--     inappelable par la session admin qui est 'authenticated'.)
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.admin_is_owner()          FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_can(text)           FROM public, anon;
REVOKE ALL ON FUNCTION public.current_admin()           FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_is_owner()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_can(text)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_admin()        TO authenticated;
