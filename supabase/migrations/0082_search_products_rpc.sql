-- =============================================================================
-- 0082 — RPC de recherche produit (trigram + unaccent)
-- =============================================================================
-- Cherche les PRODUITS dont le titre (FR/AR) matche la requête, tolérant aux
-- fautes/accents ("pates" → "Pâtes"), restreint à la zone du client. Le
-- regroupement par commerçant, le filtre dur (fermé/hors-zone) et le classement
-- final sont faits côté app (TS) à partir de ces lignes + de merchants_public.
--
-- SECURITY DEFINER + search_path figé : la fonction lit products/merchants
-- (RLS bypass contrôlé : elle ne renvoie que des champs publics de produits de
-- commerces actifs). GRANT à anon + authenticated.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.search_products_in_zone(
  p_q       text,
  p_wilaya  text DEFAULT NULL,
  p_commune text DEFAULT NULL,
  p_limit   int  DEFAULT 200
)
RETURNS TABLE (
  merchant_id  uuid,
  id           uuid,
  name_fr      text,
  name_ar      text,
  price_da     int,
  image_url    text,
  is_available boolean,
  stock_qty    int,
  sim          real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH nq AS (
    SELECT public.f_unaccent(lower(btrim(coalesce(p_q, '')))) AS q
  )
  SELECT
    p.merchant_id,
    p.id,
    p.name_fr,
    p.name_ar,
    p.price_da,
    p.image_url,
    p.is_available,
    p.stock_qty,
    greatest(
      similarity(public.f_unaccent(lower(p.name_fr)), (SELECT q FROM nq)),
      similarity(public.f_unaccent(lower(coalesce(p.name_ar, ''))), (SELECT q FROM nq))
    ) AS sim
  FROM public.products p
  JOIN public.merchants m ON m.id = p.merchant_id
  CROSS JOIN nq
  WHERE m.is_active = true
    AND length(nq.q) > 0
    AND (p_wilaya IS NULL OR m.wilaya_code = p_wilaya)
    AND (p_commune IS NULL OR lower(m.commune) = lower(p_commune))
    AND (
      public.f_unaccent(lower(p.name_fr)) ILIKE '%' || nq.q || '%'
      OR public.f_unaccent(lower(coalesce(p.name_ar, ''))) ILIKE '%' || nq.q || '%'
      OR public.f_unaccent(lower(p.name_fr)) % nq.q
    )
  ORDER BY sim DESC, p.price_da ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_products_in_zone(text, text, text, int)
  TO anon, authenticated;
