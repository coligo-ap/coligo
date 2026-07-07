-- =============================================================================
-- 0337 — Gestion avancée des commandes (super-admin) : enums + colonnes support
-- =============================================================================
-- Prépare la 0338 (RPC). Les ADD VALUE vivent dans LEUR migration (committés
-- avant usage — règle PG, cf. 0120/0159) : on ne les utilise en DML qu'en 0338.
--
-- 1. `delivery_ledger_type += 'driver_compensation'` — indemnité DISCRÉTIONNAIRE
--    décidée par le support (course retirée, litige, geste commercial), montant
--    personnalisable. Distincte de 'driver_payout' (gain nominal) et de
--    'driver_advance_refund' (remboursement d'avance no-show) : elle est due par
--    la plateforme au livreur quel que soit le mode de paiement de la commande.
--    UNIQUE (order_id, type) du ledger ⇒ UNE indemnité max par commande
--    (anti-double-indemnisation structurel).
-- 2. `platform_ledger_type += 'driver_compensation_expense'` — contrepartie
--    comptable côté Coligo (dépense).
-- 3. `orders.admin_refunded_da` — cumul des remboursements MANUELS accordés par
--    le support sur cette commande (hors annulation, qui rembourse déjà tout via
--    admin_cancel_order + triggers). Sert de garde anti-double-remboursement :
--    remboursable restant = payé − admin_refunded_da, contrôlé sous FOR UPDATE.
-- 4. `admin_audit_log` : + old_value/new_value (JSONB avant/après) + ip — toute
--    action admin critique trace désormais QUI, QUAND, QUOI (avant/après),
--    POURQUOI (note) et D'OÙ (ip). Colonnes nullables : l'existant ne casse pas.
-- =============================================================================

ALTER TYPE public.delivery_ledger_type ADD VALUE IF NOT EXISTS 'driver_compensation';
ALTER TYPE public.platform_ledger_type ADD VALUE IF NOT EXISTS 'driver_compensation_expense';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS admin_refunded_da INTEGER NOT NULL DEFAULT 0
    CHECK (admin_refunded_da >= 0);

ALTER TABLE public.admin_audit_log
  ADD COLUMN IF NOT EXISTS old_value JSONB,
  ADD COLUMN IF NOT EXISTS new_value JSONB,
  ADD COLUMN IF NOT EXISTS ip TEXT;

-- Recherche admin : accélère les filtres les plus combinés (statut+date déjà
-- couverts par idx_orders_status/created_at ; on ajoute le livreur).
CREATE INDEX IF NOT EXISTS idx_orders_delivery_driver
  ON public.orders (delivery_driver_id, created_at DESC)
  WHERE delivery_driver_id IS NOT NULL;
