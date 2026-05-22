-- =============================================================================
-- Coligo v3 - Migration 0009 : Wallet commerçant (ledger en partie double)
-- =============================================================================
-- Appliquée via `npm run db:push` (ou copiable telle quelle dans le SQL Editor).
--
-- ⚠️ ARGENT RÉEL — règles NON négociables (cf. modèle financier) :
--   - `wallet_entries` est un grand livre APPEND-ONLY : on n'INSÈRE que des
--     écritures, jamais d'UPDATE/DELETE. Une correction = une écriture inverse.
--   - Le solde n'est JAMAIS stocké : il vaut TOUJOURS SUM(amount_da).
--   - Montants en DA ENTIERS signés (positif = entrée, négatif = sortie).
--   - Idempotency garantie par la base : UNIQUE (order_id, type).
--   - Le taux de commission est FIGÉ sur l'écriture `commission`.
--   - RLS : un commerçant ne voit QUE ses écritures ; AUCUNE écriture côté
--     client (elles sont créées par le trigger, en SECURITY DEFINER).
--
-- Numérotée 0009 (et non 0007 comme le brouillon) : 0007 et 0008 existent déjà.
-- =============================================================================

-- ============================================================================
-- 1. Taux de commission configurable par commerçant (défaut 5 %)
-- ============================================================================
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.05
    CHECK (commission_rate >= 0 AND commission_rate <= 1);

-- ============================================================================
-- 2. ENUMS
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE public.wallet_entry_type AS ENUM
    ('sale', 'commission', 'payout', 'adjustment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.payout_status AS ENUM
    ('pending', 'approved', 'paid', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 3. TABLE: wallet_entries (le grand livre, append-only)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.wallet_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  order_id        UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  type            public.wallet_entry_type NOT NULL,
  amount_da       INTEGER NOT NULL,
  commission_rate NUMERIC(5, 4),
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Idempotency : une commande ne génère ses écritures qu'une seule fois.
  -- (Les NULL d'order_id restent distincts → payout/adjustment non contraints.)
  CONSTRAINT wallet_entries_order_type_unique UNIQUE (order_id, type),

  -- Une écriture d'ajustement DOIT être justifiée.
  CONSTRAINT wallet_entries_adjustment_note_chk
    CHECK (type <> 'adjustment' OR (note IS NOT NULL AND btrim(note) <> ''))
);

CREATE INDEX IF NOT EXISTS idx_wallet_entries_merchant
  ON public.wallet_entries(merchant_id, created_at DESC);

-- ============================================================================
-- 4. TABLE: payout_requests (demandes de versement)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.payout_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id  UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  amount_da    INTEGER NOT NULL CHECK (amount_da > 0),
  status       public.payout_status NOT NULL DEFAULT 'pending',
  method       TEXT NOT NULL,
  details      TEXT,
  processed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payout_requests_merchant
  ON public.payout_requests(merchant_id, created_at DESC);

-- ============================================================================
-- 5. Génération automatique des écritures à la complétion d'une commande
--    SECURITY DEFINER : la fonction (propriétaire = admin) peut écrire dans le
--    ledger même si les écritures client sont interdites par RLS.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.generate_wallet_entries_on_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rate       NUMERIC(5, 4);
  v_commission INTEGER;
BEGIN
  -- Uniquement à la TRANSITION vers `completed`.
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    SELECT commission_rate INTO v_rate
    FROM public.merchants WHERE id = NEW.merchant_id;
    v_rate := COALESCE(v_rate, 0.05);
    v_commission := round(NEW.total_da * v_rate)::INTEGER;

    -- sale : +total payé par le client.
    INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da)
    VALUES (NEW.merchant_id, NEW.id, 'sale', NEW.total_da)
    ON CONFLICT (order_id, type) DO NOTHING;

    -- commission : -commission, avec le taux FIGÉ sur l'écriture.
    INSERT INTO public.wallet_entries
      (merchant_id, order_id, type, amount_da, commission_rate)
    VALUES (NEW.merchant_id, NEW.id, 'commission', -v_commission, v_rate)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_wallet_on_order_completed ON public.orders;
CREATE TRIGGER trigger_wallet_on_order_completed
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_wallet_entries_on_completion();

-- ============================================================================
-- 6. Fonction solde : SUM des écritures (le solde n'est jamais stocké)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.merchant_balance(p_merchant_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(amount_da), 0)::INTEGER
  FROM public.wallet_entries
  WHERE merchant_id = p_merchant_id;
$$;

-- ============================================================================
-- 7. ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE public.wallet_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;

-- wallet_entries : LECTURE de ses écritures uniquement. Aucune écriture client
-- (pas de policy INSERT/UPDATE/DELETE → tout est refusé sauf le trigger DEFINER).
CREATE POLICY "wallet_entries_select_own" ON public.wallet_entries
  FOR SELECT USING (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  );

-- payout_requests : le commerçant lit et crée (en `pending`) ses demandes.
-- La transition de statut (approved/paid/rejected) sera réservée à l'admin.
CREATE POLICY "payout_requests_select_own" ON public.payout_requests
  FOR SELECT USING (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  );

CREATE POLICY "payout_requests_insert_own" ON public.payout_requests
  FOR INSERT WITH CHECK (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
    AND status = 'pending'
  );

-- ============================================================================
-- 8. Backfill : écritures pour les commandes DÉJÀ `completed` (idempotent).
--    Le trigger ne fire qu'aux UPDATE ; les commandes complétées avant cette
--    migration (ou via seed) n'auraient sinon aucune écriture.
-- ============================================================================
INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da)
SELECT merchant_id, id, 'sale', total_da
FROM public.orders
WHERE status = 'completed'
ON CONFLICT (order_id, type) DO NOTHING;

INSERT INTO public.wallet_entries
  (merchant_id, order_id, type, amount_da, commission_rate)
SELECT o.merchant_id, o.id, 'commission',
       (-round(o.total_da * COALESCE(m.commission_rate, 0.05)))::INTEGER,
       COALESCE(m.commission_rate, 0.05)
FROM public.orders o
JOIN public.merchants m ON m.id = o.merchant_id
WHERE o.status = 'completed'
ON CONFLICT (order_id, type) DO NOTHING;
