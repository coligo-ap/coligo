-- =============================================================================
-- Coligo v3 - Migration 0013 : Frais de service 100 % plateforme + base
--   commission sur la part commerçant (pas sur le total client)
-- =============================================================================
-- Appliquée via `npm run db:push` (ou copiable dans le SQL Editor Supabase).
--
-- ⚠️ ARGENT RÉEL. Corrige la base de calcul des écritures :
--
--   AVANT (bug) :
--     commission = total_da * rate          -- inclut les frais de service
--     sale       = +total_da                -- inclut les frais de service
--   APRÈS :
--     merchant_amount = total_da - service_fee_da
--     commission      = merchant_amount * rate
--     sale            = +merchant_amount    -- ce qui revient vraiment au commerçant
--     platform_ledger += service_fee_income (100 % plateforme, jamais commerçant)
--
-- Spécificité CASH :
--   Le commerçant encaisse `total_da` en main propre. Il doit reverser à la
--   plateforme service_fee_da (collecté pour elle) ET la commission. Donc DEUX
--   écritures wallet négatives sur sa ledger : -service_fee et -commission.
--
-- Spécificité ONLINE :
--   Le client a payé la plateforme. Le commerçant reçoit en wallet le NET
--   (sale - commission), sans ligne service_fee (la plateforme ne le lui doit
--   pas, elle ne le reverse pas).
--
-- Compatibilité backfill :
--   Toutes les commandes existantes ont service_fee_da = 0 (cf. 0007), donc
--   merchant_amount = total_da. Les écritures déjà générées restent correctes.
--   Aucun re-calcul rétroactif n'est appliqué (principe snapshot — un taux ou
--   un calcul ne se rejoue jamais sur le passé).
-- =============================================================================

-- ============================================================================
-- 1. ENUMS : étendre wallet_entries et platform_ledger
-- ============================================================================
DO $$ BEGIN
  ALTER TYPE public.wallet_entry_type ADD VALUE IF NOT EXISTS 'service_fee';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.platform_ledger_type ADD VALUE IF NOT EXISTS 'service_fee_income';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 2. Trigger : nouvelle génération des écritures (base = merchant_amount)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.generate_wallet_entries_on_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_generate        BOOLEAN := false;
  v_comm_rate       NUMERIC(5, 4);
  v_cash_rate       NUMERIC(5, 4);
  v_fee_rate        NUMERIC(5, 4);
  v_merchant_amount INTEGER;
  v_service_fee     INTEGER;
  v_commission      INTEGER;
  v_cashback        INTEGER;
  v_chargily_fee    INTEGER;
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

  -- Base : ce qui revient REELLEMENT au commerçant (frais plateforme exclus).
  v_service_fee     := COALESCE(NEW.service_fee_da, 0);
  v_merchant_amount := NEW.total_da - v_service_fee;
  IF v_merchant_amount < 0 THEN
    v_merchant_amount := 0;  -- garde-fou : jamais négatif
  END IF;

  -- Résolution des taux (commerçant ?? global).
  IF NEW.payment_method = 'cash' THEN
    v_comm_rate := public.resolve_rate(NEW.merchant_id, 'commission_cash');
    v_cash_rate := public.resolve_rate(NEW.merchant_id, 'cashback_cash');
    v_fee_rate  := 0;
  ELSE
    v_comm_rate    := public.resolve_rate(NEW.merchant_id, 'commission_online');
    v_cash_rate    := public.resolve_rate(NEW.merchant_id, 'cashback_online');
    v_fee_rate     := public.resolve_rate(NEW.merchant_id, 'chargily_fee');
  END IF;

  v_commission   := round(v_merchant_amount * v_comm_rate)::INTEGER;
  v_cashback     := round(v_merchant_amount * v_cash_rate)::INTEGER;
  -- Chargily prélève sur le montant TOTAL réellement encaissé par la plateforme.
  v_chargily_fee := round(NEW.total_da * v_fee_rate)::INTEGER;

  -- Snapshot des taux sur la commande (ne re-déclenche pas le trigger : ces
  -- colonnes ne sont pas dans la clause OF).
  UPDATE public.orders
  SET commission_rate_applied   = v_comm_rate,
      cashback_rate_applied     = v_cash_rate,
      chargily_fee_rate_applied = v_fee_rate
  WHERE id = NEW.id;

  -- ----------------------------------------------------------------------------
  -- WALLET COMMERÇANT.
  -- ----------------------------------------------------------------------------
  IF NEW.payment_method = 'online' THEN
    -- Le commerçant reçoit le net : sale (+merchant_amount) puis -commission.
    INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da)
    VALUES (NEW.merchant_id, NEW.id, 'sale', v_merchant_amount)
    ON CONFLICT (order_id, type) DO NOTHING;
  ELSE
    -- CASH : le commerçant a encaissé total_da en main propre. Il DOIT reverser
    -- les frais de service (collectés pour la plateforme) — écriture négative.
    IF v_service_fee > 0 THEN
      INSERT INTO public.wallet_entries
        (merchant_id, order_id, type, amount_da, note)
      VALUES (NEW.merchant_id, NEW.id, 'service_fee', -v_service_fee,
              'Frais de service encaissés pour la plateforme')
      ON CONFLICT (order_id, type) DO NOTHING;
    END IF;
  END IF;

  -- Commission : négative dans les deux modes.
  INSERT INTO public.wallet_entries
    (merchant_id, order_id, type, amount_da, commission_rate)
  VALUES (NEW.merchant_id, NEW.id, 'commission', -v_commission, v_comm_rate)
  ON CONFLICT (order_id, type) DO NOTHING;

  -- ----------------------------------------------------------------------------
  -- COMPTA COLIGO (platform_ledger).
  -- ----------------------------------------------------------------------------
  -- Frais de service : 100 % plateforme, encaissés dans les deux modes.
  IF v_service_fee > 0 THEN
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NEW.id, 'service_fee_income', v_service_fee)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  -- Commission Coligo : positive (revenu).
  INSERT INTO public.platform_ledger (order_id, type, amount_da)
  VALUES (NEW.id, 'commission_income', v_commission)
  ON CONFLICT (order_id, type) DO NOTHING;

  IF NEW.payment_method = 'online' THEN
    IF v_chargily_fee > 0 THEN
      INSERT INTO public.platform_ledger (order_id, type, amount_da)
      VALUES (NEW.id, 'chargily_fee', -v_chargily_fee)
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

-- Le trigger lui-même (créé en 0010) reste valable : on a juste remplacé la
-- fonction sous-jacente. AFTER UPDATE OF (status, payment_status) → idempotent.

-- =============================================================================
-- REQUÊTE DE VÉRIFICATION (à exécuter après, dans le SQL Editor) :
--
--   -- Exemple : commande cash de 2 000 DA avec 200 DA de frais de service.
--   -- Attendu : sale 0 (cash), service_fee -200, commission -144 (8% × 1800).
--
--   -- 1. Voir les nouveaux types disponibles
--   SELECT unnest(enum_range(NULL::public.wallet_entry_type));
--   SELECT unnest(enum_range(NULL::public.platform_ledger_type));
--
--   -- 2. Soldes courants par commerçant
--   SELECT m.name, public.merchant_balance(m.id) AS solde_da,
--          (SELECT count(*) FROM public.wallet_entries WHERE merchant_id = m.id) AS ecritures
--   FROM public.merchants m;
--
--   -- 3. Compta plateforme par type
--   SELECT type, count(*), sum(amount_da) FROM public.platform_ledger GROUP BY type;
-- =============================================================================
