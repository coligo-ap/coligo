-- =============================================================================
-- 0340 — Cohérence des liaisons de catégorie PRINCIPALE (constat test e2e).
-- =============================================================================
-- Constats (scripts/test-categories-module.mjs) :
--   1. Trois commerçants portent des catégories HÉRITÉES d'avant le système à
--      codes (« Boulangerie », « Restauration », « Santé & Beauté » : des
--      libellés, pas des codes) → le trigger 0313 n'a jamais créé leur liaison
--      'primary' (il exige un code existant). Invisible dans les comptages
--      liés et le panneau admin.
--   2. Le trigger ne fait qu'INSÉRER (ON CONFLICT DO NOTHING) : il ne PROMEUT
--      pas une liaison manuel/auto existante et ne RÉTROGRADE pas l'ancienne
--      principale quand la catégorie change — bookkeeping laissé au JS (fait
--      côté admin, fragile côté commerçant).
--   3. La policy mcl_owner_delete permet au commerçant de supprimer SA liaison
--      'primary' alors que merchants.category pointe encore dessus (désync).
--
-- Correctifs :
--   A. Trigger AUTO-COHÉRENT : à tout changement de merchants.category, la
--      liaison cible est upsertée/promue 'primary' et toute autre liaison
--      'primary' du commerçant est rétrogradée 'manual' (aucune visibilité
--      perdue). La vérité 'primary' suit STRICTEMENT merchants.category.
--   B. Réparation data : normalisation des catégories héritées vers leur code
--      (mapping ci-dessous), puis backfill idempotent des liaisons 'primary'
--      manquantes + rétrogradation des 'primary' divergentes (re-run 0319).
--   C. Policy durcie : un commerçant ne peut plus supprimer une liaison
--      source='primary' (elle se change en changeant la catégorie principale,
--      réglages boutique / fiche admin). Le flux réglages est adapté dans le
--      même commit (delete ciblé hors principale, plus de delete-all).
-- =============================================================================

-- ── A. Trigger auto-cohérent ─────────────────────────────────────────────
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
    ON CONFLICT (merchant_id, code) DO UPDATE SET source = 'primary';

    -- L'ancienne principale (si différente) reste liée mais en 'manual' :
    -- aucune visibilité perdue, marquage cohérent avec merchants.category.
    UPDATE public.merchant_category_links
       SET source = 'manual'
     WHERE merchant_id = NEW.id
       AND source = 'primary'
       AND code <> NEW.category;
  END IF;
  RETURN NEW;
END;
$$;

-- ── B1. Normalisation des catégories héritées (libellés → codes) ─────────
-- Cas génériques d'abord : la valeur est déjà un code à la casse près, ou le
-- 1er segment d'un libellé FR (« Boulangerie / Pâtisserie » → 'boulangerie').
UPDATE public.merchants m
   SET category = mc.code
  FROM public.merchant_categories mc
 WHERE m.category IS NOT NULL
   AND m.category <> mc.code
   AND lower(m.category) = mc.code;

UPDATE public.merchants m
   SET category = mc.code
  FROM public.merchant_categories mc
 WHERE m.category IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.merchant_categories x WHERE x.code = m.category)
   AND lower(btrim(split_part(mc.label, '/', 1))) = lower(btrim(m.category));

-- Mappings explicites restants (valeurs héritées connues, constatées en prod).
UPDATE public.merchants SET category = 'restaurant'
 WHERE category = 'Restauration';
UPDATE public.merchants SET category = 'pharmacie'
 WHERE category = 'Santé & Beauté';

-- ── B2. Backfill des liaisons 'primary' manquantes (idempotent) ──────────
INSERT INTO public.merchant_category_links (merchant_id, code, source)
SELECT m.id, m.category, 'primary'
  FROM public.merchants m
  JOIN public.merchant_categories mc ON mc.code = m.category
 WHERE m.category IS NOT NULL
ON CONFLICT (merchant_id, code) DO UPDATE SET source = 'primary';

-- Rétrograde les 'primary' divergentes (re-run de la réparation 0319).
UPDATE public.merchant_category_links l
   SET source = 'manual'
  FROM public.merchants m
 WHERE m.id = l.merchant_id
   AND l.source = 'primary'
   AND m.category IS DISTINCT FROM l.code;

-- ── C. Policies : la liaison 'primary' appartient au SERVEUR ─────────────
-- Elle naît/suit merchants.category via le trigger (DEFINER) ; un commerçant
-- ne peut ni la supprimer ni s'en fabriquer une (source imposé 'manual' à
-- l'insert — le recalcul 'auto' et l'admin passent par service_role).
DROP POLICY IF EXISTS mcl_owner_delete ON public.merchant_category_links;
CREATE POLICY mcl_owner_delete ON public.merchant_category_links
  FOR DELETE TO authenticated
  USING (
    source <> 'primary'
    AND merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS mcl_owner_insert ON public.merchant_category_links;
CREATE POLICY mcl_owner_insert ON public.merchant_category_links
  FOR INSERT TO authenticated
  WITH CHECK (
    source = 'manual'
    AND merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  );

-- =============================================================================
-- VÉRIF :
--   SELECT count(*) FROM merchants m
--    WHERE m.category IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM merchant_category_links l
--                       WHERE l.merchant_id = m.id AND l.code = m.category
--                         AND l.source = 'primary');            -- attendu : 0
-- =============================================================================
