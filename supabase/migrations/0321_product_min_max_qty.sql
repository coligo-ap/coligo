-- ============================================================================
-- 0321 — Quantité MIN par produit et MAX par commande, au choix du commerçant.
--
--   products.min_qty : quantité minimale par LIGNE de commande (dans l'unité
--                      de vente — ex. 0.5 = minimum 500 g pour un produit au
--                      kilo). NULL = pas de minimum (défaut : le pas de
--                      l'unité côté client).
--   products.max_qty : quantité maximale par COMMANDE pour ce produit (somme
--                      de toutes les lignes du produit). NULL = pas de max.
--
--   Enforcement bypass-proof côté Server Action checkout (le client ne fait
--   qu'afficher/clamper). NUMERIC(10,2) — aligné sur order_items.quantity.
-- ============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS min_qty NUMERIC(10, 2)
    CHECK (min_qty IS NULL OR min_qty > 0),
  ADD COLUMN IF NOT EXISTS max_qty NUMERIC(10, 2)
    CHECK (max_qty IS NULL OR max_qty > 0);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_min_qty_le_max_qty'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_min_qty_le_max_qty
      CHECK (min_qty IS NULL OR max_qty IS NULL OR min_qty <= max_qty);
  END IF;
END $$;
