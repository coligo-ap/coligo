-- =============================================================================
-- 0429 — Annuaire commerçants (super-admin) : PAGINÉ et CHERCHABLE.
--
-- `admin_merchants_directory()` renvoyait TOUS les commerçants, avec pour
-- chaque ligne une somme sur `wallet_entries`. À 31 commerçants c'est déjà
-- inutile ; à 500 c'est une page qui rame et une base qu'on sollicite pour
-- rien, alors que l'écran n'en montre que quelques-uns.
--
-- La fonction accepte désormais une recherche, une limite et un décalage, et
-- renvoie le TOTAL en même temps (`total_count`) — sans quoi l'interface ne
-- pourrait pas dire « 3 sur 31 » ni savoir s'il reste des pages.
--
-- Le tri ne change pas : les demandes EN ATTENTE d'abord (c'est le travail à
-- faire), puis par ancienneté.
--
-- ⚠️ La garde de domaine est conservée à l'identique : `admin_can('commercants')`.
-- =============================================================================

DROP FUNCTION IF EXISTS public.admin_merchants_directory();

CREATE FUNCTION public.admin_merchants_directory(
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 3,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, name text, slug text, city text, category text, phone text,
  email text, is_active boolean, is_frozen boolean, approval_status text,
  submitted_at timestamp with time zone, rejected_reason text,
  commission_cash numeric, commission_online numeric,
  cashback_online numeric, cashback_cash numeric, balance_da bigint,
  logo_url text, cover_url text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 3), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
BEGIN
  IF NOT public.admin_can('commercants') THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs du domaine Commerçants.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH filtre AS (
    SELECT m.*
    FROM public.merchants m
    LEFT JOIN auth.users u2 ON u2.id = m.user_id
    WHERE v_q IS NULL
       OR m.name ILIKE '%' || v_q || '%'
       OR coalesce(m.slug, '') ILIKE '%' || v_q || '%'
       OR coalesce(m.city, '') ILIKE '%' || v_q || '%'
       OR coalesce(m.phone_public, '') ILIKE '%' || v_q || '%'
       OR coalesce(u2.email::text, '') ILIKE '%' || v_q || '%'
  ),
  total AS (SELECT count(*)::bigint AS n FROM filtre),
  page AS (
    SELECT f.*
    FROM filtre f
    ORDER BY
      CASE WHEN f.approval_status = 'pending' THEN 0 ELSE 1 END,
      f.created_at ASC
    LIMIT v_limit OFFSET v_offset
  )
  SELECT
    p.id, p.name, p.slug, p.city, p.category,
    p.phone_public AS phone,
    u.email::text  AS email,
    p.is_active, p.is_frozen, p.approval_status, p.submitted_at,
    p.rejected_reason,
    p.commission_cash, p.commission_online,
    p.cashback_online, p.cashback_cash,
    -- La somme du portefeuille ne porte QUE sur la page affichée.
    COALESCE((SELECT SUM(w.amount_da)
                FROM public.wallet_entries w
               WHERE w.merchant_id = p.id), 0)::bigint AS balance_da,
    p.logo_url, p.cover_url,
    (SELECT n FROM total) AS total_count
  FROM page p
  LEFT JOIN auth.users u ON u.id = p.user_id
  ORDER BY
    CASE WHEN p.approval_status = 'pending' THEN 0 ELSE 1 END,
    p.created_at ASC;
END;
$function$;

-- Appelée depuis une SESSION super-admin (jamais en service_role) : la garde
-- de domaine ci-dessus n'a de sens que si le JWT de l'appelant est celui de
-- l'administrateur.
REVOKE ALL ON FUNCTION public.admin_merchants_directory(text, integer, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_merchants_directory(text, integer, integer)
  TO authenticated, service_role;
