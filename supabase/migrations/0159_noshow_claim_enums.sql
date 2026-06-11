-- =============================================================================
-- 0159 — Enums du remboursement d'avance no-show (validation support)
-- =============================================================================
-- Un ALTER TYPE ... ADD VALUE doit être committé AVANT d'être utilisé par une
-- fonction/écriture → migration séparée de la logique (0160), même pattern
-- que 0120/0126.
--
--   delivery_ledger.driver_advance_refund : la plateforme rembourse au livreur
--     l'avance commerçant (P − commission) qu'il a payée au pickup d'une
--     commande COD finie en no-show — UNIQUEMENT après validation du support
--     quand la marchandise n'est PAS retournée au commerçant (gardée/donnée).
--
--   platform_ledger.noshow_advance_expense : la charge correspondante côté
--     plateforme (partie double).
-- =============================================================================

ALTER TYPE public.delivery_ledger_type ADD VALUE IF NOT EXISTS 'driver_advance_refund';
ALTER TYPE public.platform_ledger_type ADD VALUE IF NOT EXISTS 'noshow_advance_expense';
