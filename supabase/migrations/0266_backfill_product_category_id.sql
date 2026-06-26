-- =============================================================================
-- 0266 — Backfill products.category_id depuis l'ancienne colonne `category`
-- =============================================================================
-- Certains produits (anciens / import) avaient seulement la catégorie en TEXTE
-- (`products.category`) sans le lien FK `category_id`. Résultat : à l'édition,
-- le sélecteur de catégorie tombait sur « Aucune catégorie ». On rattache chaque
-- produit à la catégorie EXISTANTE du même commerce dont le titre correspond
-- (insensible à la casse/espaces). Idempotent : ne touche que les category_id
-- NULL ayant une correspondance ; aucune catégorie créée.
-- =============================================================================

UPDATE public.products p
SET category_id = c.id
FROM public.categories c
WHERE p.category_id IS NULL
  AND p.category IS NOT NULL
  AND btrim(p.category) <> ''
  AND c.merchant_id = p.merchant_id
  AND lower(btrim(c.title)) = lower(btrim(p.category));
