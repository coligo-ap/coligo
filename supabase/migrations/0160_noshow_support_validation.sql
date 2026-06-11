-- =============================================================================
-- 0160 — No-show COD façon Yassir : remboursement d'avance VALIDÉ PAR LE SUPPORT
-- =============================================================================
-- Enquête terrain (modèle Yassir Food) : le livreur avance l'argent de la
-- commande au commerçant au pickup (P − commission), puis se rembourse auprès
-- du client à la livraison. Si le client ne répond pas :
--
--   • Paiement EN LIGNE : tant pis pour le client — la commande est déjà payée.
--     Le commerçant et la plateforme sont crédités comme pour une complétion
--     (le client n'est pas remboursé), le livreur garde son indemnité de course.
--
--   • Paiement ESPÈCES : le livreur peut être remboursé du montant avancé,
--     mais SEULEMENT après validation du support. Le support choisit le sort
--     de la marchandise : retour au commerçant (qui rend l'avance en main
--     propre — aucune écriture), garder ou donner (la plateforme rembourse le
--     livreur via le ledger). Le support surveille les abus (historique des
--     réclamations par livreur).
--
-- Remplace le comportement 0114/0116 où l'avance était « rendue physiquement
-- au livreur » automatiquement, sans contrôle.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Réclamations de remboursement d'avance (une par commande no-show espèces).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.driver_refund_claims (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID NOT NULL UNIQUE REFERENCES public.orders(id)    ON DELETE CASCADE,
  driver_id      UUID NOT NULL REFERENCES public.drivers(id)          ON DELETE CASCADE,
  merchant_id    UUID REFERENCES public.merchants(id)                 ON DELETE SET NULL,
  customer_id    UUID REFERENCES public.customers(id)                 ON DELETE SET NULL,
  advance_da     INTEGER NOT NULL CHECK (advance_da >= 0),  -- avance commerçant (P − commission)
  reason         TEXT NOT NULL DEFAULT 'no_show',           -- 'no_show' | 'refused'
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected')),
  -- Sort de la marchandise décidé par le support (obligatoire si approuvé) :
  --   'return_to_merchant' : le livreur retourne la commande, le commerçant lui
  --                          rend l'avance en main propre (aucune écriture).
  --   'driver_keeps'       : le livreur garde la commande, la plateforme le
  --                          rembourse (driver_advance_refund).
  --   'give_away'          : la commande est donnée, la plateforme rembourse.
  goods_decision TEXT CHECK (goods_decision IN ('return_to_merchant', 'driver_keeps', 'give_away')),
  admin_note     TEXT,
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_refund_claims_status
  ON public.driver_refund_claims (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_refund_claims_driver
  ON public.driver_refund_claims (driver_id, created_at DESC);

ALTER TABLE public.driver_refund_claims ENABLE ROW LEVEL SECURITY;

-- Le livreur voit ses propres réclamations (statut + consigne marchandise).
-- Le support passe par le service role (bypass RLS).
DROP POLICY IF EXISTS driver_refund_claims_select_own ON public.driver_refund_claims;
CREATE POLICY driver_refund_claims_select_own ON public.driver_refund_claims
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.drivers d
     WHERE d.id = driver_refund_claims.driver_id AND d.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- 2. driver_report_no_show — reprend 0116 + :
--    a) ESPÈCES (express custodian) : crée la réclamation d'avance (pending),
--       AUCUN remboursement automatique.
--    b) ONLINE PAYÉ : le crédit commerçant/plateforme est déclenché par le
--       trigger wallet étendu (§3) — rien à faire ici de plus.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_report_no_show(
  p_order_id            UUID,
  p_reason              TEXT DEFAULT 'no_show',
  p_client_operation_id TEXT DEFAULT NULL
) RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user         UUID := auth.uid();
  v_driver_id    UUID;
  v_order        public.orders%ROWTYPE;
  v_s            public.platform_settings%ROWTYPE;
  v_delivery_fee INTEGER;
  v_driver_fee   INTEGER;
  v_driver_net   INTEGER;
  v_reason       TEXT;
  v_wait         INTEGER;
  v_required_min INTEGER;
  v_client_replied BOOLEAN;
  v_liability    INTEGER;
  v_recovered    INTEGER := 0;
  v_take         INTEGER;
  v_bal          INTEGER;
  v_label        TEXT;
  v_products     INTEGER;
  v_comm_rate    NUMERIC(5, 4);
  v_advance      INTEGER;
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = v_user;
  IF v_driver_id IS NULL THEN ok := false; reason := 'not_a_driver'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN ok := false; reason := 'order_not_found'; RETURN NEXT; RETURN; END IF;
  IF v_order.fulfillment_type <> 'delivery' THEN
    ok := false; reason := 'not_a_delivery'; RETURN NEXT; RETURN; END IF;
  IF v_order.delivery_driver_id IS NULL OR v_order.delivery_driver_id <> v_driver_id THEN
    ok := false; reason := 'not_attributed_to_you'; RETURN NEXT; RETURN; END IF;
  IF v_order.status IN ('completed', 'cancelled') THEN
    ok := false; reason := 'already_closed'; RETURN NEXT; RETURN; END IF;
  IF v_order.delivery_picked_up_at IS NULL THEN
    ok := false; reason := 'not_picked_up'; RETURN NEXT; RETURN; END IF;
  -- Le livreur doit être ARRIVÉ pour lancer le minuteur.
  IF v_order.delivery_arrived_at IS NULL THEN
    ok := false; reason := 'not_arrived'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_s FROM public.platform_settings WHERE id = true;
  v_wait := GREATEST(1, COALESCE(v_s.noshow_wait_min, 8));

  -- Le client a-t-il répondu en messagerie depuis l'arrivée ? Sinon on double
  -- la fenêtre (il ne trouve peut-être juste pas le livreur dehors).
  SELECT EXISTS (
    SELECT 1 FROM public.order_messages m
     WHERE m.order_id = p_order_id
       AND m.sender_role = 'customer'
       AND m.created_at > v_order.delivery_arrived_at
  ) INTO v_client_replied;
  v_required_min := CASE WHEN v_client_replied THEN v_wait ELSE v_wait * 2 END;

  IF now() < v_order.delivery_arrived_at + make_interval(mins => v_required_min) THEN
    ok := false; reason := 'too_early'; RETURN NEXT; RETURN;
  END IF;

  v_reason := COALESCE(NULLIF(btrim(p_reason), ''), 'no_show');
  IF v_reason NOT IN ('no_show', 'refused') THEN v_reason := 'no_show'; END IF;

  v_delivery_fee := COALESCE(v_order.delivery_fee_da, 0);
  IF v_delivery_fee <= 0 THEN
    v_driver_fee := 0;
  ELSE
    v_driver_fee := LEAST(
      v_delivery_fee,
      GREATEST(v_s.driver_fee_min_da,
        LEAST(round(v_delivery_fee * v_s.driver_fee_rate)::INTEGER,
              round(v_delivery_fee * v_s.driver_fee_cap_rate)::INTEGER)));
  END IF;
  v_driver_net := v_delivery_fee - v_driver_fee;

  -- 1) Commande annulée + tracée. delivery_failed_at posé →
  --    • les triggers refund cashback/topup SKIPPENT (pas de remboursement) ;
  --    • le trigger wallet (§3) crédite commerçant/plateforme si ONLINE PAYÉ
  --      (« tant pis pour le client », la commande est déjà payée).
  UPDATE public.orders
     SET status                  = 'cancelled',
         delivery_failed_at      = now(),
         delivery_failed_reason  = v_reason,
         driver_fee_rate_applied = v_s.driver_fee_rate,
         driver_fee_da           = v_driver_fee,
         driver_net_da           = v_driver_net
   WHERE id = p_order_id;

  INSERT INTO public.order_events (order_id, from_status, to_status, client_operation_id, note)
  VALUES (p_order_id, v_order.status, 'cancelled', NULL,
          'driver_no_show:' || v_reason || ':' || COALESCE(p_client_operation_id, ''))
  ON CONFLICT DO NOTHING;

  -- 2) Indemnité livreur : UNE course (driver_net), « à recevoir » au relevé.
  IF v_driver_net > 0 THEN
    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (v_driver_id, v_order.merchant_id, p_order_id, 'driver_payout', v_driver_net,
            'Indemnité course no-show (client absent/refus).')
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  -- 2bis) ESPÈCES (custodian express) : le livreur a avancé (P − commission) au
  --       commerçant au pickup. Réclamation PENDING — remboursée seulement après
  --       validation du support (qui décide aussi du sort de la marchandise).
  IF v_order.payment_method = 'cash' AND v_order.delivery_mode = 'express' THEN
    v_products  := GREATEST(0, COALESCE(v_order.net_total_da, v_order.subtotal_da - v_order.discount_da));
    v_comm_rate := public.resolve_rate(v_order.merchant_id, 'commission_cash');
    v_advance   := GREATEST(v_products - round(v_products * v_comm_rate)::INTEGER, 0);
    IF v_advance > 0 THEN
      INSERT INTO public.driver_refund_claims
        (order_id, driver_id, merchant_id, customer_id, advance_da, reason)
      VALUES (p_order_id, v_driver_id, v_order.merchant_id, v_order.customer_id, v_advance, v_reason)
      ON CONFLICT (order_id) DO NOTHING;
    END IF;
  END IF;

  -- 3) Prélèvement client : on récupère la course (D) sur cashback PUIS Coligo
  --    Pay, si dispo. Aucune créance : ce qui reste non couvert déclenche juste
  --    le drapeau pénalité (frais de service relevés ≤ plafond sur 1 commande).
  IF v_order.customer_id IS NOT NULL THEN
    v_liability := GREATEST(0, v_delivery_fee);
    v_label := 'Pénalité no-show — commande ' || COALESCE(v_order.order_number, left(v_order.id::text, 8));

    -- cashback d'abord
    v_bal := COALESCE(public.customer_cashback_balance(v_order.customer_id), 0);
    v_take := LEAST(GREATEST(v_liability - v_recovered, 0), GREATEST(v_bal, 0));
    IF v_take > 0 THEN
      INSERT INTO public.customer_wallet_entries
        (customer_id, order_id, type, source, amount_da, note)
      VALUES (v_order.customer_id, NULL, 'adjustment', 'cashback', -v_take, v_label);
      v_recovered := v_recovered + v_take;
    END IF;

    -- puis Coligo Pay (topup)
    v_bal := COALESCE(public.customer_topup_balance(v_order.customer_id), 0);
    v_take := LEAST(GREATEST(v_liability - v_recovered, 0), GREATEST(v_bal, 0));
    IF v_take > 0 THEN
      INSERT INTO public.customer_wallet_entries
        (customer_id, order_id, type, source, amount_da, note)
      VALUES (v_order.customer_id, NULL, 'adjustment', 'topup', -v_take, v_label);
      v_recovered := v_recovered + v_take;
    END IF;

    PERFORM set_config('app.allow_risk_update', 'on', true);
    UPDATE public.customers
       SET noshow_count   = noshow_count + 1,
           -- pénalité prochaine commande seulement si pas tout récupéré
           noshow_pending = noshow_pending OR (v_liability - v_recovered) > 0
     WHERE id = v_order.customer_id;
  END IF;

  -- 4) Express : libérer le livreur.
  IF v_order.delivery_mode = 'express' THEN
    UPDATE public.driver_availability
       SET status = 'available', current_order_id = NULL
     WHERE current_order_id = p_order_id;
  END IF;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_report_no_show(UUID, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. generate_wallet_entries_on_completion — reprend 0128 + no-show ONLINE PAYÉ :
--    une commande online payée annulée pour client absent est traitée
--    financièrement comme une complétion (le client n'est pas remboursé,
--    commerçant + plateforme crédités). PAS de cashback gagné sur un no-show.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_wallet_entries_on_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_generate     BOOLEAN := false;
  v_comm_rate    NUMERIC(5, 4);
  v_cash_rate    NUMERIC(5, 4);
  v_fee_rate     NUMERIC(5, 4);
  v_products_da  INTEGER;
  v_service_fee  INTEGER;
  v_commission   INTEGER;
  v_cashback     INTEGER;
  v_chargily     INTEGER;
  v_is_tour      BOOLEAN;
  v_delivery_fee INTEGER;
  v_tour_rate    NUMERIC(5, 4);
  v_tour_comm    INTEGER := 0;
  v_redeemed     INTEGER;
BEGIN
  -- Crédit à la COMPLÉTION (fulfillment), cash ET online. Online : le paiement
  -- est une condition NÉCESSAIRE (gating 0068) mais pas suffisante — sinon une
  -- commande payée puis annulée créditerait le commerçant.
  v_generate := (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed');

  -- No-show « tant pis pour le client » (0160) : online PAYÉ + client absent →
  -- la commande annulée crédite quand même commerçant/plateforme (le client a
  -- payé et n'est pas remboursé — triggers refund skippés par delivery_failed_at).
  IF NOT v_generate
     AND NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled'
     AND NEW.delivery_failed_at IS NOT NULL
     AND NEW.payment_method <> 'cash' THEN
    v_generate := true;
  END IF;

  IF v_generate AND NEW.payment_method <> 'cash'
     AND NEW.payment_status <> 'paid' THEN
    v_generate := false;   -- sécurité : online non encaissé → on ne crédite pas.
  END IF;

  IF NOT v_generate THEN
    RETURN NEW;
  END IF;

  -- COD EXPRESS : custodian livreur (delivery_ledger / 0124). Pas d'écriture ici.
  IF NEW.payment_method = 'cash'
     AND NEW.fulfillment_type = 'delivery'
     AND NEW.delivery_driver_id IS NOT NULL
     AND NEW.delivery_mode = 'express' THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_method = 'cash' THEN
    v_comm_rate := public.resolve_rate(NEW.merchant_id, 'commission_cash');
    v_cash_rate := public.resolve_rate(NEW.merchant_id, 'cashback_cash');
    v_fee_rate  := 0;
  ELSE
    v_comm_rate := public.resolve_rate(NEW.merchant_id, 'commission_online');
    v_cash_rate := public.resolve_rate(NEW.merchant_id, 'cashback_online');
    v_fee_rate  := public.resolve_rate(NEW.merchant_id, 'chargily_fee');
  END IF;

  v_products_da := GREATEST(0, COALESCE(NEW.net_total_da, NEW.subtotal_da - NEW.discount_da));
  v_service_fee := COALESCE(NEW.service_fee_da, 0);
  v_delivery_fee := COALESCE(NEW.delivery_fee_da, 0);
  v_commission  := round(v_products_da * v_comm_rate)::INTEGER;
  v_chargily    := round(NEW.total_da * v_fee_rate)::INTEGER;
  v_redeemed    := GREATEST(0, COALESCE(NEW.cashback_used_da, 0) + COALESCE(NEW.topup_used_da, 0));

  v_cashback := round(v_products_da * v_cash_rate)::INTEGER;
  IF NEW.payment_method = 'cash' THEN
    v_cashback := LEAST(v_cashback,
                        (v_products_da / 2),
                        GREATEST(v_commission + v_service_fee + v_delivery_fee, 0));
  END IF;
  -- Pas de cashback gagné sur une livraison échouée (no-show).
  IF NEW.delivery_failed_at IS NOT NULL THEN
    v_cashback := 0;
  END IF;

  v_is_tour := (NEW.fulfillment_type = 'delivery' AND NEW.delivery_mode = 'tour');
  IF v_is_tour AND v_delivery_fee > 0 THEN
    SELECT tour_delivery_commission_rate INTO v_tour_rate FROM public.platform_settings WHERE id = true;
    v_tour_comm := round(v_delivery_fee * COALESCE(v_tour_rate, 0))::INTEGER;
  END IF;

  UPDATE public.orders
  SET commission_rate_applied              = v_comm_rate,
      cashback_rate_applied                = v_cash_rate,
      chargily_fee_rate_applied            = v_fee_rate,
      commission_da                        = v_commission,
      tour_delivery_commission_rate_applied= CASE WHEN v_is_tour THEN COALESCE(v_tour_rate, 0) ELSE tour_delivery_commission_rate_applied END,
      tour_delivery_commission_da          = CASE WHEN v_is_tour THEN v_tour_comm ELSE tour_delivery_commission_da END
  WHERE id = NEW.id;

  IF NEW.payment_method = 'online' THEN
    INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da)
    VALUES (NEW.merchant_id, NEW.id, 'sale', v_products_da)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da, commission_rate)
  VALUES (NEW.merchant_id, NEW.id, 'commission', -v_commission, v_comm_rate)
  ON CONFLICT (order_id, type) DO NOTHING;

  IF NEW.payment_method = 'cash' AND v_service_fee > 0 THEN
    INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.merchant_id, NEW.id, 'service_fee', -v_service_fee,
            'Frais de service encaissés en espèces — à reverser à Coligo.')
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  IF NEW.payment_method = 'cash' AND v_redeemed > 0 THEN
    INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.merchant_id, NEW.id, 'wallet_redemption', v_redeemed,
            'Cashback / Coligo Pay du client, reversé par Coligo.')
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  IF v_is_tour THEN
    IF NEW.payment_method = 'online' AND v_delivery_fee > 0 THEN
      INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da, note)
      VALUES (NEW.merchant_id, NEW.id, 'delivery_revenue', v_delivery_fee,
              'Frais de livraison tournée encaissés pour votre compte.')
      ON CONFLICT (order_id, type) DO NOTHING;
    END IF;
    IF v_tour_comm > 0 THEN
      INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da, note)
      VALUES (NEW.merchant_id, NEW.id, 'tour_delivery_commission', -v_tour_comm,
              'Commission Coligo sur la livraison tournée.')
      ON CONFLICT (order_id, type) DO NOTHING;
    END IF;
  END IF;

  INSERT INTO public.platform_ledger (order_id, type, amount_da)
  VALUES (NEW.id, 'commission_income', v_commission)
  ON CONFLICT (order_id, type) DO NOTHING;

  IF v_service_fee > 0 THEN
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NEW.id, 'service_fee_income', v_service_fee)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  IF v_tour_comm > 0 THEN
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NEW.id, 'tour_delivery_commission_income', v_tour_comm)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  IF NEW.payment_method = 'online' AND v_chargily > 0 THEN
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

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. admin_resolve_driver_refund_claim — le support tranche une réclamation.
--    Exécutable uniquement via le service role (écran super-admin).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_resolve_driver_refund_claim(
  p_claim_id       UUID,
  p_approve        BOOLEAN,
  p_goods_decision TEXT DEFAULT NULL,   -- requis si approuvé
  p_note           TEXT DEFAULT NULL,
  p_admin_email    TEXT DEFAULT NULL
) RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claim public.driver_refund_claims%ROWTYPE;
BEGIN
  SELECT * INTO v_claim FROM public.driver_refund_claims WHERE id = p_claim_id FOR UPDATE;
  IF v_claim.id IS NULL THEN ok := false; reason := 'claim_not_found'; RETURN NEXT; RETURN; END IF;
  IF v_claim.status <> 'pending' THEN ok := false; reason := 'already_resolved'; RETURN NEXT; RETURN; END IF;

  IF NOT p_approve THEN
    UPDATE public.driver_refund_claims
       SET status = 'rejected', admin_note = p_note, resolved_at = now()
     WHERE id = p_claim_id;

    INSERT INTO public.admin_audit_log (admin_email, action, target_kind, target_id, note)
    VALUES (p_admin_email, 'reject_driver_refund', 'driver', v_claim.driver_id,
            'Réclamation avance no-show refusée — ' || COALESCE(p_note, 'sans note'));

    ok := true; reason := NULL; RETURN NEXT; RETURN;
  END IF;

  IF p_goods_decision IS NULL
     OR p_goods_decision NOT IN ('return_to_merchant', 'driver_keeps', 'give_away') THEN
    ok := false; reason := 'goods_decision_required'; RETURN NEXT; RETURN;
  END IF;

  -- Marchandise NON retournée → la plateforme rembourse l'avance au livreur
  -- (« à recevoir » au relevé). Retour au commerçant → remboursement en main
  -- propre contre marchandise, aucune écriture.
  IF p_goods_decision <> 'return_to_merchant' AND v_claim.advance_da > 0 THEN
    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (v_claim.driver_id, v_claim.merchant_id, v_claim.order_id,
            'driver_advance_refund', v_claim.advance_da,
            'Remboursement avance no-show validé par le support (' || p_goods_decision || ').')
    ON CONFLICT (order_id, type) DO NOTHING;

    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (v_claim.order_id, 'noshow_advance_expense', -v_claim.advance_da)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  UPDATE public.driver_refund_claims
     SET status = 'approved', goods_decision = p_goods_decision,
         admin_note = p_note, resolved_at = now()
   WHERE id = p_claim_id;

  INSERT INTO public.admin_audit_log (admin_email, action, target_kind, target_id, note)
  VALUES (p_admin_email, 'approve_driver_refund', 'driver', v_claim.driver_id,
          'Avance no-show ' || v_claim.advance_da || ' DA — ' || p_goods_decision
          || COALESCE(' — ' || p_note, ''));

  ok := true; reason := NULL; RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_resolve_driver_refund_claim(UUID, BOOLEAN, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_resolve_driver_refund_claim(UUID, BOOLEAN, TEXT, TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Relevés + encours : un driver_advance_refund est dû par la plateforme au
--    livreur — « à recevoir », et déduit de l'encours cash (comme un payout
--    online / no-show).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_driver_statements(
  p_period_start DATE,
  p_period_end   DATE
)
RETURNS TABLE (statements_created INTEGER, drivers_total INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_created INTEGER := 0;
  v_total   INTEGER := 0;
  r         RECORD;
  v_stmt_id UUID;
  v_due     TIMESTAMPTZ;
BEGIN
  v_due := (p_period_end + INTERVAL '2 day')::date + TIME '23:59';

  FOR r IN
    SELECT
      dl.driver_id                                                            AS driver_id,
      COUNT(DISTINCT dl.order_id)                                             AS deliveries_count,
      COALESCE(SUM(CASE WHEN dl.type = 'driver_payout'
                        THEN dl.amount_da ELSE 0 END), 0)                     AS gross_driver_da,
      COALESCE(SUM(CASE WHEN dl.type = 'driver_payout'
                        AND (o.payment_method = 'online' OR o.delivery_failed_at IS NOT NULL)
                        THEN dl.amount_da
                        WHEN dl.type = 'driver_advance_refund'
                        THEN dl.amount_da ELSE 0 END), 0)                     AS to_receive_da,
      COALESCE(SUM(CASE WHEN dl.type = 'driver_owes_platform'
                        THEN dl.amount_da ELSE 0 END), 0)                     AS to_reverse_da,
      COALESCE(SUM(CASE WHEN dl.type = 'driver_owes_platform'
                        THEN COALESCE(o.commission_da, 0) ELSE 0 END), 0)     AS commission_da,
      COALESCE(SUM(CASE WHEN dl.type = 'driver_owes_platform'
                        THEN COALESCE(o.service_fee_da, 0) ELSE 0 END), 0)    AS service_fee_da,
      COALESCE(SUM(CASE WHEN dl.type = 'driver_owes_platform'
                        THEN COALESCE(o.driver_fee_da, 0) ELSE 0 END), 0)     AS driver_fee_da
    FROM public.delivery_ledger dl
    LEFT JOIN public.orders o ON o.id = dl.order_id
    WHERE dl.settled_at IS NULL
      AND dl.created_at >= p_period_start
      AND dl.created_at <  (p_period_end + INTERVAL '1 day')
    GROUP BY dl.driver_id
  LOOP
    v_total := v_total + 1;

    INSERT INTO public.driver_statements (
      driver_id, period_start, period_end, deliveries_count,
      gross_driver_da, commission_da, service_fee_da, driver_fee_da,
      to_reverse_da, to_receive_da, net_da, direction, status, due_at,
      method, details
    )
    SELECT
      r.driver_id, p_period_start, p_period_end, r.deliveries_count,
      r.gross_driver_da, r.commission_da, r.service_fee_da, r.driver_fee_da,
      r.to_reverse_da, r.to_receive_da,
      (r.to_receive_da - r.to_reverse_da),
      CASE WHEN (r.to_receive_da - r.to_reverse_da) > 0 THEN 'receive'
           WHEN (r.to_receive_da - r.to_reverse_da) < 0 THEN 'reverse'
           ELSE 'settled' END,
      CASE WHEN (r.to_receive_da - r.to_reverse_da) = 0 THEN 'paid' ELSE 'due' END,
      v_due,
      d.payout_method, d.payout_details
    FROM public.drivers d
    WHERE d.id = r.driver_id
    ON CONFLICT (driver_id, period_start, period_end) DO NOTHING
    RETURNING id INTO v_stmt_id;

    IF v_stmt_id IS NOT NULL THEN
      v_created := v_created + 1;
      UPDATE public.delivery_ledger
         SET statement_id = v_stmt_id, settled_at = now()
       WHERE driver_id = r.driver_id
         AND settled_at IS NULL
         AND created_at >= p_period_start
         AND created_at <  (p_period_end + INTERVAL '1 day');
    END IF;
    v_stmt_id := NULL;
  END LOOP;

  RETURN QUERY SELECT v_created, v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_driver_statements(DATE, DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.driver_outstanding(p_driver_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(0, COALESCE(
    SUM(CASE WHEN dl.type = 'driver_owes_platform' THEN dl.amount_da
             WHEN dl.type = 'driver_payout'
                  AND (o.payment_method = 'online' OR o.delivery_failed_at IS NOT NULL)
                  THEN -dl.amount_da
             WHEN dl.type = 'driver_advance_refund' THEN -dl.amount_da
             ELSE 0 END), 0))::INTEGER
  FROM public.delivery_ledger dl
  LEFT JOIN public.orders o ON o.id = dl.order_id
  WHERE dl.driver_id = p_driver_id
    AND dl.settled_at IS NULL;
$$;
