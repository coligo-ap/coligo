-- =============================================================================
-- 0303 — Gardes RPC admin scopées par DOMAINE
-- =============================================================================
-- Les RPC admin sont SECURITY DEFINER : elles s'exécutent avec les droits du
-- propriétaire et BYPASSENT donc la RLS (y compris l'overlay 0302). Un staff
-- authentifié pourrait, en tapant `rpc()` directement, exécuter une action hors
-- de son domaine (ex. un staff Marketing annulant une commande). On remplace
-- leur garde interne `is_super_admin()` par `admin_can('<domaine>')`.
--
-- Corps reproduits À L'IDENTIQUE de leur dernière définition (0097/0128/0095/
-- 0288/0109/0273) — SEULE la ligne de garde change. Domaines alignés sur les
-- server actions (app/admin/**/actions.ts).
--
--   admin_validate_delivery / admin_cancel_order / admin_refund_merchant_wallet
--                                                          → 'pilotage'
--   admin_resolve_delivery_report / admin_resolve_ride_report → 'confiance'
--   admin_force_driver_signout                               → 'livraison'
--   admin_merchants_directory                                → 'commercants'
-- =============================================================================

-- 1) Valider une livraison (pilotage) — corps 0097 verbatim, garde scopée.
CREATE OR REPLACE FUNCTION public.admin_validate_delivery(
  p_order_id UUID,
  p_note     TEXT DEFAULT NULL
) RETURNS TABLE(ok BOOLEAN, reason TEXT) AS $$
DECLARE v_order public.orders%ROWTYPE;
BEGIN
  IF NOT public.admin_can('pilotage') THEN
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

-- 2) Annuler à toute étape (pilotage) — corps 0128 (version finale, remboursement
--    = montant carte complet), garde scopée.
CREATE OR REPLACE FUNCTION public.admin_cancel_order(
  p_order_id UUID, p_reason TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_order   public.orders%ROWTYPE;
  v_from    TEXT;
  v_reason  TEXT := COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Annulation plateforme');
  v_refund  INTEGER := 0;
BEGIN
  IF NOT public.admin_can('pilotage') THEN
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
  UPDATE public.orders SET status = 'cancelled', cancelled_by = 'system' WHERE id = p_order_id;

  IF v_order.payment_method = 'online' AND v_order.payment_status = 'paid' THEN
    v_refund := GREATEST(0, COALESCE(v_order.total_da, 0));   -- montant carte complet
    UPDATE public.orders SET payment_status = 'refunded' WHERE id = p_order_id;
    IF v_refund > 0 THEN
      INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
      VALUES (v_order.customer_id, NULL, 'topup_credit', 'topup', v_refund,
        'Remboursement commande #' || COALESCE(v_order.order_number, left(p_order_id::text, 6))
          || ' (annulée par la plateforme) — crédité sur Coligo Pay.');
    END IF;
  END IF;

  INSERT INTO public.order_events (order_id, from_status, to_status, note)
    VALUES (p_order_id, v_order.status, 'cancelled',
            'Annulée par la plateforme — ' || v_reason || ' (statut avant : ' || v_from || ')')
    ON CONFLICT DO NOTHING;

  IF v_order.delivery_mode = 'express' THEN
    UPDATE public.driver_availability SET status = 'available', current_order_id = NULL
      WHERE current_order_id = p_order_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'from_status', v_from, 'refunded_da', v_refund,
    'merchant_id', v_order.merchant_id, 'order_number', v_order.order_number,
    'customer_name', v_order.customer_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 3) Créditer / rembourser le commerçant (pilotage) — corps 0097 verbatim.
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
  IF NOT public.admin_can('pilotage') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF v_amt < 1 OR v_amt > 1000000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_amount');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

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

-- 4) Modération signalement livraison (confiance) — corps 0095 verbatim.
CREATE OR REPLACE FUNCTION public.admin_resolve_delivery_report(
  p_report_id UUID,
  p_status    TEXT,
  p_note      TEXT DEFAULT NULL
) RETURNS TABLE(ok BOOLEAN, reason TEXT) AS $$
BEGIN
  IF NOT public.admin_can('confiance') THEN
    ok := false; reason := 'forbidden'; RETURN NEXT; RETURN;
  END IF;
  IF p_status NOT IN ('open', 'reviewing', 'resolved', 'dismissed') THEN
    ok := false; reason := 'bad_status'; RETURN NEXT; RETURN;
  END IF;

  UPDATE public.delivery_reports
  SET status = p_status,
      admin_note = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), admin_note),
      resolved_at = CASE WHEN p_status IN ('resolved', 'dismissed') THEN now() ELSE NULL END
  WHERE id = p_report_id;

  IF NOT FOUND THEN
    ok := false; reason := 'not_found'; RETURN NEXT; RETURN;
  END IF;
  ok := true; reason := NULL; RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 5) Modération signalement course Drive (confiance) — corps 0288 verbatim.
CREATE OR REPLACE FUNCTION public.admin_resolve_ride_report(
  p_report_id uuid,
  p_status    text,
  p_decision  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.admin_can('confiance') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF p_status NOT IN ('open','reviewed','dismissed') THEN
    RAISE EXCEPTION 'statut invalide: %', p_status;
  END IF;
  UPDATE public.ride_reports
     SET status      = p_status,
         decision    = NULLIF(btrim(COALESCE(p_decision, '')), ''),
         reviewed_at = CASE WHEN p_status = 'open' THEN NULL ELSE now() END
   WHERE id = p_report_id;
END;
$$;

-- 6) Déconnexion forcée d'un livreur (livraison) — corps 0109 verbatim.
CREATE OR REPLACE FUNCTION public.admin_force_driver_signout(p_driver_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
DECLARE
  v_user uuid;
  v_count integer := 0;
BEGIN
  IF NOT public.admin_can('livraison') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT user_id INTO v_user FROM public.drivers WHERE id = p_driver_id;
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_user');
  END IF;

  DELETE FROM auth.refresh_tokens WHERE user_id = v_user::text;
  DELETE FROM auth.sessions WHERE user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'sessions_killed', v_count);
END;
$$;

-- 7) Annuaire commerçants (commercants) — corps 0273 verbatim, garde scopée.
DROP FUNCTION IF EXISTS public.admin_merchants_directory();
CREATE FUNCTION public.admin_merchants_directory()
RETURNS TABLE (
  id                uuid,
  name              text,
  slug              text,
  city              text,
  category          text,
  phone             text,
  email             text,
  is_active         boolean,
  is_frozen         boolean,
  approval_status   text,
  submitted_at      timestamptz,
  rejected_reason   text,
  commission_cash   numeric,
  commission_online numeric,
  cashback_online   numeric,
  cashback_cash     numeric,
  balance_da        bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.admin_can('commercants') THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs du domaine Commerçants.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.name,
    m.slug,
    m.city,
    m.category,
    m.phone_public                                   AS phone,
    u.email::text                                    AS email,
    m.is_active,
    m.is_frozen,
    m.approval_status,
    m.submitted_at,
    m.rejected_reason,
    m.commission_cash,
    m.commission_online,
    m.cashback_online,
    m.cashback_cash,
    COALESCE((SELECT SUM(w.amount_da)
                FROM public.wallet_entries w
               WHERE w.merchant_id = m.id), 0)::bigint AS balance_da
  FROM public.merchants m
  LEFT JOIN auth.users u ON u.id = m.user_id
  ORDER BY
    CASE WHEN m.approval_status = 'pending' THEN 0 ELSE 1 END,
    m.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_merchants_directory() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_merchants_directory() TO authenticated;
