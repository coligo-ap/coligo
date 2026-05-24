-- =============================================================================
-- Coligo v3 - Migration 0017 : Wallet CLIENT (cashback) — prompt 17
-- =============================================================================
-- Appliquée via `npm run db:push`.
--
-- ⚠️ ARGENT RÉEL — les mêmes règles que le wallet commerçant s'appliquent :
--   - `customer_wallet_entries` est un ledger APPEND-ONLY. Solde = SUM(amount_da),
--     jamais stocké. Toute correction passe par une écriture inverse (adjustment).
--   - Montants ENTIERS en DA, signés.
--   - Idempotency : UNIQUE (order_id, type) — un même crédit/débit ne s'applique
--     qu'une fois par commande.
--   - RLS : le client LIT son ledger ; aucune INSERT/UPDATE/DELETE côté client
--     (les écritures sont créées exclusivement par les triggers SECURITY DEFINER).
--
-- Le champ `source` distingue 'cashback' (récompensé, non retirable) de 'topup'
-- (à venir = Coligo Pay rechargé via Chargily). Tout reste prêt pour l'ajout
-- futur sans refonte.
-- =============================================================================

-- ============================================================================
-- 1. ENUMS
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE public.customer_wallet_entry_type AS ENUM
    ('cashback_earned', 'cashback_spent', 'adjustment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.customer_wallet_source AS ENUM ('cashback', 'topup');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 2. ORDERS — snapshot du cashback utilisé à la création
-- ============================================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cashback_used_da INTEGER NOT NULL DEFAULT 0
    CHECK (cashback_used_da >= 0);

-- ============================================================================
-- 3. cashback_grants — lien explicite vers le customer_id (la version 0010
--    n'avait que customer_phone). Permet de rattacher le grant au ledger client.
-- ============================================================================
ALTER TABLE public.cashback_grants
  ADD COLUMN IF NOT EXISTS customer_id UUID
    REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cashback_grants_customer
  ON public.cashback_grants(customer_id);

-- ============================================================================
-- 4. TABLE: customer_wallet_entries (le grand livre client, append-only)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.customer_wallet_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  order_id     UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  type         public.customer_wallet_entry_type NOT NULL,
  source       public.customer_wallet_source NOT NULL DEFAULT 'cashback',
  amount_da    INTEGER NOT NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Idempotency : pas de double crédit/débit par commande.
  CONSTRAINT cwe_order_type_unique UNIQUE (order_id, type),

  -- Un ajustement DOIT être justifié (audit trail).
  CONSTRAINT cwe_adjustment_note_chk
    CHECK (type <> 'adjustment' OR (note IS NOT NULL AND btrim(note) <> ''))
);

CREATE INDEX IF NOT EXISTS idx_cwe_customer
  ON public.customer_wallet_entries(customer_id, created_at DESC);

-- ============================================================================
-- 5. Fonction solde cashback : SUM des écritures (cashback uniquement)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.customer_cashback_balance(p_customer_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(amount_da), 0)::INTEGER
  FROM public.customer_wallet_entries
  WHERE customer_id = p_customer_id
    AND source = 'cashback';
$$;

-- ============================================================================
-- 6. TRIGGER: cashback CRÉDITÉ à la complétion (status -> completed)
--    + cashback_grants passe à 'granted'. Idempotent via UNIQUE (order_id,type).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.grant_customer_cashback_on_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_amount INTEGER;
BEGIN
  IF NEW.status = 'completed'
     AND OLD.status IS DISTINCT FROM 'completed'
     AND NEW.customer_id IS NOT NULL THEN

    -- Le montant gagné = le cashback figé à la création (snapshot dans la
    -- commande). On NE recalcule PAS : le taux peut avoir changé depuis.
    v_amount := COALESCE(NEW.cashback_estimate_da, 0);

    IF v_amount > 0 THEN
      INSERT INTO public.customer_wallet_entries
        (customer_id, order_id, type, source, amount_da)
      VALUES
        (NEW.customer_id, NEW.id, 'cashback_earned', 'cashback', v_amount)
      ON CONFLICT (order_id, type) DO NOTHING;

      -- Marque le grant comme accordé (et complète le customer_id si absent).
      UPDATE public.cashback_grants
      SET status      = 'granted',
          customer_id = COALESCE(customer_id, NEW.customer_id)
      WHERE order_id = NEW.id
        AND status   = 'pending';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_grant_customer_cashback ON public.orders;
CREATE TRIGGER trigger_grant_customer_cashback
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.grant_customer_cashback_on_completion();

-- ============================================================================
-- 7. TRIGGER: cashback DÉPENSÉ à la création d'une commande
--    (déclenche AFTER INSERT — la Server Action `createOrder` n'a qu'à poser
--    `cashback_used_da` sur la commande, le ledger se crée tout seul.)
--
--    Garde-fou anti race-condition : on RECOMPUTE le solde courant et on
--    refuse l'insertion si le client tente de dépenser plus qu'il n'a.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.spend_customer_cashback_on_order_create()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  IF NEW.customer_id IS NOT NULL AND NEW.cashback_used_da > 0 THEN
    -- Le solde DOIT couvrir la dépense. On lit le solde APRÈS la création
    -- de la commande (mais avant insertion de l'écriture spent), donc égal
    -- au solde "avant" cette commande.
    SELECT public.customer_cashback_balance(NEW.customer_id) INTO v_balance;
    IF v_balance < NEW.cashback_used_da THEN
      RAISE EXCEPTION
        'Solde cashback insuffisant (% DA disponible, % DA demandé).',
        v_balance, NEW.cashback_used_da
        USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.customer_wallet_entries
      (customer_id, order_id, type, source, amount_da)
    VALUES
      (NEW.customer_id, NEW.id, 'cashback_spent', 'cashback',
       -NEW.cashback_used_da)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_spend_customer_cashback ON public.orders;
CREATE TRIGGER trigger_spend_customer_cashback
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.spend_customer_cashback_on_order_create();

-- ============================================================================
-- 8. TRIGGER: re-crédit (contre-passation) à l'annulation
--    Si une commande qui avait dépensé du cashback est annulée AVANT
--    complétion, on re-crédite le client. Idempotent via UNIQUE (order_id,
--    type='adjustment').
-- ============================================================================
CREATE OR REPLACE FUNCTION public.refund_customer_cashback_on_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'cancelled'
     AND OLD.status IS DISTINCT FROM 'cancelled'
     AND OLD.status IS DISTINCT FROM 'completed'
     AND NEW.customer_id IS NOT NULL
     AND COALESCE(NEW.cashback_used_da, 0) > 0 THEN

    INSERT INTO public.customer_wallet_entries
      (customer_id, order_id, type, source, amount_da, note)
    VALUES
      (NEW.customer_id, NEW.id, 'adjustment', 'cashback',
       NEW.cashback_used_da,
       'Annulation commande — re-crédit du cashback utilisé.')
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_refund_customer_cashback ON public.orders;
CREATE TRIGGER trigger_refund_customer_cashback
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.refund_customer_cashback_on_cancel();

-- ============================================================================
-- 9. ROW LEVEL SECURITY — lecture seule côté client
-- ============================================================================
ALTER TABLE public.customer_wallet_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cwe_select_own" ON public.customer_wallet_entries;
CREATE POLICY "cwe_select_own" ON public.customer_wallet_entries
  FOR SELECT
  USING (
    customer_id IN (
      SELECT id FROM public.customers WHERE user_id = auth.uid()
    )
  );

-- AUCUNE policy INSERT/UPDATE/DELETE → seuls les triggers DEFINER écrivent.

-- ============================================================================
-- 10. Backfill : pour les commandes DÉJÀ `completed` qui ont un
--     `cashback_estimate_da > 0` et un `customer_id` non null, créer
--     rétroactivement l'écriture `cashback_earned` (sinon les utilisateurs
--     ayant déjà passé des commandes au passé n'auraient pas leur cashback).
--     Idempotent (UNIQUE constraint).
-- ============================================================================
INSERT INTO public.customer_wallet_entries
  (customer_id, order_id, type, source, amount_da)
SELECT customer_id, id, 'cashback_earned', 'cashback', cashback_estimate_da
FROM public.orders
WHERE status = 'completed'
  AND customer_id IS NOT NULL
  AND COALESCE(cashback_estimate_da, 0) > 0
ON CONFLICT (order_id, type) DO NOTHING;

-- Marquer comme 'granted' les cashback_grants des commandes complétées
-- (et compléter le customer_id manquant).
UPDATE public.cashback_grants g
SET status      = 'granted',
    customer_id = COALESCE(g.customer_id, o.customer_id)
FROM public.orders o
WHERE g.order_id = o.id
  AND o.status = 'completed'
  AND g.status = 'pending';

-- =============================================================================
-- VÉRIF (à exécuter manuellement après la migration) :
--
--   -- Solde cashback d'un customer :
--   SELECT public.customer_cashback_balance('<customer_uuid>');
--
--   -- Historique :
--   SELECT created_at, type, source, amount_da, note
--   FROM public.customer_wallet_entries
--   WHERE customer_id = '<customer_uuid>'
--   ORDER BY created_at DESC;
-- =============================================================================
