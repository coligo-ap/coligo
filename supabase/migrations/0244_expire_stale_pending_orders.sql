-- =============================================================================
-- 0244 — Auto-refus des commandes pending non acceptées (D-1)
-- =============================================================================
-- FAILLE (audit 2026-06-22, finding D-1, MAJEUR) :
--   L'UI commerçant promet un « auto-refus à 15 min » (order-board.tsx) mais
--   AUCUN cron/trigger ne l'implémentait → une commande `pending` jamais acceptée
--   restait pending indéfiniment. Pour une commande online PAYÉE, l'argent est
--   encaissé et la commande suspendue sine die.
--
-- CORRECTIF : RPC `expire_stale_pending_orders` qui annule + rembourse les
--   commandes IMMÉDIATES (asap, hors tournée/créneau futur) restées `pending`
--   au-delà du seuil `pending_auto_cancel_min` (défaut 15 min), en réutilisant
--   la politique de `admin_cancel_order` (cancelled_by='system', remboursement
--   carte complet → Coligo Pay ; les re-crédits cashback/topup sont posés par
--   les triggers `refund_customer_*_on_cancel`). Déclenchée :
--     (a) en POLL GATÉ au chargement du board commerçant (scopée au commerçant —
--         temps réel pour le commerçant actif, motif de la promesse « 15 min ») ;
--     (b) en balayage global par cron (catch-all commerçant absent).
--   Ne touche QUE les commandes visibles/actionnables : 100 % espèces, ou online
--   DÉJÀ PAYÉ. Les commandes online non payées (invisibles, gating 0068) relèvent
--   du cycle Chargily, pas de l'auto-refus.
-- =============================================================================

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS pending_auto_cancel_min INTEGER NOT NULL DEFAULT 15
    CHECK (pending_auto_cancel_min >= 1);

CREATE OR REPLACE FUNCTION public.expire_stale_pending_orders(
  p_merchant_id UUID DEFAULT NULL
) RETURNS TABLE(expired INTEGER) AS $$
DECLARE
  v_min     INTEGER;
  v_count   INTEGER := 0;
  v_o       RECORD;
  v_refund  INTEGER;
BEGIN
  SELECT COALESCE(pending_auto_cancel_min, 15) INTO v_min
    FROM public.platform_settings WHERE id = true;
  v_min := COALESCE(v_min, 15);

  FOR v_o IN
    SELECT id, merchant_id, customer_id, customer_name, order_number,
           payment_method, payment_status, total_da, delivery_mode
    FROM public.orders
    WHERE status = 'pending'
      AND pickup_type = 'asap'              -- commandes IMMÉDIATES uniquement
      AND delivery_mode IS DISTINCT FROM 'tour'  -- jamais les tournées (enum)
      AND delivery_slot_id IS NULL          -- jamais un créneau futur
      AND delivery_picked_up_at IS NULL     -- sécurité (pending => non récupéré)
      AND created_at < now() - make_interval(mins => v_min)
      AND ( payment_method = 'cash'
            OR (payment_method = 'online' AND payment_status = 'paid') )
      AND (p_merchant_id IS NULL OR merchant_id = p_merchant_id)
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Annulation système (déclenche les triggers de re-crédit cashback/topup).
    UPDATE public.orders
      SET status = 'cancelled', cancelled_by = 'system'
      WHERE id = v_o.id;

    -- Remboursement carte complet pour un online payé (→ Coligo Pay), comme
    -- admin_cancel_order (FIX A, mig 0128).
    v_refund := 0;
    IF v_o.payment_method = 'online' AND v_o.payment_status = 'paid' THEN
      v_refund := GREATEST(0, COALESCE(v_o.total_da, 0));
      UPDATE public.orders SET payment_status = 'refunded' WHERE id = v_o.id;
      IF v_refund > 0 THEN
        INSERT INTO public.customer_wallet_entries
          (customer_id, order_id, type, source, amount_da, note)
        VALUES (v_o.customer_id, NULL, 'topup_credit', 'topup', v_refund,
          'Remboursement commande #' || COALESCE(v_o.order_number, left(v_o.id::text, 6))
            || ' (non confirmée à temps — auto-annulée) — crédité sur Coligo Pay.');
      END IF;
    END IF;

    INSERT INTO public.order_events (order_id, from_status, to_status, note)
      VALUES (v_o.id, 'pending', 'cancelled',
              'Auto-refus : non acceptée sous ' || v_min || ' min.')
      ON CONFLICT DO NOTHING;

    -- Express : libère un éventuel livreur affecté (défensif).
    IF v_o.delivery_mode = 'express' THEN
      UPDATE public.driver_availability
        SET status = 'available', current_order_id = NULL
        WHERE current_order_id = v_o.id;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN QUERY SELECT v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Le commerçant peut déclencher le balayage de SES commandes (poll gaté board).
-- p_merchant_id est ignoré au profit de l'appartenance réelle ? Non : la fonction
-- est DEFINER et filtre par p_merchant_id ; on borne l'usage authenticated en
-- exigeant que p_merchant_id appartienne à l'appelant via un wrapper léger.
REVOKE ALL ON FUNCTION public.expire_stale_pending_orders(UUID) FROM public, anon, authenticated;

-- Wrapper sûr pour le board commerçant : n'expire QUE les commandes du commerçant
-- connecté (résout merchant_id depuis auth.uid()), jamais celles d'autrui.
CREATE OR REPLACE FUNCTION public.expire_my_stale_pending_orders()
RETURNS TABLE(expired INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_merchant UUID;
BEGIN
  SELECT id INTO v_merchant FROM public.merchants WHERE user_id = auth.uid();
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 0; RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public.expire_stale_pending_orders(v_merchant);
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_my_stale_pending_orders() TO authenticated;
