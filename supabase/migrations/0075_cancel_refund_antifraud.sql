-- =============================================================================
-- 0075 — Anti-fraude sur l'annulation-remboursée en ligne
-- =============================================================================
-- Empêche un client d'annuler en boucle des commandes payées en ligne dans le
-- seul but de transférer de l'argent sur son Coligo Pay. Au-delà de
-- `max_online_refund_cancels_30d` annulations-remboursées sur 30 jours
-- glissants, l'annulation d'une commande PAYÉE EN LIGNE est REFUSÉE : le client
-- doit aller au bout (récupérer sa commande).
--
-- Le décompte se fait sur public.orders (commandes online, cancelled_by=customer,
-- payment_status=refunded, créées dans les 30 derniers jours) — l'annulation
-- n'étant possible qu'avant acceptation, created_at ≈ date d'annulation.
--
-- Le remboursement reste INTÉGRAL et EXACT : montant encaissé par Chargily =
-- total_da − delivery_fee_da (la livraison n'est jamais payée par carte).
-- =============================================================================

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS max_online_refund_cancels_30d INTEGER NOT NULL DEFAULT 3
    CHECK (max_online_refund_cancels_30d >= 0);

CREATE OR REPLACE FUNCTION public.cancel_order_by_customer(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer    uuid;
  v_order       RECORD;
  v_online_paid boolean := false;
  v_refund      integer := 0;
  v_cap         integer;
  v_prior       integer;
BEGIN
  SELECT id INTO v_customer
  FROM public.customers
  WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'Profil client introuvable.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, customer_id, merchant_id, status, payment_method, payment_status,
         order_number, customer_name, total_da, delivery_fee_da
    INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commande introuvable.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_order.customer_id IS DISTINCT FROM v_customer THEN
    RAISE EXCEPTION 'Cette commande ne t''appartient pas.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_order.status <> 'pending' THEN
    RAISE EXCEPTION 'Trop tard : le commerçant a déjà pris ta commande en charge.'
      USING ERRCODE = 'check_violation';
  END IF;

  v_online_paid := (v_order.payment_method = 'online'
                    AND v_order.payment_status = 'paid');

  IF v_online_paid THEN
    -- ANTI-FRAUDE : plafond d'annulations-remboursées en ligne sur 30 jours.
    SELECT COALESCE(max_online_refund_cancels_30d, 3) INTO v_cap
    FROM public.platform_settings WHERE id = true;

    SELECT count(*) INTO v_prior
    FROM public.orders
    WHERE customer_id = v_customer
      AND payment_method = 'online'
      AND cancelled_by = 'customer'
      AND payment_status = 'refunded'
      AND created_at >= now() - INTERVAL '30 days';

    IF v_prior >= COALESCE(v_cap, 3) THEN
      RAISE EXCEPTION 'Cette commande ne bénéficie pas d''un remboursement après plusieurs annulations. Merci de la récupérer.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Remboursement INTÉGRAL et EXACT du montant encaissé par Chargily.
    v_refund := GREATEST(
      0,
      COALESCE(v_order.total_da, 0) - COALESCE(v_order.delivery_fee_da, 0)
    );
  END IF;

  UPDATE public.orders
  SET status = 'cancelled',
      cancelled_by = 'customer',
      payment_status = CASE WHEN v_online_paid THEN 'refunded'
                           ELSE payment_status END
  WHERE id = p_order_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La commande vient de changer d''état, réessaie.'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.order_events (order_id, from_status, to_status, note)
  VALUES (p_order_id, 'pending', 'cancelled', 'Annulée par le client');

  IF v_refund > 0 THEN
    INSERT INTO public.customer_wallet_entries
      (customer_id, order_id, type, source, amount_da, note)
    VALUES (
      v_order.customer_id, NULL, 'topup_credit', 'topup', v_refund,
      'Remboursement commande '
        || COALESCE('#' || v_order.order_number, '')
        || ' (annulée) — crédité sur Coligo Pay.'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'merchant_id', v_order.merchant_id,
    'order_number', v_order.order_number,
    'customer_name', v_order.customer_name,
    'refunded_to_coligo_pay', v_refund
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_order_by_customer(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cancel_order_by_customer(uuid) TO authenticated;
