-- =============================================================================
-- Coligo v3 - Migration 0010 : Wallet à 2 modes (cash/online) + taux configurables
-- =============================================================================
-- Appliquée via `npm run db:push` (ou copiable dans le SQL Editor Supabase).
--
-- ⚠️ ARGENT RÉEL. Étend le wallet (0009) :
--   - CASH  : à `completed` → écriture `commission` NÉGATIVE seulement (dette).
--   - ONLINE: à `payment_status = paid` → `sale` (+) ET `commission` (−).
--   - taux configurables à 2 niveaux : global (platform_settings) surchargé par
--     commerçant (colonnes nullable). Résolution : merchant ?? global.
--   - cashback financé par Coligo (prélevé sur SA commission) → enregistré en
--     `cashback_grants` (intention) + `platform_ledger` (compta Coligo).
--   - frais Chargily à la charge de Coligo → `platform_ledger` (jamais le wallet
--     commerçant).
--   - snapshots de TOUS les taux figés sur la commande à la génération.
--   - idempotency : UNIQUE (order_id, type) sur wallet_entries ET platform_ledger.
--
-- Numérotée 0010 (le brouillon disait 0008, déjà pris par les promotions).
-- =============================================================================

-- ============================================================================
-- 1. ENUMS
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE public.payment_method AS ENUM ('cash', 'online');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.cashback_status AS ENUM ('pending', 'granted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.platform_ledger_type AS ENUM
    ('commission_income', 'chargily_fee', 'cashback_expense');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 2. ORDERS : mode de paiement + snapshots de taux + statut paiement online
-- ============================================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_method public.payment_method NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS payment_status public.payment_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS commission_rate_applied  NUMERIC(5, 4),
  ADD COLUMN IF NOT EXISTS cashback_rate_applied    NUMERIC(5, 4),
  ADD COLUMN IF NOT EXISTS chargily_fee_rate_applied NUMERIC(5, 4);

-- ============================================================================
-- 3. platform_settings : taux globaux par défaut (ligne unique)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id                BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  commission_cash   NUMERIC(5, 4) NOT NULL DEFAULT 0.08,
  commission_online NUMERIC(5, 4) NOT NULL DEFAULT 0.08,
  cashback_online   NUMERIC(5, 4) NOT NULL DEFAULT 0.03,
  cashback_cash     NUMERIC(5, 4) NOT NULL DEFAULT 0.00,
  chargily_fee      NUMERIC(5, 4) NOT NULL DEFAULT 0.00,
  max_debt_da       INTEGER NOT NULL DEFAULT 5000,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.platform_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- ============================================================================
-- 4. MERCHANTS : surcharges par commerçant (NULL = hérite du global) + gel
-- ============================================================================
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS commission_cash   NUMERIC(5, 4),
  ADD COLUMN IF NOT EXISTS commission_online NUMERIC(5, 4),
  ADD COLUMN IF NOT EXISTS cashback_online   NUMERIC(5, 4),
  ADD COLUMN IF NOT EXISTS cashback_cash     NUMERIC(5, 4),
  ADD COLUMN IF NOT EXISTS is_frozen         BOOLEAN NOT NULL DEFAULT false;

-- ============================================================================
-- 5. SUPER-ADMIN : table d'emails + fonction is_super_admin()
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.platform_admins (
  email      TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ⚠️ À AJUSTER : remplace par l'email exact de ton compte Supabase admin.
INSERT INTO public.platform_admins (email)
VALUES ('coligo.noreply@gmail.com'), ('gacinoufel@gmail.com')
ON CONFLICT DO NOTHING;

-- SECURITY DEFINER : peut lire platform_admins même sous RLS (évite la circularité).
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE email = (auth.jwt() ->> 'email')
  );
$$;

-- ============================================================================
-- 6. Compta plateforme (marge Coligo) + intentions de cashback client
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.platform_ledger (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  type       public.platform_ledger_type NOT NULL,
  amount_da  INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_ledger_order_type_unique UNIQUE (order_id, type)
);
CREATE INDEX IF NOT EXISTS idx_platform_ledger_created ON public.platform_ledger(created_at DESC);

CREATE TABLE IF NOT EXISTS public.cashback_grants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  customer_phone TEXT,
  amount_da      INTEGER NOT NULL CHECK (amount_da >= 0),
  status         public.cashback_status NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cashback_grants_order_unique UNIQUE (order_id)
);

-- ============================================================================
-- 7. Résolution des taux : commerçant ?? global. Sans SQL dynamique.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.resolve_rate(p_merchant_id UUID, p_key TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE;
  m public.merchants%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT * INTO m FROM public.merchants WHERE id = p_merchant_id;
  RETURN CASE p_key
    WHEN 'commission_cash'   THEN COALESCE(m.commission_cash,   s.commission_cash)
    WHEN 'commission_online' THEN COALESCE(m.commission_online, s.commission_online)
    WHEN 'cashback_online'   THEN COALESCE(m.cashback_online,   s.cashback_online)
    WHEN 'cashback_cash'     THEN COALESCE(m.cashback_cash,     s.cashback_cash)
    WHEN 'chargily_fee'      THEN s.chargily_fee  -- global uniquement
    ELSE NULL
  END;
END;
$$;

-- ============================================================================
-- 8. On retire l'ancien trigger (0009) qui générait sale+commission pour tous.
-- ============================================================================
DROP TRIGGER IF EXISTS trigger_wallet_on_order_completed ON public.orders;

-- ============================================================================
-- 9. RÉCONCILIATION des commandes déjà `completed` (avant de recréer un trigger,
--    donc AUCUN trigger ne fire ici). Leurs écritures existantes sont de type
--    online (sale+commission) → on les marque online/paid + on fige les taps
--    réellement utilisés (commission 5% du 0009, cashback/fee 0).
-- ============================================================================
UPDATE public.orders
SET payment_method = 'online',
    payment_status = 'paid',
    commission_rate_applied   = COALESCE(commission_rate_applied, 0.05),
    cashback_rate_applied     = COALESCE(cashback_rate_applied, 0),
    chargily_fee_rate_applied = COALESCE(chargily_fee_rate_applied, 0)
WHERE status = 'completed';

-- Backfill platform_ledger (commission_income) aligné sur les écritures
-- commission déjà présentes, pour que la compta Coligo soit cohérente.
INSERT INTO public.platform_ledger (order_id, type, amount_da)
SELECT order_id, 'commission_income', -amount_da
FROM public.wallet_entries
WHERE type = 'commission' AND order_id IS NOT NULL
ON CONFLICT (order_id, type) DO NOTHING;

-- ============================================================================
-- 10. Nouvelle génération des écritures (cash vs online). SECURITY DEFINER.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.generate_wallet_entries_on_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_generate   BOOLEAN := false;
  v_comm_rate  NUMERIC(5, 4);
  v_cash_rate  NUMERIC(5, 4);
  v_fee_rate   NUMERIC(5, 4);
  v_commission INTEGER;
  v_cashback   INTEGER;
  v_fee        INTEGER;
BEGIN
  -- Déclenchement selon le mode.
  IF NEW.payment_method = 'cash' THEN
    v_generate := (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed');
  ELSE
    v_generate := (NEW.payment_status = 'paid' AND OLD.payment_status IS DISTINCT FROM 'paid');
  END IF;

  IF NOT v_generate THEN
    RETURN NEW;
  END IF;

  -- Résolution des taux (commerçant ?? global).
  IF NEW.payment_method = 'cash' THEN
    v_comm_rate := public.resolve_rate(NEW.merchant_id, 'commission_cash');
    v_cash_rate := public.resolve_rate(NEW.merchant_id, 'cashback_cash');
    v_fee_rate  := 0;
  ELSE
    v_comm_rate := public.resolve_rate(NEW.merchant_id, 'commission_online');
    v_cash_rate := public.resolve_rate(NEW.merchant_id, 'cashback_online');
    v_fee_rate  := public.resolve_rate(NEW.merchant_id, 'chargily_fee');
  END IF;

  v_commission := round(NEW.total_da * v_comm_rate)::INTEGER;
  v_cashback   := round(NEW.total_da * v_cash_rate)::INTEGER;
  v_fee        := round(NEW.total_da * v_fee_rate)::INTEGER;

  -- Snapshot des taux sur la commande (ne re-déclenche PAS ce trigger : ces
  -- colonnes ne sont pas dans la clause OF du trigger).
  UPDATE public.orders
  SET commission_rate_applied   = v_comm_rate,
      cashback_rate_applied     = v_cash_rate,
      chargily_fee_rate_applied = v_fee_rate
  WHERE id = NEW.id;

  -- WALLET COMMERÇANT.
  IF NEW.payment_method = 'online' THEN
    INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da)
    VALUES (NEW.merchant_id, NEW.id, 'sale', NEW.total_da)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da, commission_rate)
  VALUES (NEW.merchant_id, NEW.id, 'commission', -v_commission, v_comm_rate)
  ON CONFLICT (order_id, type) DO NOTHING;

  -- COMPTA COLIGO.
  INSERT INTO public.platform_ledger (order_id, type, amount_da)
  VALUES (NEW.id, 'commission_income', v_commission)
  ON CONFLICT (order_id, type) DO NOTHING;

  IF NEW.payment_method = 'online' THEN
    IF v_fee > 0 THEN
      INSERT INTO public.platform_ledger (order_id, type, amount_da)
      VALUES (NEW.id, 'chargily_fee', -v_fee)
      ON CONFLICT (order_id, type) DO NOTHING;
    END IF;
    IF v_cashback > 0 THEN
      INSERT INTO public.platform_ledger (order_id, type, amount_da)
      VALUES (NEW.id, 'cashback_expense', -v_cashback)
      ON CONFLICT (order_id, type) DO NOTHING;
      INSERT INTO public.cashback_grants (order_id, customer_phone, amount_da)
      VALUES (NEW.id, NEW.customer_phone, v_cashback)
      ON CONFLICT (order_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_wallet_on_order_completed
  AFTER UPDATE OF status, payment_status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_wallet_entries_on_completion();

-- ============================================================================
-- 11. ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_ledger   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashback_grants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins   ENABLE ROW LEVEL SECURITY;

-- platform_settings : lecture par tout authentifié (besoin pour calculer/afficher),
-- écriture réservée au super-admin.
CREATE POLICY "platform_settings_select_all" ON public.platform_settings
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "platform_settings_update_admin" ON public.platform_settings
  FOR UPDATE USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- platform_ledger / cashback_grants / platform_admins : super-admin uniquement.
-- (Les écritures de compta sont insérées par le trigger SECURITY DEFINER.)
CREATE POLICY "platform_ledger_admin" ON public.platform_ledger
  FOR SELECT USING (public.is_super_admin());
CREATE POLICY "cashback_grants_admin" ON public.cashback_grants
  FOR SELECT USING (public.is_super_admin());
CREATE POLICY "platform_admins_select_admin" ON public.platform_admins
  FOR SELECT USING (public.is_super_admin());

-- merchants : le super-admin peut lire et modifier TOUS les commerçants
-- (taux + gel). S'ajoute aux policies "own" existantes (les policies sont OR).
CREATE POLICY "merchants_select_admin" ON public.merchants
  FOR SELECT USING (public.is_super_admin());
CREATE POLICY "merchants_update_admin" ON public.merchants
  FOR UPDATE USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- wallet_entries : le super-admin lit TOUTES les écritures (calcul des soldes
-- et dettes dans l'espace admin). S'ajoute à la policy "select own".
CREATE POLICY "wallet_entries_select_admin" ON public.wallet_entries
  FOR SELECT USING (public.is_super_admin());

-- =============================================================================
-- REQUÊTE DE VÉRIFICATION (à exécuter après, dans le SQL Editor) :
--
--   SELECT type, count(*), sum(amount_da) FROM public.wallet_entries GROUP BY type;
--   SELECT type, count(*), sum(amount_da) FROM public.platform_ledger GROUP BY type;
--   SELECT * FROM public.platform_settings;
--   SELECT public.merchant_balance(id), name FROM public.merchants;
-- =============================================================================
