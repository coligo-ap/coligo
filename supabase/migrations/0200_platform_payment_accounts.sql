-- =============================================================================
-- 0200 — Comptes de versement de la plateforme PAR MODULE (CCP + banque)
-- =============================================================================
-- Chaque service/domaine (livreur / chauffeur / commerçant / agent Coligo Pay)
-- peut avoir SES propres coordonnées de versement : l'opérateur, lors d'une
-- recharge par virement, voit le CCP et/ou le compte bancaire de SON module.
-- Édité côté super-admin (central /admin/recharges + dans chaque page module).
--
-- Lecture par l'opérateur via operator_topup_config() (SECURITY DEFINER, résout
-- son owner_type) ; la table reste fermée en RLS (pas d'accès direct client).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.platform_payment_accounts (
  scope       TEXT PRIMARY KEY
                CHECK (scope IN ('driver','chauffeur','merchant','partner')),
  ccp_number  TEXT NOT NULL DEFAULT '',
  ccp_key     TEXT NOT NULL DEFAULT '',
  ccp_holder  TEXT NOT NULL DEFAULT 'Coligo SPA',
  bank_name   TEXT NOT NULL DEFAULT '',
  bank_rib    TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID
);

ALTER TABLE public.platform_payment_accounts ENABLE ROW LEVEL SECURITY;

-- Super-admin : lecture + écriture. Personne d'autre en direct (l'opérateur
-- lit via la RPC SECURITY DEFINER ci-dessous).
DROP POLICY IF EXISTS ppa_admin_all ON public.platform_payment_accounts;
CREATE POLICY ppa_admin_all ON public.platform_payment_accounts
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- Amorçage : une ligne par module, pré-remplie avec le CCP plateforme existant
-- (celui des abonnements Drive) pour ne rien casser ni laisser vide.
INSERT INTO public.platform_payment_accounts (scope, ccp_number, ccp_key, ccp_holder)
SELECT m.scope, COALESCE(s.drive_ccp_number,''), COALESCE(s.drive_ccp_key,''),
       COALESCE(s.drive_ccp_name,'Coligo SPA')
FROM (VALUES ('driver'),('chauffeur'),('merchant'),('partner')) AS m(scope)
CROSS JOIN public.platform_settings s
WHERE s.id
ON CONFLICT (scope) DO NOTHING;

-- ---------------------------------------------------------------------------
-- operator_topup_config() : config de recharge POUR L'UTILISATEUR CONNECTÉ.
-- Renvoie désormais le CCP + le compte bancaire de SON module (owner_type),
-- en plus des montants suggérés et du plafond.
-- DROP requis : la signature de retour change (colonnes banque ajoutées).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.operator_topup_config();
CREATE OR REPLACE FUNCTION public.operator_topup_config()
RETURNS TABLE (
  ccp_number TEXT,
  ccp_key    TEXT,
  ccp_name   TEXT,
  bank_name  TEXT,
  bank_rib   TEXT,
  presets_da INTEGER[],
  max_da     INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    COALESCE(a.ccp_number, s.drive_ccp_number),
    COALESCE(a.ccp_key, s.drive_ccp_key),
    COALESCE(a.ccp_holder, s.drive_ccp_name),
    COALESCE(a.bank_name, ''),
    COALESCE(a.bank_rib, ''),
    COALESCE(s.operator_topup_presets_da, '{500,1000,2000,5000}'),
    COALESCE(s.operator_topup_max_da, 100000)
  FROM public.platform_settings s
  LEFT JOIN public.operator_wallets w ON w.id = public.my_operator_wallet()
  LEFT JOIN public.platform_payment_accounts a ON a.scope = w.owner_type
  WHERE s.id;
$$;
GRANT EXECUTE ON FUNCTION public.operator_topup_config() TO authenticated;
