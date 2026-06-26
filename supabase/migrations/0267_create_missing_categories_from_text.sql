-- =============================================================================
-- 0267 — Crée les catégories manquantes depuis le texte + relie les produits
-- =============================================================================
-- Suite de 0266 : certains produits avaient une catégorie en TEXTE
-- (`products.category`) qui n'existait PAS comme ligne `categories` → impossible
-- de la relier. On crée ces catégories (1 par commerce + titre distinct), puis
-- on relie tous les produits restants. Après ça, chaque produit ayant une
-- catégorie texte a un `category_id` → le sélecteur d'édition se pré-remplit.
-- Idempotent : ne crée que l'absent, ne relie que les category_id NULL.
-- =============================================================================

-- 1) Catégories manquantes (insensible casse/espaces, scopé par commerce).
INSERT INTO public.categories (merchant_id, title)
SELECT DISTINCT p.merchant_id, btrim(p.category)
FROM public.products p
WHERE p.category_id IS NULL
  AND p.category IS NOT NULL
  AND btrim(p.category) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.categories c
    WHERE c.merchant_id = p.merchant_id
      AND lower(btrim(c.title)) = lower(btrim(p.category))
  );

-- 2) Relie tous les produits restants à leur catégorie (existante ou créée).
UPDATE public.products p
SET category_id = c.id
FROM public.categories c
WHERE p.category_id IS NULL
  AND p.category IS NOT NULL
  AND btrim(p.category) <> ''
  AND c.merchant_id = p.merchant_id
  AND lower(btrim(c.title)) = lower(btrim(p.category));
