-- =============================================================================
-- 0322 — RPC recherche produit : + unit / min_qty / max_qty / has_options
-- =============================================================================
-- L'ajout rapide (« + ») depuis les résultats de recherche doit appliquer les
-- mêmes gardes que la vitrine : produit à OPTIONS ou vendu au POIDS/VOLUME
-- (kg, L, m) → pas d'ajout aveugle, on ouvre la fiche du commerce ; produit
-- simple → départ à la quantité minimale imposée. La RPC 0082 ne renvoyait ni
-- l'unité ni les bornes ni la présence d'options → on étend son retour.
--
-- Correctif au passage : SECURITY DEFINER bypasse la RLS publique → les
-- produits ARCHIVÉS (archived_at, mig 0263) ressortaient en « épuisé » dans la
-- recherche. On les exclut désormais explicitement.
--
-- Changement de type de retour ⇒ DROP + CREATE (OR REPLACE impossible), et le
-- DROP fait sauter les GRANT ⇒ re-GRANT anon + authenticated (piège connu).
-- =============================================================================

DROP FUNCTION IF EXISTS public.search_products_in_zone(text, text, text, int);

CREATE FUNCTION public.search_products_in_zone(
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
  unit         text,
  min_qty      numeric,
  max_qty      numeric,
  has_options  boolean,
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
    p.unit,
    p.min_qty,
    p.max_qty,
    EXISTS (
      SELECT 1
      FROM public.product_option_groups g
      JOIN public.product_options o ON o.group_id = g.id AND o.is_available
      WHERE g.product_id = p.id
    ) AS has_options,
    greatest(
      similarity(public.f_unaccent(lower(p.name_fr)), (SELECT q FROM nq)),
      similarity(public.f_unaccent(lower(coalesce(p.name_ar, ''))), (SELECT q FROM nq))
    ) AS sim
  FROM public.products p
  JOIN public.merchants m ON m.id = p.merchant_id
  CROSS JOIN nq
  WHERE m.is_active = true
    AND p.archived_at IS NULL
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
