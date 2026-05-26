-- =============================================================================
-- 0042 — Argent livraison + gel de compte admin (prompt LIV-09)
-- =============================================================================
-- - Ledger livraison dédié pour les paiements/reversements LIVREUR.
--   (Le wallet commerçant existant reste intact ; les commissions plateforme
--   continuent de transiter par `wallet_entries` et `platform_ledger`.)
-- - Gel admin : flag is_frozen sur drivers (existait déjà sur merchants).
-- - Audit transversal léger : `admin_audit_log`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Type d'écriture livraison
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_ledger_type') THEN
    CREATE TYPE public.delivery_ledger_type AS ENUM (
      'driver_payout',           -- ce que Coligo doit au livreur
      'driver_cash_collected',   -- le livreur a encaissé du cash client
      'driver_owes_platform',    -- ce que le livreur doit reverser à la plateforme (cash)
      'driver_owes_merchant',    -- ce que le livreur doit au commerçant (cash produits)
      'adjustment'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.delivery_ledger (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id    UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  merchant_id  UUID REFERENCES public.merchants(id) ON DELETE SET NULL,
  order_id     UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  type         public.delivery_ledger_type NOT NULL,
  amount_da    INTEGER NOT NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT delivery_ledger_order_type_unique UNIQUE (order_id, type),
  CONSTRAINT delivery_ledger_adjustment_note CHECK (
    type <> 'adjustment' OR (note IS NOT NULL AND btrim(note) <> '')
  )
);

CREATE INDEX IF NOT EXISTS idx_delivery_ledger_driver
  ON public.delivery_ledger (driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_ledger_merchant
  ON public.delivery_ledger (merchant_id, created_at DESC);

ALTER TABLE public.delivery_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "delivery_ledger_driver_select" ON public.delivery_ledger;
CREATE POLICY "delivery_ledger_driver_select"
  ON public.delivery_ledger FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = delivery_ledger.driver_id AND d.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delivery_ledger_merchant_select" ON public.delivery_ledger;
CREATE POLICY "delivery_ledger_merchant_select"
  ON public.delivery_ledger FOR SELECT
  USING (
    delivery_ledger.merchant_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = delivery_ledger.merchant_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delivery_ledger_admin_select" ON public.delivery_ledger;
CREATE POLICY "delivery_ledger_admin_select"
  ON public.delivery_ledger FOR SELECT
  USING (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- Gel livreur
-- ---------------------------------------------------------------------------
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Audit admin (gel / dégel / décisions sensibles)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email    TEXT,
  action         TEXT NOT NULL,    -- 'freeze_driver' | 'unfreeze_driver' | 'freeze_merchant' | etc.
  target_kind    TEXT NOT NULL,    -- 'driver' | 'merchant'
  target_id      UUID,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created
  ON public.admin_audit_log (created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_audit_log_admin_all" ON public.admin_audit_log;
CREATE POLICY "admin_audit_log_admin_all"
  ON public.admin_audit_log FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- Génération des écritures livraison à la complétion (cash ou online).
--   - online : le client a déjà payé (produits + livraison) via Chargily.
--     → la commission plateforme est déjà gérée par le wallet trigger
--       existant ; ici on inscrit juste la part du livreur en
--       `driver_payout` (montant = delivery_fee_da * part_livreur).
--   - cash : le livreur a encaissé tout. On inscrit :
--       driver_cash_collected = total_da
--       driver_owes_merchant  = total_da - delivery_fee_da (produits)
--       driver_owes_platform  = 0 (par défaut ; ajustable par config future)
--       driver_payout         = delivery_fee_da (rémunération)
-- Idempotency : UNIQUE (order_id, type) — rejouer le trigger ne re-crée pas.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_delivery_ledger_on_complete()
RETURNS TRIGGER AS $$
DECLARE
  v_payout INTEGER;
BEGIN
  IF NEW.status = 'completed' AND OLD.status <> 'completed'
     AND NEW.fulfillment_type = 'delivery'
     AND NEW.delivery_driver_id IS NOT NULL THEN

    -- La rémunération livreur = montant de la livraison perçu par la
    -- plateforme. (Modèle MVP : on attribue 100 % de delivery_fee_da au
    -- livreur ; ajustement plateforme via type 'adjustment' au besoin.)
    v_payout := NEW.delivery_fee_da;

    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
      VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_payout', v_payout, NULL)
      ON CONFLICT (order_id, type) DO NOTHING;

    IF NEW.payment_method = 'cash' THEN
      INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
        VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_cash_collected', NEW.total_da, NULL)
        ON CONFLICT (order_id, type) DO NOTHING;
      INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
        VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_owes_merchant',
                GREATEST(NEW.total_da - NEW.delivery_fee_da, 0), NULL)
        ON CONFLICT (order_id, type) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS generate_delivery_ledger_trg ON public.orders;
CREATE TRIGGER generate_delivery_ledger_trg
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.generate_delivery_ledger_on_complete();
