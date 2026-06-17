-- =============================================================================
-- 0199 — Config recharge portefeuille opérateur (maquette « Mon portefeuille »)
-- =============================================================================
-- La page de recharge (livreur / chauffeur / commerçant / partenaire) affiche :
--   • les montants suggérés (chips) — désormais EN CONFIG ADMIN, jamais en dur ;
--   • le CCP de la plateforme pour le virement — RÉUTILISE le CCP déjà configuré
--     pour les abonnements Drive (platform_settings.drive_ccp_*), source unique ;
--   • le type d'opérateur (badge + texte de contexte dynamiques) — exposé par
--     my_operator_wallet_state().
-- Tout reste en lecture seule côté opérateur ; aucun crédit libre.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Montants suggérés configurables (chips de recharge)
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS operator_topup_presets_da INTEGER[] NOT NULL
    DEFAULT '{500,1000,2000,5000}';

-- ---------------------------------------------------------------------------
-- 2. Config publique (authenticated) : CCP plateforme + presets + plafond
--    Lecture seule, aucune donnée sensible. Le CCP est celui du compte
--    plateforme déjà saisi pour Drive (drive_ccp_number/key/name).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operator_topup_config()
RETURNS TABLE (
  ccp_number   TEXT,
  ccp_key      TEXT,
  ccp_name     TEXT,
  presets_da   INTEGER[],
  max_da       INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.drive_ccp_number,
         s.drive_ccp_key,
         s.drive_ccp_name,
         COALESCE(s.operator_topup_presets_da, '{500,1000,2000,5000}'),
         COALESCE(s.operator_topup_max_da, 100000)
  FROM public.platform_settings s
  WHERE s.id;
$$;
GRANT EXECUTE ON FUNCTION public.operator_topup_config() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. État du portefeuille : ajout du type d'opérateur (badge + contexte)
--    (réécriture de la fonction de 0193 avec une colonne owner_type en plus)
--    DROP requis : on modifie la signature de retour (ajout d'une colonne).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.my_operator_wallet_state();
CREATE OR REPLACE FUNCTION public.my_operator_wallet_state()
RETURNS TABLE (
  wallet_id UUID,
  owner_type TEXT,
  status TEXT,
  balance_da INTEGER,
  debt_da INTEGER,
  effective_balance_da INTEGER,
  neg_threshold_da INTEGER,
  can_operate BOOLEAN,
  is_partner BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT w.id, w.owner_type, w.status,
         public.operator_balance(w.id),
         public.operator_role_debt(w.id),
         public.operator_effective_balance(w.id),
         public.operator_neg_threshold(w.id),
         public.operator_can_operate(w.id),
         w.is_partner
  FROM public.operator_wallets w
  WHERE w.id = public.my_operator_wallet();
$$;
GRANT EXECUTE ON FUNCTION public.my_operator_wallet_state() TO authenticated;
