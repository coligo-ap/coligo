-- =============================================================================
-- 0115 — Protection des champs de risque COD du client (anti-fraude)
-- =============================================================================
-- La policy `customers_update_own` autorise le client à mettre à jour SA ligne
-- sans restriction de colonne → un client malveillant pourrait remettre
-- cod_blocked=false, debt_da=0 ou noshow_count=0 via un appel API direct.
--
-- On verrouille ces 3 colonnes : toute UPDATE qui n'a pas explicitement levé le
-- garde-fou de session `app.allow_risk_update='on'` voit ces champs FORCÉS à
-- leur ancienne valeur. Seules les RPC SECURITY DEFINER de confiance
-- (driver_report_no_show, validate_delivery, recover_customer_debt) et le
-- super-admin (admin_set_customer_cod) lèvent ce garde-fou. Les mises à jour de
-- profil ordinaires (nom, téléphone, adresse…) passent sans changement.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.protect_customer_risk_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('app.allow_risk_update', true) IS DISTINCT FROM 'on' THEN
    NEW.cod_blocked  := OLD.cod_blocked;
    NEW.noshow_count := OLD.noshow_count;
    NEW.debt_da      := OLD.debt_da;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_customer_risk_fields_trg ON public.customers;
CREATE TRIGGER protect_customer_risk_fields_trg
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.protect_customer_risk_fields();

-- ---------------------------------------------------------------------------
-- Recouvrement de créance (appelé au checkout) — décrément borné, sûr.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recover_customer_debt(
  p_customer_id UUID,
  p_amount      INTEGER
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new INTEGER;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    SELECT debt_da INTO v_new FROM public.customers WHERE id = p_customer_id;
    RETURN COALESCE(v_new, 0);
  END IF;
  PERFORM set_config('app.allow_risk_update', 'on', true);
  UPDATE public.customers
     SET debt_da = GREATEST(0, debt_da - p_amount)
   WHERE id = p_customer_id
   RETURNING debt_da INTO v_new;
  RETURN COALESCE(v_new, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.recover_customer_debt(UUID, INTEGER) TO authenticated;

-- ---------------------------------------------------------------------------
-- Super-admin : (dé)bloquer le COD d'un client + remettre à zéro la créance.
-- Permet de lever la sanction après vérification (recours client).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_customer_cod(
  p_customer_id UUID,
  p_blocked     BOOLEAN,
  p_clear_debt  BOOLEAN DEFAULT false
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  PERFORM set_config('app.allow_risk_update', 'on', true);
  UPDATE public.customers
     SET cod_blocked = p_blocked,
         debt_da     = CASE WHEN p_clear_debt THEN 0 ELSE debt_da END
   WHERE id = p_customer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_customer_cod(UUID, BOOLEAN, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------------
-- Les RPC de confiance qui MODIFIENT les champs de risque doivent lever le
-- garde-fou. On les recrée à l'identique (0114) + PERFORM set_config(...).
-- ---------------------------------------------------------------------------

-- driver_report_no_show : pose cod_blocked + créance D + noshow_count.
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

  v_reason := COALESCE(NULLIF(btrim(p_reason), ''), 'no_show');
  IF v_reason NOT IN ('no_show', 'refused') THEN v_reason := 'no_show'; END IF;

  SELECT * INTO v_s FROM public.platform_settings WHERE id = true;
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

  IF v_driver_net > 0 THEN
    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (v_driver_id, v_order.merchant_id, p_order_id, 'driver_payout', v_driver_net,
            'Indemnité course no-show (client absent/refus).')
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  IF v_order.customer_id IS NOT NULL THEN
    PERFORM set_config('app.allow_risk_update', 'on', true);
    UPDATE public.customers
       SET cod_blocked  = true,
           noshow_count = noshow_count + 1,
           debt_da      = GREATEST(0, debt_da + v_delivery_fee)
     WHERE id = v_order.customer_id;
  END IF;

  IF v_order.delivery_mode = 'express' THEN
    UPDATE public.driver_availability
       SET status = 'available', current_order_id = NULL
     WHERE current_order_id = p_order_id;
  END IF;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_report_no_show(UUID, TEXT, TEXT) TO authenticated;

-- validate_delivery : modifie debt_da en cas d'appoint manquant.
CREATE OR REPLACE FUNCTION public.validate_delivery(
  p_order_id            UUID,
  p_provided_code       TEXT,
  p_skip_code           BOOLEAN DEFAULT false,
  p_client_operation_id TEXT DEFAULT NULL,
  p_collected_da        INTEGER DEFAULT NULL
) RETURNS TABLE(ok BOOLEAN, reason TEXT) AS $$
DECLARE
  v_user      UUID := auth.uid();
  v_driver_id UUID;
  v_order     public.orders%ROWTYPE;
  v_prepaid   BOOLEAN;
  v_shortfall INTEGER := 0;
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = v_user;
  IF v_driver_id IS NULL THEN
    ok := false; reason := 'not_a_driver'; RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    ok := false; reason := 'order_not_found'; RETURN NEXT; RETURN;
  END IF;

  IF v_order.fulfillment_type <> 'delivery' THEN
    ok := false; reason := 'not_a_delivery'; RETURN NEXT; RETURN;
  END IF;
  IF v_order.delivery_driver_id IS NULL OR v_order.delivery_driver_id <> v_driver_id THEN
    ok := false; reason := 'not_attributed_to_you'; RETURN NEXT; RETURN;
  END IF;

  IF v_order.status = 'completed' THEN
    ok := true; reason := 'already_delivered'; RETURN NEXT; RETURN;
  END IF;

  v_prepaid := (v_order.payment_method = 'online')
            OR (COALESCE(v_order.cashback_used_da, 0) > 0)
            OR (COALESCE(v_order.topup_used_da, 0) > 0);

  IF v_prepaid THEN
    IF p_skip_code OR p_provided_code IS NULL OR btrim(p_provided_code) = '' THEN
      ok := false; reason := 'code_required'; RETURN NEXT; RETURN;
    END IF;
    IF p_provided_code <> v_order.pickup_code THEN
      ok := false; reason := 'bad_code'; RETURN NEXT; RETURN;
    END IF;
  ELSE
    IF NOT p_skip_code AND p_provided_code IS NOT NULL AND btrim(p_provided_code) <> '' THEN
      IF p_provided_code <> v_order.pickup_code THEN
        ok := false; reason := 'bad_code'; RETURN NEXT; RETURN;
      END IF;
    END IF;
  END IF;

  IF v_order.payment_method = 'cash' AND p_collected_da IS NOT NULL THEN
    v_shortfall := GREATEST(0, v_order.total_da - GREATEST(0, p_collected_da));
  END IF;

  UPDATE public.orders
    SET status = 'completed',
        delivery_delivered_at = now(),
        cash_shortfall_da = v_shortfall,
        validated_without_code =
          (p_provided_code IS NULL OR btrim(p_provided_code) = '' OR p_skip_code)
          AND NOT v_prepaid
    WHERE id = p_order_id;

  IF v_shortfall > 0 AND v_order.customer_id IS NOT NULL THEN
    PERFORM set_config('app.allow_risk_update', 'on', true);
    UPDATE public.customers
       SET debt_da = GREATEST(0, debt_da + v_shortfall)
     WHERE id = v_order.customer_id;
  END IF;

  UPDATE public.tour_stops
    SET status = 'delivered', delivered_at = now()
    WHERE order_id = p_order_id AND status = 'pending';

  INSERT INTO public.order_events (order_id, from_status, to_status, client_operation_id, note)
    VALUES (p_order_id, v_order.status, 'completed', NULL,
            CASE WHEN p_client_operation_id IS NOT NULL
                 THEN 'driver_validation:' || p_client_operation_id
                 ELSE 'driver_validation' END)
    ON CONFLICT DO NOTHING;

  IF v_order.delivery_mode = 'express' THEN
    UPDATE public.driver_availability
      SET status = 'available', current_order_id = NULL
      WHERE current_order_id = p_order_id;
  END IF;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.validate_delivery(UUID, TEXT, BOOLEAN, TEXT, INTEGER) TO authenticated;
