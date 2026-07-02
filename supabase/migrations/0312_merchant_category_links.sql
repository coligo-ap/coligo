-- =============================================================================
-- 0312 — PHASE 2 catégories : MULTI-CATÉGORIES par commerçant.
-- Un restaurant peut être « pizza + tacos + burger », une supérette avoir une
-- boulangerie intégrée… Table de liaison merchant ↔ catégorie ; la colonne
-- merchants.category reste la catégorie PRINCIPALE (compat totale) et est
-- automatiquement présente dans les liaisons (backfill + trigger).
-- Le filtre marketplace matche désormais les LIAISONS.
-- RLS : lecture publique (filtrage anon) ; le commerçant ne gère que SES
-- propres liaisons, et uniquement vers des catégories existantes.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.merchant_category_links (
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  code        TEXT NOT NULL REFERENCES public.merchant_categories(code) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_id, code)
);

CREATE INDEX IF NOT EXISTS merchant_category_links_code_idx
  ON public.merchant_category_links (code);

ALTER TABLE public.merchant_category_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mcl_read ON public.merchant_category_links;
CREATE POLICY mcl_read ON public.merchant_category_links
  FOR SELECT TO anon, authenticated USING (true);

-- Le commerçant gère SES liaisons (insert/delete) ; pas d'update (pk complet).
DROP POLICY IF EXISTS mcl_owner_insert ON public.merchant_category_links;
CREATE POLICY mcl_owner_insert ON public.merchant_category_links
  FOR INSERT TO authenticated
  WITH CHECK (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS mcl_owner_delete ON public.merchant_category_links;
CREATE POLICY mcl_owner_delete ON public.merchant_category_links
  FOR DELETE TO authenticated
  USING (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  );

-- Backfill : la catégorie principale de chaque commerçant devient une liaison.
INSERT INTO public.merchant_category_links (merchant_id, code)
SELECT m.id, m.category
FROM public.merchants m
JOIN public.merchant_categories c ON c.code = m.category
WHERE m.category IS NOT NULL
ON CONFLICT DO NOTHING;

-- Cohérence AUTOMATIQUE : toute création / changement de catégorie principale
-- garantit la liaison correspondante (DEFINER : écrit dans la table de liaison
-- au nom du système, indépendamment de la RLS du rôle appelant).
CREATE OR REPLACE FUNCTION public.sync_primary_category_link()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.category IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.merchant_categories WHERE code = NEW.category)
  THEN
    INSERT INTO public.merchant_category_links (merchant_id, code)
    VALUES (NEW.id, NEW.category)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS merchants_sync_primary_category ON public.merchants;
CREATE TRIGGER merchants_sync_primary_category
  AFTER INSERT OR UPDATE OF category ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION public.sync_primary_category_link();
