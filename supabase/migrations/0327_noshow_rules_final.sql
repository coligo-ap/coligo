-- =============================================================================
-- 0327 — Règles no-show FINALES (décisions propriétaire 04/07/2026)
-- =============================================================================
-- `driver_report_no_show` = désormais le chemin « client absent » pour les
-- commandes EN ESPÈCES UNIQUEMENT (la commande est annulée, personne n'est
-- payé pour la vente). Les commandes PRÉPAYÉES EN LIGNE ne passent plus par ce
-- chemin : un no-show online se règle « comme livré » (statut No-Show) via
-- `driver_leave_at_door` (dépôt + photo, mig 0328) ou `admin_confirm_online_
-- noshow` (validation support/super-admin). Ici on REFUSE l'online avec la
-- raison 'use_leave_at_door' pour rediriger le livreur vers le bon bouton.
--
-- ESPÈCES — deux régimes distincts :
--   • EXPRESS (custodian plateforme) : commande annulée. Le livreur n'est PAS
--     payé pour la course ; il ne récupère que l'AVANCE remise au commerçant au
--     retrait (P − commission), APRÈS validation support (driver_refund_claims
--     / mig 0160). Pénalité client = D prélevée best-effort (cashback→topup),
--     conservée par la plateforme (provision de l'avance qu'elle rembourse).
--   • TOURNÉE (livreur DU commerçant) : la perte est ENTIÈREMENT à la charge du
--     commerçant — ses livreurs, ses clients. La plateforme reste NEUTRE :
--     AUCUN paiement au livreur, AUCUN reversement au commerçant, AUCUNE
--     pénalité prélevée au client. Seul le compteur no-show client est
--     incrémenté (réputation plateforme). La commande est annulée + l'arrêt de
--     tournée marqué 'failed' pour ne pas geler la tournée.
--
-- (Le §2 « course payée » de 0325 est définitivement supprimé ; 0326 l'avait
-- déjà retiré pour l'espèces. Ici on retire aussi le paiement online de ce
-- chemin — l'online devient « livré No-Show ».)
-- =============================================================================

-- Marqueurs No-Show unifiés (posés aussi par leave-at-door / support en 0328).
--   delivery_no_show_kind ∈ 'cash_failed' | 'left_at_door' | 'support_confirmed'
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_no_show_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_no_show_kind TEXT;

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
  v_reason       TEXT;
  v_delivery_fee INTEGER;
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
  v_is_cash      BOOLEAN;
  v_is_express   BOOLEAN;
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
  IF v_order.delivery_arrived_at IS NULL THEN
    ok := false; reason := 'not_arrived'; RETURN NEXT; RETURN; END IF;

  v_is_cash    := (v_order.payment_method = 'cash');
  v_is_express := (v_order.delivery_mode = 'express');

  -- ONLINE prépayé : ce chemin (annulation) ne s'applique PAS. Le livreur doit
  -- déposer la commande + photo (leave-at-door) ou passer par le support.
  IF NOT v_is_cash THEN
    ok := false; reason := 'use_leave_at_door'; RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_s FROM public.platform_settings WHERE id = true;
  v_wait := GREATEST(1, COALESCE(v_s.noshow_wait_min, 8));

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

  -- 1) Commande annulée + tracée. delivery_failed_at posé → refunds cashback/
  --    topup SKIPPENT (pas de remboursement au no-show).
  UPDATE public.orders
     SET status                 = 'cancelled',
         delivery_failed_at     = now(),
         delivery_failed_reason = v_reason,
         delivery_no_show_at    = now(),
         delivery_no_show_kind  = 'cash_failed'
   WHERE id = p_order_id;

  -- Tournée : l'arrêt échoue (sinon la tournée reste 'in_progress' à jamais).
  UPDATE public.tour_stops
     SET status = 'failed'
   WHERE order_id = p_order_id AND status = 'pending';

  INSERT INTO public.order_events (order_id, from_status, to_status, client_operation_id, note)
  VALUES (p_order_id, v_order.status, 'cancelled', NULL,
          'driver_no_show:' || v_reason || ':' || COALESCE(p_client_operation_id, ''))
  ON CONFLICT DO NOTHING;

  -- 2) EXPRESS espèces : réclamation de l'AVANCE remise au commerçant au
  --    retrait (P − commission), versée APRÈS validation support (super-admin).
  --    Le livreur n'est jamais payé pour la course sur un no-show espèces.
  IF v_is_express THEN
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

  -- 3) Pénalité client + réputation.
  IF v_order.customer_id IS NOT NULL THEN
    -- Pénalité (= D) prélevée UNIQUEMENT en EXPRESS espèces (custodian
    -- plateforme). En TOURNÉE, la plateforme reste neutre : rien n'est prélevé
    -- au client ni reversé au commerçant — c'est SA livraison, SON client.
    IF v_is_express THEN
      v_liability := GREATEST(0, v_delivery_fee);
      v_label := 'Pénalité no-show — commande ' || COALESCE(v_order.order_number, left(v_order.id::text, 8));

      v_bal := COALESCE(public.customer_cashback_balance(v_order.customer_id), 0);
      v_take := LEAST(GREATEST(v_liability - v_recovered, 0), GREATEST(v_bal, 0));
      IF v_take > 0 THEN
        INSERT INTO public.customer_wallet_entries
          (customer_id, order_id, type, source, amount_da, note)
        VALUES (v_order.customer_id, NULL, 'adjustment', 'cashback', -v_take, v_label);
        v_recovered := v_recovered + v_take;
      END IF;

      v_bal := COALESCE(public.customer_topup_balance(v_order.customer_id), 0);
      v_take := LEAST(GREATEST(v_liability - v_recovered, 0), GREATEST(v_bal, 0));
      IF v_take > 0 THEN
        INSERT INTO public.customer_wallet_entries
          (customer_id, order_id, type, source, amount_da, note)
        VALUES (v_order.customer_id, NULL, 'adjustment', 'topup', -v_take, v_label);
        v_recovered := v_recovered + v_take;
      END IF;
    END IF;

    PERFORM set_config('app.allow_risk_update', 'on', true);
    UPDATE public.customers
       SET noshow_count   = noshow_count + 1,
           -- noshow_pending (frais de service relevés ensuite) seulement quand
           -- la plateforme a un reste à recouvrer = EXPRESS espèces non couvert.
           noshow_pending = noshow_pending
             OR (v_is_express AND (GREATEST(0, v_delivery_fee) - v_recovered) > 0)
     WHERE id = v_order.customer_id;
  END IF;

  -- 4) Express : libérer le livreur.
  IF v_is_express THEN
    UPDATE public.driver_availability
       SET status = 'available', current_order_id = NULL
     WHERE current_order_id = p_order_id;
  END IF;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$;
