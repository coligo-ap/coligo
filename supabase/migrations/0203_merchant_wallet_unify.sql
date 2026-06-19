-- ============================================================
-- 0203 — Commerçant : SOLDE UNIQUE dans la Coligo Pay
--
-- Objectif produit : le commerçant ne voit plus « Coligo vous doit / vous
-- devez » séparément ; tout (revenus en ligne/cashback nets, commissions cash
-- débitées, recharges, versements) se reflète dans UN seul solde : sa Coligo
-- Pay (operator_wallets).
--
-- Approche MIROIR (sûre) : on NE touche PAS au moteur de trésorerie audité
-- (generate_wallet_entries_on_completion + invariants résidus=0). À la place,
-- chaque écriture de `wallet_entries` (revenu net, commission, cashback,
-- versement…) est REFLÉTÉE à l'identique dans le portefeuille opérateur du
-- commerçant. Le solde Coligo Pay = recharges + (revenus − commissions) =
-- exactement « ce que Coligo te doit » + ton prépayé. Idempotent (un miroir par
-- ligne finance). Backfill des écritures existantes inclus.
-- ============================================================

-- 1) Nouveau type d'écriture opérateur : miroir de la finance commerçant.
ALTER TABLE public.operator_wallet_entries
  DROP CONSTRAINT IF EXISTS operator_wallet_entries_type_check;
ALTER TABLE public.operator_wallet_entries
  ADD CONSTRAINT operator_wallet_entries_type_check CHECK (type IN (
    'topup_chargily', 'topup_manual', 'topup_partner',
    'recharge_sale', 'bonus', 'fee_debit', 'service_fee', 'cod_settle',
    'adjustment', 'finance_mirror'));

-- 2) Fonction miroir : reflète une ligne wallet_entries dans la Coligo Pay.
CREATE OR REPLACE FUNCTION public.trg_mirror_wallet_entry_to_operator()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_wallet UUID;
BEGIN
  v_wallet := public.ensure_operator_wallet('merchant', NEW.merchant_id);
  IF v_wallet IS NULL THEN RETURN NEW; END IF;
  -- idempotence : une ligne finance ne se reflète qu'une fois.
  INSERT INTO public.operator_wallet_entries
    (wallet_id, type, amount_da, ref_id, client_operation_id, note)
  SELECT v_wallet, 'finance_mirror', NEW.amount_da, NEW.order_id,
         'we:' || NEW.id, NEW.type::text
  WHERE NOT EXISTS (
    SELECT 1 FROM public.operator_wallet_entries
    WHERE wallet_id = v_wallet AND client_operation_id = 'we:' || NEW.id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_wallet_entry ON public.wallet_entries;
CREATE TRIGGER trg_mirror_wallet_entry
  AFTER INSERT ON public.wallet_entries
  FOR EACH ROW EXECUTE FUNCTION public.trg_mirror_wallet_entry_to_operator();

-- 3) Backfill : reflète toutes les écritures finance déjà existantes (idempotent).
INSERT INTO public.operator_wallet_entries
  (wallet_id, type, amount_da, ref_id, client_operation_id, note)
SELECT public.ensure_operator_wallet('merchant', we.merchant_id),
       'finance_mirror', we.amount_da, we.order_id,
       'we:' || we.id, we.type::text
FROM public.wallet_entries we
WHERE NOT EXISTS (
  SELECT 1 FROM public.operator_wallet_entries oe
  WHERE oe.client_operation_id = 'we:' || we.id
);
