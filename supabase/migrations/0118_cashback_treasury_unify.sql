-- =============================================================================
-- 0118 — Cashback : UNE seule source de vérité (crédit client ≡ dépense plateforme)
-- =============================================================================
-- BUG TRÉSORERIE corrigé (2026-06-09) :
--   Avant, deux montants DIVERGENTS coexistaient pour le même cashback :
--     • crédit au wallet CLIENT      = orders.cashback_estimate_da
--       = round(panier × 3%) CODÉ EN DUR côté checkout (actions.ts).
--     • dépense TRÉSORERIE plateforme = round(panier × resolve_rate(cashback_*))
--       = TAUX CONFIGURABLE par marchand (trigger 0077/0103) ou réduction de
--         `driver_owes_platform` (trigger 0116 pour le COD livreur).
--   Si un marchand surchargeait son taux, ou si le défaut plateforme ≠ 3%, le
--   PASSIF client ne réconciliait plus avec la DÉPENSE plateforme → fuite.
--
-- CORRECTIF : le crédit client est désormais calculé avec EXACTEMENT la même
-- formule (et le même plafond COD) que le financement plateforme :
--     base   = panier NET (net_total_da, COALESCE subtotal − discount)
--     taux   = resolve_rate(merchant, cashback_cash|cashback_online)
--     COD    = plafonné comme 0116 : LEAST(montant, panier/2, comm+S+livraison)
-- `cashback_estimate_da` reste une simple ESTIMATION d'AFFICHAGE (non versée).
-- Le snapshot réel versé est figé dans orders.cashback_da.
--
-- Rappel d'assiette (RECO produit, inchangé) : le cashback se gagne sur le
-- PANIER PRODUITS uniquement — JAMAIS sur les frais de service ni la livraison
-- (ce serait payer du cashback sur l'argent du livreur/commerçant). La dépense
-- (panier × 3%) reste financée contre la commission (panier × 8%) → marge nette.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.grant_customer_cashback_on_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_products     INTEGER;
  v_cash_rate    NUMERIC(5, 4);
  v_comm_rate    NUMERIC(5, 4);
  v_amount       INTEGER;
  v_commission   INTEGER;
  v_service_fee  INTEGER;
  v_delivery_fee INTEGER;
BEGIN
  IF NOT (NEW.status = 'completed'
          AND OLD.status IS DISTINCT FROM 'completed'
          AND NEW.customer_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  -- Assiette = panier NET (après promo), figé. Exclut frais service/livraison.
  v_products := GREATEST(0, COALESCE(NEW.net_total_da, NEW.subtotal_da - NEW.discount_da));

  IF NEW.payment_method = 'cash' THEN
    v_cash_rate := public.resolve_rate(NEW.merchant_id, 'cashback_cash');
    v_comm_rate := public.resolve_rate(NEW.merchant_id, 'commission_cash');
  ELSE
    v_cash_rate := public.resolve_rate(NEW.merchant_id, 'cashback_online');
    v_comm_rate := public.resolve_rate(NEW.merchant_id, 'commission_online');
  END IF;

  v_amount := round(v_products * v_cash_rate)::INTEGER;

  -- En COD, le cashback est ABSORBÉ par la plateforme via la réduction de
  -- driver_owes_platform (0116), avec ce plafond exact. On l'applique au crédit
  -- client pour que crédit == montant absorbé (réconciliation parfaite).
  IF NEW.payment_method = 'cash' THEN
    v_commission   := round(v_products * v_comm_rate)::INTEGER;
    v_service_fee  := COALESCE(NEW.service_fee_da, 0);
    v_delivery_fee := COALESCE(NEW.delivery_fee_da, 0);
    v_amount := LEAST(
      v_amount,
      (v_products / 2),
      GREATEST(v_commission + v_service_fee + v_delivery_fee, 0)
    );
  END IF;

  IF v_amount > 0 THEN
    INSERT INTO public.customer_wallet_entries
      (customer_id, order_id, type, source, amount_da)
    VALUES
      (NEW.customer_id, NEW.id, 'cashback_earned', 'cashback', v_amount)
    ON CONFLICT (order_id, type) DO NOTHING;

    -- Snapshot RÉEL versé (source de vérité pour la compta/affichage).
    UPDATE public.orders SET cashback_da = v_amount WHERE id = NEW.id;

    UPDATE public.cashback_grants
       SET status      = 'granted',
           customer_id = COALESCE(customer_id, NEW.customer_id)
     WHERE order_id = NEW.id
       AND status   = 'pending';
  END IF;

  RETURN NEW;
END;
$$;

-- Le trigger lui-même (AFTER UPDATE OF status) est inchangé (déjà posé en 0017).
