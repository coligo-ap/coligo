-- =============================================================================
-- 0263 — Archivage doux des produits (soft-delete) + traçabilité
-- =============================================================================
-- Problème : la suppression d'un produit était un HARD DELETE → on perdait la
-- fiche produit (noms FR/AR, catégorie, historique d'existence). Les VENTES
-- restent intactes de toute façon (order_items SNAPSHOTE product_name + prix,
-- AUCUNE FK vers products) — donc finances/commissions/Coligo Pay ne sont JAMAIS
-- impactés par une suppression. Mais pour la traçabilité du produit lui-même et
-- pour ne pas perdre d'information, on passe à un archivage doux :
--   • archived_at IS NULL  → produit actif (visible catalogue commerçant).
--   • archived_at NOT NULL → produit archivé (invisible partout, conservé).
-- L'application met aussi is_available=false à l'archivage → invisible client
-- (la RLS publique exige is_available=true). La photo est supprimée du storage
-- côté app pour ne pas accumuler de fichiers inutiles.
-- =============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Index partiel : les requêtes catalogue commerçant ne lisent que les actifs.
CREATE INDEX IF NOT EXISTS idx_products_active
  ON public.products(merchant_id, position)
  WHERE archived_at IS NULL;
