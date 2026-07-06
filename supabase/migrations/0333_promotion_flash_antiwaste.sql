-- =============================================================================
-- 0333 — Nouveaux types de promotion : VENTE FLASH + ANTI-GASPILLAGE
-- =============================================================================
-- Deux réductions produit à FORTE mise en avant, gérées comme des
-- `product_discount` par le moteur (elles s'appliquent au checkout de la même
-- façon : -X% / -X DA sur des produits choisis) mais AFFICHÉES différemment :
--   • flash_sale      : vente flash à DURÉE LIMITÉE (compte à rebours) → urgence.
--                       Le champ `ends_at` sert de fin du compte à rebours.
--   • anti_gaspillage : déstockage / invendus à prix cassé (style anti-gaspi),
--                       visuel « éco ». `max_uses` peut borner la quantité.
--
-- Aucune colonne nouvelle : on réutilise discount_kind / discount_value /
-- promotion_products / starts_at / ends_at / max_uses. Le moteur (mig suivante
-- côté code) inclut ces deux types dans les réductions produit.
-- =============================================================================

ALTER TYPE public.promotion_type ADD VALUE IF NOT EXISTS 'flash_sale';
ALTER TYPE public.promotion_type ADD VALUE IF NOT EXISTS 'anti_gaspillage';
