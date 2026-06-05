-- =============================================================================
-- 0074 — Annulation client des commandes PAYÉES EN LIGNE → remboursement en
--        crédit Coligo Pay (avoir in-app)
-- =============================================================================
-- Chargily Pay v2 n'a pas d'API de remboursement carte. On rembourse donc le
-- montant réellement encaissé par carte EN CRÉDIT COLIGO PAY (réutilisable tout
-- de suite). Montant carte = total_da − delivery_fee_da (cf. checkout : Chargily
-- encaisse `totalAfterWallets`, et total_da = totalAfterWallets + livraison ;
-- la livraison n'est pas encaissée par carte).
--
-- Les soldes DÉPENSÉS à la création (cashback_used_da / topup_used_da) sont déjà
-- re-crédités par les triggers d'annulation (mig 0017/0019) → pas de double
-- comptage. Le crédit carte est inséré avec order_id = NULL pour ne pas entrer
-- en collision avec l'écriture topup_credit (order_id, type) du trigger de
-- re-crédit topup. Idempotence garantie par l'atomicité de l'annulation
-- (une seule transition pending → cancelled possible).
-- =============================================================================

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

  -- Uniquement AVANT acceptation commerçant.
  IF v_order.status <> 'pending' THEN
    RAISE EXCEPTION 'Trop tard : le commerçant a déjà pris ta commande en charge.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Remboursement carte → Coligo Pay (seulement si payé en ligne).
  v_online_paid := (v_order.payment_method = 'online'
                    AND v_order.payment_status = 'paid');
  IF v_online_paid THEN
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

  -- Crédit Coligo Pay du montant payé par carte (avoir in-app).
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
