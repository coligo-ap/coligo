-- =============================================================================
-- Coligo v3 - Migration 0019 : Wallet topup (Coligo Pay) — prompt 18 / étape B
-- =============================================================================
-- Appliquée via `npm run db:push`.
--
-- ⚠️ ARGENT RÉEL — étend le wallet client (0017) pour la RECHARGE Coligo Pay
-- via Chargily Pay. Suit la migration 0018 qui a ajouté les valeurs d'enum
-- `topup_credit` et `topup_spent` (en transaction séparée, contrainte Postgres).
--
-- Règles d'or :
--   - Le solde `topup` est SÉPARÉ du solde `cashback` (deux poches du même
--     ledger, distinguées par `source`). Le topup est de l'argent RÉEL
--     déposé par le client (CIB/EDAHABIA via Chargily).
--   - Idempotency du topup_credit via `chargily_checkout_id UNIQUE` —
--     l'order_id est NULL pour les recharges, donc le UNIQUE (order_id, type)
--     existant ne protège pas (NULL distincts en SQL).
--   - Plafond glissant configurable (anti-fraude MVP) : DA cumulés sur
--     30 jours, lu via `platform_settings.max_topup_da_per_30d`.
--   - Snapshot du topup utilisé figé sur la commande (`orders.topup_used_da`).
-- =============================================================================

-- ============================================================================
-- 1. ORDERS — snapshot du topup utilisé à la création
-- ============================================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS topup_used_da INTEGER NOT NULL DEFAULT 0
    CHECK (topup_used_da >= 0);

-- ============================================================================
-- 2. customer_wallet_entries — idempotency des recharges
-- ============================================================================
ALTER TABLE public.customer_wallet_entries
  ADD COLUMN IF NOT EXISTS chargily_checkout_id TEXT;

-- UNIQUE partiel : un même checkout Chargily ne crédite qu'UNE seule fois.
-- Partiel (WHERE) car les écritures non-topup (cashback) n'ont pas de
-- chargily_checkout_id et leurs NULL multiples doivent être autorisés.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cwe_chargily_checkout
  ON public.customer_wallet_entries(chargily_checkout_id)
  WHERE chargily_checkout_id IS NOT NULL;

-- ============================================================================
-- 3. platform_settings — plafond de recharge glissant
-- ============================================================================
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS max_topup_da_per_30d INTEGER NOT NULL DEFAULT 50000
    CHECK (max_topup_da_per_30d >= 0);

-- ============================================================================
-- 4. Fonction : solde topup (SUM des écritures topup)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.customer_topup_balance(p_customer_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(amount_da), 0)::INTEGER
  FROM public.customer_wallet_entries
  WHERE customer_id = p_customer_id
    AND source = 'topup';
$$;

-- ============================================================================
-- 5. Fonction : cumul rechargé sur 30 jours glissants (pour le plafond)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.customer_topup_credited_last_30d(p_customer_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(amount_da), 0)::INTEGER
  FROM public.customer_wallet_entries
  WHERE customer_id = p_customer_id
    AND source = 'topup'
    AND type = 'topup_credit'
    AND created_at >= now() - INTERVAL '30 days';
$$;

-- ============================================================================
-- 6. TRIGGER : topup DÉPENSÉ à la création d'une commande
--    Garde-fou anti race-condition (idem cashback) : on RECOMPUTE le solde
--    et on refuse l'insertion si le client veut dépenser plus qu'il n'a.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.spend_customer_topup_on_order_create()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  IF NEW.customer_id IS NOT NULL AND NEW.topup_used_da > 0 THEN
    SELECT public.customer_topup_balance(NEW.customer_id) INTO v_balance;
    IF v_balance < NEW.topup_used_da THEN
      RAISE EXCEPTION
        'Solde Coligo Pay insuffisant (% DA disponible, % DA demandé).',
        v_balance, NEW.topup_used_da
        USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.customer_wallet_entries
      (customer_id, order_id, type, source, amount_da)
    VALUES
      (NEW.customer_id, NEW.id, 'topup_spent', 'topup', -NEW.topup_used_da)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_spend_customer_topup ON public.orders;
CREATE TRIGGER trigger_spend_customer_topup
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.spend_customer_topup_on_order_create();

-- ============================================================================
-- 7. TRIGGER : re-crédit topup à l'annulation (contre-passation)
--    On utilise le type `topup_credit` avec un order_id non-null et un note
--    explicite. Comme le webhook n'émet JAMAIS un `topup_credit` avec un
--    order_id (recharge = order_id NULL), le UNIQUE (order_id, type) protège
--    bien contre les doublons d'annulation.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.refund_customer_topup_on_cancel()
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
     AND COALESCE(NEW.topup_used_da, 0) > 0 THEN

    INSERT INTO public.customer_wallet_entries
      (customer_id, order_id, type, source, amount_da, note)
    VALUES
      (NEW.customer_id, NEW.id, 'topup_credit', 'topup',
       NEW.topup_used_da,
       'Annulation commande — re-crédit du Coligo Pay utilisé.')
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_refund_customer_topup ON public.orders;
CREATE TRIGGER trigger_refund_customer_topup
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.refund_customer_topup_on_cancel();

-- =============================================================================
-- VÉRIF :
--   SELECT public.customer_topup_balance('<customer_uuid>');
--   SELECT public.customer_topup_credited_last_30d('<customer_uuid>');
--   SELECT max_topup_da_per_30d FROM public.platform_settings;
-- =============================================================================
