-- =============================================================================
-- Coligo v3 - Migration 0258 : Montant minimum de panier pour un code promo
-- =============================================================================
-- Le commerçant peut exiger un sous-total minimum (DA) pour qu'un code promo
-- s'applique. Ex. « 20 % de réduction dès 3 000 DA d'achats ».
--   - NULL = aucun minimum (comportement existant inchangé) ;
--   - le seuil porte sur le sous-total APRÈS réductions produit / offres
--     quantité (même base que le calcul du code dans lib/promotions/engine).
-- Colonne neutre pour les autres types de promo (réduction produit / offre
-- quantité l'ignorent).
-- =============================================================================

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS min_subtotal_da INTEGER
    CHECK (min_subtotal_da IS NULL OR min_subtotal_da >= 0);

COMMENT ON COLUMN public.promotions.min_subtotal_da IS
  'Sous-total minimum (DA, après réductions produit) requis pour appliquer un code promo. NULL = aucun minimum.';
