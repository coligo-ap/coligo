-- =============================================================================
-- 0120 — Commission TOURNÉE : enums + colonnes + paramètre (préalable à 0121)
-- =============================================================================
-- En TOURNÉE, le commerçant fait sa livraison en propre : il ENCAISSE les frais
-- de livraison (qu'il a fixés par zone, cf. 0119) et PAIE une commission à la
-- plateforme sur ces frais — c'est la monétisation de la tournée (en plus de la
-- commission produits qui existe déjà). Le modèle livreur-custodian (driver_fee,
-- relevés — 0103/0116) reste réservé à l'EXPRESS (livreurs indépendants).
--
-- Cette migration prépare uniquement le SCHÉMA. La logique (triggers) est en 0121
-- car une valeur d'enum fraîchement ajoutée ne peut pas être UTILISÉE dans la
-- même transaction que son ALTER TYPE ... ADD VALUE.
-- =============================================================================

-- 1) Taux de commission plateforme sur les frais de livraison de tournée.
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS tour_delivery_commission_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.08;

-- 2) Snapshots immuables sur la commande.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tour_delivery_commission_da           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tour_delivery_commission_rate_applied NUMERIC(5, 4);

-- 3) Nouvelles écritures :
--    • wallet commerçant : `delivery_revenue` (la livraison qu'il encaisse,
--      online) et `tour_delivery_commission` (sa commission due, négative).
--    • platform_ledger : `tour_delivery_commission_income` (revenu plateforme).
ALTER TYPE public.wallet_entry_type    ADD VALUE IF NOT EXISTS 'delivery_revenue';
ALTER TYPE public.wallet_entry_type    ADD VALUE IF NOT EXISTS 'tour_delivery_commission';
ALTER TYPE public.platform_ledger_type ADD VALUE IF NOT EXISTS 'tour_delivery_commission_income';
