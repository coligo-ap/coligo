-- =============================================================================
-- 0117 — Annulation commerçant DURCIE (appel de confirmation client)
-- =============================================================================
-- Process opérationnel (fondateur) : commerçant + super-admin appellent le client
-- pour confirmer la commande ; si le client ne répond jamais, on ANNULE AVANT que
-- le commerçant prépare / le livreur se déplace. Surtout pour les commandes 100 %
-- espèces (rien à rembourser), tous modes (express / tournée / retrait).
--
-- Cette RPC remplace le simple `UPDATE status='cancelled'` côté commerçant par une
-- annulation propre et sûre :
--   • RÈGLE CLÉ : le commerçant NE PEUT PLUS annuler si le livreur a déjà RÉCUPÉRÉ
--     la commande (delivery_picked_up_at NOT NULL) → à ce stade, seul le flux
--     livreur (no-show) ou le super-admin agit.
--   • Libère le livreur express (driver_availability), comme admin_cancel_order.
--   • Rembourse un éventuel paiement en ligne (re-crédit Coligo Pay) — pour rester
--     correct même hors cas espèces. Les re-crédits cashback/topup utilisés sont
--     gérés par les triggers existants ; delivery_failed_at reste NULL → AUCUNE
--     pénalité no-show (annulation pré-départ = propre).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.merchant_cancel_order(
  p_order_id UUID,
  p_reason   TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order  public.orders%ROWTYPE;
  v_from   TEXT;
  v_reason TEXT := COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Client injoignable');
  v_refund INTEGER := 0;
  v_owner  BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  -- Propriété : le commerçant connecté possède la commande (ou super-admin).
  SELECT EXISTS (
    SELECT 1 FROM public.merchants m
     WHERE m.id = v_order.merchant_id AND m.user_id = auth.uid()
  ) INTO v_owner;
  IF NOT v_owner AND NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  IF v_order.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_terminal');
  END IF;

  -- ⛔ RÈGLE CLÉ : interdiction d'annuler une fois la commande RÉCUPÉRÉE par le
  -- livreur (la marchandise a quitté le commerce).
  IF v_order.delivery_picked_up_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_picked_up');
  END IF;

  v_from := v_order.status::text;

  UPDATE public.orders
     SET status = 'cancelled', cancelled_by = 'merchant'
   WHERE id = p_order_id;

  -- Remboursement si payé en ligne (re-crédit Coligo Pay), comme admin_cancel_order.
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
          || ' (annulée par le commerçant) — crédité sur Coligo Pay.'
      );
    END IF;
  END IF;

  INSERT INTO public.order_events (order_id, from_status, to_status, note)
    VALUES (p_order_id, v_order.status, 'cancelled',
            'Annulée par le commerçant — ' || v_reason
              || ' (statut avant : ' || v_from || ')')
    ON CONFLICT DO NOTHING;

  -- Express : libérer le livreur s'il avait été affecté (pas encore récupéré).
  IF v_order.delivery_mode = 'express' THEN
    UPDATE public.driver_availability
       SET status = 'available', current_order_id = NULL
     WHERE current_order_id = p_order_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'from_status', v_from,
    'refunded_da', v_refund,
    'order_number', v_order.order_number
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.merchant_cancel_order(UUID, TEXT) TO authenticated;
