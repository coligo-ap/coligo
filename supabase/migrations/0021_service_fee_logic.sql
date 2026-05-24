-- =============================================================================
-- Coligo v3 - Migration 0021 : Logique service_fee + trigger wallet étendu
-- =============================================================================
-- ⚠️ ARGENT RÉEL — modifie la répartition financière à la complétion d'une
-- commande. Lecture obligatoire des règles avant tout débat.
--
-- MODÈLE (figé) :
--   products_da   = orders.subtotal_da - orders.discount_da   (prix produits)
--   service_fee   = orders.service_fee_da                     (snapshot)
--   total_da      = produits + service_fee - cashback - topup (ce que paie client)
--
--   commission    = round(products_da * commission_rate)      ← sur produits
--   cashback_earn = round(products_da * cashback_rate)        ← sur produits
--   chargily_fee  = round(total_da * chargily_fee_rate)       ← sur Chargily-encaissé
--
-- ÉCRITURES :
--
--   ONLINE (payment_status → 'paid') :
--     wallet_entries.sale            = +products_da              (commerçant)
--     wallet_entries.commission      = −commission               (commerçant doit)
--     platform_ledger.commission_income = +commission
--     platform_ledger.service_fee_income = +service_fee        ← NOUVEAU
--     platform_ledger.chargily_fee   = −chargily_fee
--     platform_ledger.cashback_expense = −cashback_earn (si >0)
--
--   CASH (status → 'completed') :
--     wallet_entries.commission       = −commission
--     wallet_entries.service_fee_owed = −service_fee           ← NOUVEAU
--       (le commerçant a encaissé service_fee EN ESPÈCES du client, mais
--        ces frais appartiennent à Coligo : dette dans son wallet)
--     platform_ledger.commission_income = +commission
--     platform_ledger.service_fee_income = +service_fee
--
-- Les commandes existantes ont service_fee_da = 0 → comportement INCHANGÉ pour
-- elles (aucune écriture service_fee_*, et commission/cashback restent calculés
-- comme avant puisque products_da == total_da quand service_fee=0).
--
-- ⚠️ CHANGEMENT BREAKING par rapport à 0010 :
--   - commission était calculée sur total_da → maintenant sur products_da.
--     Avant : si une commande avait service_fee=0, c'était équivalent.
--     Désormais : commission EXCLUT service_fee (sinon Coligo prendrait sa
--     commission sur ses propres frais — non-sens comptable).
-- =============================================================================

-- ============================================================================
-- 1. platform_settings : tiers de frais de service (JSONB)
--    Chaque tier : { up_to: <DA>, fee: <DA> }. Au-dessus du dernier `up_to`,
--    le frais est 0 (gratuit). Tiers triés du plus petit `up_to` au plus grand.
-- ============================================================================
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS service_fee_tiers JSONB NOT NULL DEFAULT
    '[{"up_to": 200, "fee": 30}, {"up_to": 500, "fee": 20}, {"up_to": 1000, "fee": 10}]'::jsonb;

-- ============================================================================
-- 2. Fonction : calcule le frais de service pour un total produits donné.
--    Renvoie 0 si products_da est nul/négatif (sécurité).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.compute_service_fee_da(p_products_da INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tiers JSONB;
  v_tier  JSONB;
BEGIN
  IF p_products_da IS NULL OR p_products_da <= 0 THEN
    RETURN 0;
  END IF;

  SELECT service_fee_tiers INTO v_tiers
  FROM public.platform_settings WHERE id = true;
  IF v_tiers IS NULL THEN RETURN 0; END IF;

  -- Premier tier dont `up_to` >= products_da gagne.
  FOR v_tier IN SELECT * FROM jsonb_array_elements(v_tiers) LOOP
    IF p_products_da < (v_tier->>'up_to')::INTEGER THEN
      RETURN (v_tier->>'fee')::INTEGER;
    END IF;
  END LOOP;

  -- Au-dessus du dernier seuil : gratuit.
  RETURN 0;
END;
$$;

-- ============================================================================
-- 3. Trigger wallet RECONSTRUIT — incorpore service_fee + recalcule la base
--    commission/cashback sur products_da (et non plus total_da).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.generate_wallet_entries_on_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_generate    BOOLEAN := false;
  v_comm_rate   NUMERIC(5, 4);
  v_cash_rate   NUMERIC(5, 4);
  v_fee_rate    NUMERIC(5, 4);
  v_products_da INTEGER;
  v_service_fee INTEGER;
  v_commission  INTEGER;
  v_cashback    INTEGER;
  v_chargily    INTEGER;
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

  -- products_da = base de calcul commission/cashback (exclut service_fee).
  v_products_da := GREATEST(0, NEW.subtotal_da - NEW.discount_da);
  v_service_fee := COALESCE(NEW.service_fee_da, 0);
  v_commission  := round(v_products_da * v_comm_rate)::INTEGER;
  v_cashback    := round(v_products_da * v_cash_rate)::INTEGER;
  v_chargily    := round(NEW.total_da * v_fee_rate)::INTEGER;

  -- Snapshot des taux figés (ne re-déclenche PAS ce trigger : ces colonnes ne
  -- sont pas dans la clause OF du trigger).
  UPDATE public.orders
  SET commission_rate_applied   = v_comm_rate,
      cashback_rate_applied     = v_cash_rate,
      chargily_fee_rate_applied = v_fee_rate
  WHERE id = NEW.id;

  -- ──────────────────────── WALLET COMMERÇANT ────────────────────────────
  -- En online : sale = part produits (pas service_fee, qui va à Coligo).
  -- En cash   : on n'écrit pas de "sale" (le commerçant a encaissé sur place
  --             sans passer par notre comptabilité interne).
  IF NEW.payment_method = 'online' THEN
    INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da)
    VALUES (NEW.merchant_id, NEW.id, 'sale', v_products_da)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  -- Commission (toujours), basée sur products_da.
  INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da, commission_rate)
  VALUES (NEW.merchant_id, NEW.id, 'commission', -v_commission, v_comm_rate)
  ON CONFLICT (order_id, type) DO NOTHING;

  -- En cash : le commerçant a touché les frais de service EN ESPÈCES du
  -- client. Ces frais appartiennent à Coligo → dette dans son wallet.
  IF NEW.payment_method = 'cash' AND v_service_fee > 0 THEN
    INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.merchant_id, NEW.id, 'service_fee', -v_service_fee,
            'Frais de service encaissés en espèces — à reverser à Coligo.')
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  -- ──────────────────────── COMPTA COLIGO ────────────────────────────────
  INSERT INTO public.platform_ledger (order_id, type, amount_da)
  VALUES (NEW.id, 'commission_income', v_commission)
  ON CONFLICT (order_id, type) DO NOTHING;

  IF v_service_fee > 0 THEN
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NEW.id, 'service_fee_income', v_service_fee)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  IF NEW.payment_method = 'online' THEN
    IF v_chargily > 0 THEN
      INSERT INTO public.platform_ledger (order_id, type, amount_da)
      VALUES (NEW.id, 'chargily_fee', -v_chargily)
      ON CONFLICT (order_id, type) DO NOTHING;
    END IF;
    IF v_cashback > 0 THEN
      INSERT INTO public.platform_ledger (order_id, type, amount_da)
      VALUES (NEW.id, 'cashback_expense', -v_cashback)
      ON CONFLICT (order_id, type) DO NOTHING;
      INSERT INTO public.cashback_grants (order_id, customer_phone, customer_id, amount_da)
      VALUES (NEW.id, NEW.customer_phone, NEW.customer_id, v_cashback)
      ON CONFLICT (order_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Le trigger lui-même reste tel quel (AFTER UPDATE OF status, payment_status).
-- On le redéclare par sécurité (DROP IF EXISTS + CREATE).
DROP TRIGGER IF EXISTS trigger_wallet_on_order_completed ON public.orders;
CREATE TRIGGER trigger_wallet_on_order_completed
  AFTER UPDATE OF status, payment_status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_wallet_entries_on_completion();

-- =============================================================================
-- VÉRIF :
--   SELECT public.compute_service_fee_da(150);   -- → 30
--   SELECT public.compute_service_fee_da(300);   -- → 20
--   SELECT public.compute_service_fee_da(700);   -- → 10
--   SELECT public.compute_service_fee_da(1200);  -- → 0
--
--   -- Récap par type d'écriture (le nouveau service_fee_owed / _income
--   -- apparaîtra après une commande passée AVEC frais > 0).
--   SELECT type, count(*), sum(amount_da) FROM public.wallet_entries GROUP BY type;
--   SELECT type, count(*), sum(amount_da) FROM public.platform_ledger GROUP BY type;
-- =============================================================================
