-- =============================================================================
-- Coligo v3 - Migration 0362 : scan code-barres PHASE 2 — colonne `barcode`
-- =============================================================================
-- Le commerçant renseigne (ou SCANNE, caméra ou douchette Sunmi) le code-barres
-- de ses produits. Côté client, le scan cherche alors le match EXACT par code
-- (prioritaire, fonctionne même si le code est inconnu d'OpenFoodFacts) avant
-- le matching flou par nom (phase 1). Non unique : plusieurs commerçants
-- vendent le même produit.
-- =============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS barcode TEXT
  CHECK (barcode IS NULL OR barcode ~ '^[0-9]{8,14}$');

CREATE INDEX IF NOT EXISTS idx_products_barcode
  ON public.products(barcode)
  WHERE barcode IS NOT NULL;

-- =============================================================================
-- VÉRIFICATION :
--   UPDATE products SET barcode = 'abc' WHERE false;  -- CHECK ok
--   SELECT count(*) FROM products WHERE barcode IS NOT NULL;
-- =============================================================================
