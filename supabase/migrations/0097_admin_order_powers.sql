-- =============================================================================
-- 0097 — Pouvoirs super-admin sur les commandes (livraison)
-- =============================================================================
-- Trois RPC SECURITY DEFINER, toutes gardées par is_super_admin() :
--   1) admin_validate_delivery  — valider une livraison (sans code, sans être le
--      livreur), mêmes effets que validate_delivery.
--   2) admin_cancel_order       — annuler à N'IMPORTE QUELLE étape (sauf déjà
--      terminée), en CONSERVANT le suivi : le statut AVANT annulation est gravé
--      dans order_events (from_status) + la note. Rembourse le client si payé en
--      ligne (re-crédit Coligo Pay), comme l'annulation client.
--   3) admin_refund_merchant_wallet — créditer le wallet du commerçant d'un
--      montant (ex. commande prête annulée / client injoignable). Le commerçant
--      voit « Remboursement de la commande n°… par la plateforme ».
-- =============================================================================

-- 1) ───────────────────────────── Valider une livraison ─────────────────────
CREATE OR REPLACE FUNCTION public.admin_validate_delivery(
  p_order_id UUID,
  p_note     TEXT DEFAULT NULL
) RETURNS TABLE(ok BOOLEAN, reason TEXT) AS $$
DECLARE v_order public.orders%ROWTYPE;
BEGIN
  IF NOT public.is_super_admin() THEN
    ok := false; reason := 'forbidden'; RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    ok := false; reason := 'order_not_found'; RETURN NEXT; RETURN;
  END IF;
  IF v_order.fulfillment_type <> 'delivery' THEN
    ok := false; reason := 'not_a_delivery'; RETURN NEXT; RETURN;
  END IF;
  IF v_order.status = 'completed' THEN
    ok := true; reason := 'already_delivered'; RETURN NEXT; RETURN;
  END IF;
  IF v_order.status = 'cancelled' THEN
    ok := false; reason := 'cancelled'; RETURN NEXT; RETURN;
  END IF;

  UPDATE public.orders
    SET status = 'completed',
        delivery_delivered_at = now(),
        validated_without_code = false
    WHERE id = p_order_id;

  UPDATE public.tour_stops
    SET status = 'delivered', delivered_at = now()
    WHERE order_id = p_order_id AND status = 'pending';

  INSERT INTO public.order_events (order_id, from_status, to_status, note)
    VALUES (p_order_id, v_order.status, 'completed',
            COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''),
                     'Validée par la plateforme'))
    ON CONFLICT DO NOTHING;

  IF v_order.delivery_mode = 'express' THEN
    UPDATE public.driver_availability
      SET status = 'available', current_order_id = NULL
      WHERE current_order_id = p_order_id;
  END IF;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.admin_validate_delivery(UUID, TEXT) TO authenticated;

-- 2) ───────────────────────────── Annuler à toute étape ─────────────────────
CREATE OR REPLACE FUNCTION public.admin_cancel_order(
  p_order_id UUID,
  p_reason   TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_order   public.orders%ROWTYPE;
  v_from    TEXT;
  v_reason  TEXT := COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Annulation plateforme');
  v_refund  INTEGER := 0;
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  IF v_order.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_terminal');
  END IF;

  v_from := v_order.status::text;

  -- On conserve le SUIVI : le statut avant annulation est gravé dans
  -- order_events (from_status) + rappelé dans la note.
  UPDATE public.orders
    SET status = 'cancelled', cancelled_by = 'system'
    WHERE id = p_order_id;

  -- Remboursement client si payé en ligne (re-crédit Coligo Pay), comme
  -- l'annulation client (0074). Le re-crédit cashback/topup éventuel est géré
  -- par les triggers existants sur le passage à 'cancelled'.
  IF v_order.payment_method = 'online' AND v_order.payment_status = 'paid' THEN
    v_refund := GREATEST(0, COALESCE(v_order.total_da, 0)
                            - COALESCE(v_order.delivery_fee_da, 0));
    UPDATE public.orders SET payment_status = 'refunded' WHERE id = p_order_id;
    IF v_refund > 0 THEN
      INSERT INTO public.customer_wallet_entries
        (customer_id, order_id, type, source, amount_da, note)
      VALUES (
        v_order.customer_id, NULL, 'topup_credit', 'topup', v_refund,
        'Remboursement commande #' || COALESCE(v_order.order_number, left(p_order_id::text, 6))
          || ' (annulée par la plateforme) — crédité sur Coligo Pay.'
      );
    END IF;
  END IF;

  INSERT INTO public.order_events (order_id, from_status, to_status, note)
    VALUES (p_order_id, v_order.status, 'cancelled',
            'Annulée par la plateforme — ' || v_reason
              || ' (statut avant : ' || v_from || ')')
    ON CONFLICT DO NOTHING;

  IF v_order.delivery_mode = 'express' THEN
    UPDATE public.driver_availability
      SET status = 'available', current_order_id = NULL
      WHERE current_order_id = p_order_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'from_status', v_from,
    'refunded_da', v_refund,
    'merchant_id', v_order.merchant_id,
    'order_number', v_order.order_number,
    'customer_name', v_order.customer_name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.admin_cancel_order(UUID, TEXT) TO authenticated;

-- 3) ──────────────────────── Créditer / rembourser le commerçant ────────────
CREATE OR REPLACE FUNCTION public.admin_refund_merchant_wallet(
  p_order_id  UUID,
  p_amount_da INTEGER,
  p_reason    TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_order  public.orders%ROWTYPE;
  v_amt    INTEGER := COALESCE(p_amount_da, 0);
  v_reason TEXT := COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'décision plateforme');
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF v_amt < 1 OR v_amt > 1000000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_amount');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  -- Crédit visible par le commerçant dans ses finances (type 'adjustment').
  -- UNIQUE(order_id, type) → un seul remboursement plateforme par commande.
  INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da, note)
  VALUES (
    v_order.merchant_id, p_order_id, 'adjustment', v_amt,
    'Remboursement de la commande n°'
      || COALESCE(v_order.order_number, left(p_order_id::text, 6))
      || ' par la plateforme — ' || v_reason
  )
  ON CONFLICT (order_id, type) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_refunded');
  END IF;

  RETURN jsonb_build_object('ok', true, 'merchant_id', v_order.merchant_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.admin_refund_merchant_wallet(UUID, INTEGER, TEXT) TO authenticated;
