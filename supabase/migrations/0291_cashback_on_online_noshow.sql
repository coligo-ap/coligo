-- =============================================================================
-- 0291 — Cashback accordé au client sur un NO-SHOW d'une commande PRÉPAYÉE EN LIGNE
-- =============================================================================
-- Décision produit (2026-06-30) : si un client a payé sa commande À 100% EN LIGNE
-- (carte / Chargily, payment_status='paid') puis ne répond pas à la livraison
-- (no-show), il GARDE quand même son cashback. Justification :
--   • Il a déjà tout payé sans être remboursé (produits + livraison) ; lui laisser
--     le cashback (≈3%) est équitable.
--   • Économiquement neutre : le commerçant est payé et Coligo a déjà prélevé sa
--     COMMISSION → le cashback est financé par cette commission, exactement comme
--     une commande livrée. Le cashback reste une paire SYMÉTRIQUE
--     plateforme(−)/client(+) → aucune réconciliation n'est déséquilibrée.
--   • Aucun exploit : le client perd 100% de son paiement pour ne récupérer que ~3%.
--
-- RÉSERVÉ au prépayé EN LIGNE. En ESPÈCES, le client n'a rien payé et est pénalisé
-- (règle Yassir, mig 0162) → toujours 0 cashback.
--
-- Le statut de la commande reste 'cancelled' + delivery_failed (historique honnête,
-- les stats de livraison ne comptent pas une livraison fictive) ; seul le crédit
-- cashback est ajouté.
--
-- Mécanique : on réutilise les DEUX triggers existants (aucun insert manuel) :
--   1) compute_order_cashback_da() ne met plus 0 sur échec QUAND online+paid.
--   2) grant_customer_cashback_on_completion() se déclenche aussi sur le no-show
--      online payé (crédit CLIENT).
--   • generate_wallet_entries_on_completion() tourne DÉJÀ sur ce chemin
--     (cancelled+failed+online+paid) et posera la charge plateforme + cashback_grants
--     via la fonction canonique corrigée → côté plateforme automatique.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Fonction canonique du cashback : exception échec → online prépayé.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_order_cashback_da(o public.orders)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_products   INTEGER;
  v_delivery   INTEGER;
  v_service    INTEGER;
  v_cash_rate  NUMERIC(5, 4);
  v_comm_rate  NUMERIC(5, 4);
  v_commission INTEGER;
  v_eligible   INTEGER;
  v_base       INTEGER;
  v_amount     INTEGER;
  v_is_tour    BOOLEAN;
  v_tour_rate  NUMERIC(5, 4);
  v_tour_comm  INTEGER := 0;
BEGIN
  -- Kill-switch super-admin : aucun cashback si la feature est coupée.
  IF public.feature_blocked('cashback') THEN
    RETURN 0;
  END IF;

  v_products := GREATEST(0, COALESCE(o.net_total_da, o.subtotal_da - o.discount_da));
  v_delivery := COALESCE(o.delivery_fee_da, 0);
  v_service  := COALESCE(o.service_fee_da, 0);

  IF o.payment_method = 'cash' THEN
    v_cash_rate := public.resolve_rate(o.merchant_id, 'cashback_cash');
    v_comm_rate := public.resolve_rate(o.merchant_id, 'commission_cash');
  ELSE
    v_cash_rate := public.resolve_rate(o.merchant_id, 'cashback_online');
    v_comm_rate := public.resolve_rate(o.merchant_id, 'commission_online');
  END IF;

  -- ch.4.2 — Assiette = produits NETS (après promo) + frais de LIVRAISON.
  --          JAMAIS le frais de service (marge pure Coligo).
  -- ch.4.1 — Anti-boucle : on retire la part réglée DEPUIS le solde cashback.
  --          Le topup/Coligo Pay (argent neuf) reste éligible.
  v_eligible := v_products + v_delivery;
  v_base     := GREATEST(0, v_eligible - GREATEST(0, COALESCE(o.cashback_used_da, 0)));
  v_amount   := round(v_base * v_cash_rate)::INTEGER;

  v_is_tour := (o.fulfillment_type = 'delivery' AND o.delivery_mode = 'tour');
  IF v_is_tour AND v_delivery > 0 THEN
    SELECT tour_delivery_commission_rate INTO v_tour_rate
      FROM public.platform_settings WHERE id = true;
    v_tour_comm := round(v_delivery * COALESCE(v_tour_rate, 0))::INTEGER;
  END IF;

  -- ch.4.4 — En COD la plateforme ABSORBE le cashback (réduction de
  -- driver_owes_platform) : plafonner à ce que Coligo encaisse réellement.
  IF o.payment_method = 'cash' THEN
    v_commission := round(v_products * v_comm_rate)::INTEGER;
    v_amount := LEAST(
      v_amount,
      (v_products / 2),
      GREATEST(v_commission + v_service +
               CASE WHEN v_is_tour THEN v_tour_comm ELSE v_delivery END, 0)
    );
  END IF;

  -- Échec de livraison → aucun cashback, SAUF commande PRÉPAYÉE EN LIGNE :
  -- (mig 0291) le client a déjà tout payé sans remboursement → il garde son
  -- cashback, financé par la commission déjà perçue. En ESPÈCES : 0.
  IF o.delivery_failed_at IS NOT NULL
     AND NOT (o.payment_method <> 'cash' AND o.payment_status = 'paid') THEN
    v_amount := 0;
  END IF;

  RETURN GREATEST(0, v_amount);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.compute_order_cashback_da(public.orders) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Crédit client : se déclenche à la complétion OU sur le no-show online payé.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_customer_cashback_on_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_amount   INTEGER;
  v_eligible BOOLEAN;
BEGIN
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Cas standard : commande validée (livrée/retirée).
  -- Cas no-show ONLINE PAYÉ (mig 0291) : la commande passe en 'cancelled' avec
  -- delivery_failed posé, mais le client prépayé garde son cashback.
  v_eligible :=
       (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
    OR (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled'
        AND NEW.delivery_failed_at IS NOT NULL
        AND NEW.payment_method <> 'cash'
        AND NEW.payment_status = 'paid');

  IF NOT v_eligible THEN
    RETURN NEW;
  END IF;

  -- ch.4 — assiette / anti-boucle / kill-switch centralisés.
  v_amount := public.compute_order_cashback_da(NEW);

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
$function$;
