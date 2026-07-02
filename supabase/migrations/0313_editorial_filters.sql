-- =============================================================================
-- 0313 — PHASE 3 catégories : FILTRES ÉDITORIAUX (« Burger », « Pizza »…).
-- Réutilise l'infra des phases 1-2 : un filtre éditorial = une ligne de
-- merchant_categories avec kind='filter' (JAMAIS proposée à l'inscription,
-- visible dans le strip marketplace dès qu'elle a des commerçants liés).
-- Mapping manuel (admin) ET automatique par MOTS-CLÉS sur les produits/tags :
--   merchant_category_links.source = 'primary' (trigger catégorie principale)
--                                  | 'manual'  (commerçant ou admin)
--                                  | 'auto'    (recalcul par mots-clés).
-- Le recalcul auto ne touche QUE les liaisons 'auto' (jamais manuel/primary).
-- =============================================================================

ALTER TABLE public.merchant_categories
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'type'
    CHECK (kind IN ('type', 'filter')),
  ADD COLUMN IF NOT EXISTS keywords TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.merchant_category_links
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('primary', 'manual', 'auto'));

-- Le trigger de catégorie principale marque désormais sa provenance.
CREATE OR REPLACE FUNCTION public.sync_primary_category_link()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.category IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.merchant_categories WHERE code = NEW.category)
  THEN
    INSERT INTO public.merchant_category_links (merchant_id, code, source)
    VALUES (NEW.id, NEW.category, 'primary')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- Backfill de provenance : les liaisons issues du backfill 0312 qui
-- correspondent à la catégorie principale passent en 'primary'.
UPDATE public.merchant_category_links l
SET source = 'primary'
FROM public.merchants m
WHERE m.id = l.merchant_id AND m.category = l.code;
