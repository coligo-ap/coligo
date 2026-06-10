-- =============================================================================
-- 0123 — Annuaire commerçants super-admin (recherche tél / email / identifiant)
-- =============================================================================
-- La page /admin/merchants doit pouvoir CHERCHER un commerçant par téléphone,
-- e-mail (compte de connexion = auth.users.email) ou identifiant (id/slug), et
-- afficher d'emblée ces infos. L'e-mail vit dans `auth.users` (non exposé via
-- PostgREST) → on passe par une RPC SECURITY DEFINER gardée par is_super_admin.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_merchants_directory()
RETURNS TABLE (
  id                uuid,
  name              text,
  slug              text,
  city              text,
  category          text,
  phone             text,
  email             text,
  is_active         boolean,
  is_frozen         boolean,
  commission_cash   numeric,
  commission_online numeric,
  cashback_online   numeric,
  cashback_cash     numeric,
  balance_da        bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Accès réservé aux super-administrateurs.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.name,
    m.slug,
    m.city,
    m.category,
    m.phone_public                                   AS phone,
    u.email::text                                    AS email,
    m.is_active,
    m.is_frozen,
    m.commission_cash,
    m.commission_online,
    m.cashback_online,
    m.cashback_cash,
    COALESCE((SELECT SUM(w.amount_da)
                FROM public.wallet_entries w
               WHERE w.merchant_id = m.id), 0)::bigint AS balance_da
  FROM public.merchants m
  LEFT JOIN auth.users u ON u.id = m.user_id
  ORDER BY m.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_merchants_directory() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_merchants_directory() TO authenticated;
