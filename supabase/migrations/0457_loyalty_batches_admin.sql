-- =============================================================================
-- 0457 — FIDÉLITÉ Phase 4 : journal des lots pour la console super-admin
-- =============================================================================
-- La console (/admin/merchants/fidelite) liste les lots avec leurs compteurs
-- d'état SANS rapatrier les cartes (un lot peut en compter 1000) : agrégation
-- côté SQL, garde admin_can('commercants'), qui/quand/combien/pour qui (spec
-- 4.0 « journal des lots »).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_loyalty_batches(p_limit integer DEFAULT 20)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  merchant_id uuid,
  merchant_name text,
  template_key text,
  quantity integer,
  note text,
  created_by_email text,
  printed integer,
  activated integer,
  linked integer,
  blocked integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.admin_can('commercants') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT
    b.id,
    b.created_at,
    b.merchant_id,
    m.name,
    b.template_key,
    b.quantity,
    b.note,
    (SELECT u.email::text FROM auth.users u WHERE u.id = b.created_by),
    COALESCE(count(*) FILTER (WHERE c.status = 'printed'), 0)::int,
    COALESCE(count(*) FILTER (WHERE c.status = 'activated'), 0)::int,
    COALESCE(count(*) FILTER (WHERE c.status = 'linked'), 0)::int,
    COALESCE(count(*) FILTER (WHERE c.status = 'blocked'), 0)::int
  FROM public.loyalty_card_batches b
  JOIN public.merchants m ON m.id = b.merchant_id
  LEFT JOIN public.loyalty_cards c ON c.batch_id = b.id
  GROUP BY b.id, m.name
  ORDER BY b.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_loyalty_batches(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_batches(integer) TO authenticated;
