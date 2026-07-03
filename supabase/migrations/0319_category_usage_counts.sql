-- =============================================================================
-- 0319 — Comptages d'usage des catégories FIABLES + suppression ATOMIQUE.
-- Corrige 4 défauts de la garde de suppression (revue de code) :
--   1. Le flux réglages commerçant réécrivait la liaison principale en
--      source='manual' (delete all + re-insert sans source) → le marqueur
--      'primary' n'est PAS fiable. Réparation data ici + les comptages ne
--      reposent PLUS sur `source` : le « secondaire » se calcule par
--      comparaison avec merchants.category (la vérité).
--   2. UI et serveur comptaient des choses différentes (source<>primary vs
--      toutes liaisons) → bouton actif mais suppression refusée. Les deux
--      lisent désormais admin_category_usage() (mêmes définitions).
--   3. Les SELECT bruts étaient plafonnés à 1000 lignes par PostgREST →
--      sous-comptage à l'échelle. Comptages en SQL, exacts.
--   4. Course check-then-delete : un commerçant pouvait gagner la catégorie
--      entre les comptages et le DELETE (CASCADE silencieux). La suppression
--      passe par admin_delete_category() : FOR UPDATE sur la ligne catégorie
--      → tout INSERT de liaison concurrent (FK KEY SHARE) attend le commit.
-- Sécurité : fns service_role UNIQUEMENT (REVOKE PUBLIC/authenticated/anon,
-- cf. mig 0272/0274) — appelées par les Server Actions admin qui re-gardent
-- adminCan('plateforme').
-- =============================================================================

-- ── 1. Réparation data : re-marquer 'primary' les liaisons qui correspondent
--       à la catégorie principale réelle (idempotent, même UPDATE que mig 0313).
UPDATE public.merchant_category_links l
SET source = 'primary'
FROM public.merchants m
WHERE m.id = l.merchant_id AND m.category = l.code AND l.source <> 'primary';

-- Et inversement : une liaison encore marquée 'primary' alors que la
-- principale a changé (résidu du trigger qui ne rétrograde pas) redevient
-- 'manual' — la visibilité marketplace est conservée, seul le libellé change.
UPDATE public.merchant_category_links l
SET source = 'manual'
FROM public.merchants m
WHERE m.id = l.merchant_id AND m.category IS DISTINCT FROM l.code
  AND l.source = 'primary';

-- ── 2/3. Comptages exacts par catégorie (page admin + garde UI).
--    primary_count   : commerçants dont c'est la catégorie PRINCIPALE.
--    secondary_count : liaisons de commerçants dont la principale DIFFÈRE
--                      (robuste même si `source` est mal étiqueté).
--    links_total     : toutes les liaisons (c'est CE nombre qui bloque la
--                      suppression d'un type, comme côté serveur).
CREATE OR REPLACE FUNCTION public.admin_category_usage()
RETURNS TABLE(code text, primary_count bigint, secondary_count bigint, links_total bigint)
LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.code,
    (SELECT count(*) FROM public.merchants m WHERE m.category = c.code),
    (SELECT count(*) FROM public.merchant_category_links l
       JOIN public.merchants m ON m.id = l.merchant_id
      WHERE l.code = c.code AND m.category IS DISTINCT FROM c.code),
    (SELECT count(*) FROM public.merchant_category_links l WHERE l.code = c.code)
  FROM public.merchant_categories c
$$;

REVOKE ALL ON FUNCTION public.admin_category_usage()
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_category_usage() TO service_role;

-- ── 4. Suppression ATOMIQUE. FOR UPDATE sur la ligne catégorie : un INSERT
--       concurrent dans merchant_category_links (FK → KEY SHARE sur cette
--       ligne) ou un changement de catégorie principale (trigger → même
--       INSERT) BLOQUE jusqu'à notre commit → les comptages restent vrais au
--       moment du DELETE. Retour texte : 'ok' | 'not_found' |
--       'primary:<n>' | 'links:<n>' (messages français côté action).
CREATE OR REPLACE FUNCTION public.admin_delete_category(p_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind text;
  v_n bigint;
BEGIN
  SELECT kind INTO v_kind
  FROM public.merchant_categories
  WHERE code = p_code
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF v_kind <> 'filter' THEN
    SELECT count(*) INTO v_n FROM public.merchants WHERE category = p_code;
    IF v_n > 0 THEN
      RETURN 'primary:' || v_n;
    END IF;
    SELECT count(*) INTO v_n
    FROM public.merchant_category_links WHERE code = p_code;
    IF v_n > 0 THEN
      RETURN 'links:' || v_n;
    END IF;
  END IF;

  DELETE FROM public.merchant_categories WHERE code = p_code;
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_category(text)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_category(text) TO service_role;

COMMENT ON FUNCTION public.admin_category_usage() IS
  'Comptages exacts d''usage des catégories (mig 0319) — service_role seul.';
COMMENT ON FUNCTION public.admin_delete_category(text) IS
  'Suppression atomique d''une catégorie, gardée par usage (mig 0319) — service_role seul.';
