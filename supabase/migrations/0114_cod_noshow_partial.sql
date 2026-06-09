-- =============================================================================
-- 0114 — Cas limites COD (esprit Yassir) : no-show, paiement partiel, anti-fraude
-- =============================================================================
-- Contexte : Coligo = click-and-collect + livraison COD (Algérie). Le modèle
-- financier livreur (0103) suppose que TOUT se passe parfaitement : client
-- présent, montant exact encaissé. La vraie vie ne l'est pas. Cette migration
-- code les deux cas limites du prompt LIV-paiement §7 :
--
--   1. NO-SHOW COD — client absent / refuse la livraison (0 DA encaissé).
--      → commande ANNULÉE + tracée (les triggers de remboursement cashback/
--        topup rétablissent automatiquement tout prépaiement client) ;
--      → le LIVREUR est indemnisé d'UNE course (commerçant→client) : on lui
--        crédite driver_net via delivery_ledger, compté « à recevoir » au
--        relevé (il n'a encaissé aucun cash, donc la plateforme lui doit) ;
--      → le CLIENT est pénalisé : perd le droit au COD (cod_blocked) et porte
--        une CRÉANCE = frais de livraison D, recouvrée à sa prochaine commande
--        (obligatoirement prépayée). noshow_count++.
--      → l'avance commerçant (P−commission) est rendue physiquement au livreur
--        par le commerçant contre retour de la marchandise : aucune écriture
--        ledger (la commande n'a jamais été complétée).
--
--   2. PAIEMENT PARTIEL / appoint manquant — le client paie MOINS que le cash
--      dû (ex. pas la monnaie). On enregistre l'écart, le livreur n'est PAS
--      pénalisé (son owes_platform est réduit d'autant) et l'écart devient une
--      CRÉANCE client recouvrée à la prochaine commande.
--
--   3. ANTI-FRAUDE NOUVEAUX COMPTES — un client ne peut payer en espèces (COD)
--      qu'après ≥ cod_unlock_orders commandes complétées (défaut 1). Empêche la
--      création de comptes jetables pour enchaîner des no-show en espèces.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Profil de risque COD du client.
-- ---------------------------------------------------------------------------
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS cod_blocked   BOOLEAN NOT NULL DEFAULT false,  -- perte du COD
  ADD COLUMN IF NOT EXISTS noshow_count  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS debt_da       INTEGER NOT NULL DEFAULT 0;      -- créance à recouvrer (>=0)

-- ---------------------------------------------------------------------------
-- 2. Snapshots sur la commande (échec de livraison + appoint manquant +
--    créance recouvrée sur CETTE commande).
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_failed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_failed_reason  TEXT,        -- 'no_show' | 'refused'
  ADD COLUMN IF NOT EXISTS cash_shortfall_da       INTEGER NOT NULL DEFAULT 0,  -- appoint manquant
  ADD COLUMN IF NOT EXISTS debt_recovered_da       INTEGER NOT NULL DEFAULT 0;  -- créance soldée ici

-- ---------------------------------------------------------------------------
-- 3. Seuil anti-fraude : nb de commandes complétées avant d'autoriser le COD.
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS cod_unlock_orders INTEGER NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
-- 4. customer_cod_allowed — le client a-t-il le droit de payer en espèces ?
--    false si : profil absent, COD bloqué (no-show), ou pas assez de commandes
--    complétées (compte neuf). cod_unlock_orders=0 désactive le verrou.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_cod_allowed(p_customer_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_blocked BOOLEAN;
  v_min     INTEGER;
  v_done    INTEGER;
BEGIN
  SELECT cod_blocked INTO v_blocked FROM public.customers WHERE id = p_customer_id;
  IF v_blocked IS NULL THEN RETURN false; END IF;   -- pas de profil → pas de COD
  IF v_blocked THEN RETURN false; END IF;

  SELECT COALESCE(cod_unlock_orders, 1) INTO v_min FROM public.platform_settings WHERE id = true;
  IF COALESCE(v_min, 1) <= 0 THEN RETURN true; END IF;

  SELECT COUNT(*) INTO v_done
    FROM public.orders
   WHERE customer_id = p_customer_id AND status = 'completed';

  RETURN v_done >= v_min;
END;
$$;

GRANT EXECUTE ON FUNCTION public.customer_cod_allowed(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. driver_report_no_show — le livreur déclare le client absent / refus.
--    Commande → cancelled (remboursements prépaiement auto via triggers),
--    indemnité livreur (driver_net), pénalité client (cod_blocked + créance D).
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
  -- Anti-abus : le livreur doit AU MOINS avoir récupéré la commande.
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

  -- 1) Commande annulée + tracée. Les triggers refund_customer_cashback/topup
  --    rétablissent automatiquement tout prépaiement (cashback/Coligo Pay).
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

  -- 2) Indemnité livreur : UNE seule course (commerçant→client). Comptée « à
  --    recevoir » au relevé (cf. driver_outstanding / generate_driver_statements
  --    qui traitent driver_payout d'une commande no-show comme du prépayé).
  IF v_driver_net > 0 THEN
    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (v_driver_id, v_order.merchant_id, p_order_id, 'driver_payout', v_driver_net,
            'Indemnité course no-show (client absent/refus).')
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  -- 3) Pénalité client : perte du COD + créance = frais de livraison D.
  IF v_order.customer_id IS NOT NULL THEN
    UPDATE public.customers
       SET cod_blocked  = true,
           noshow_count = noshow_count + 1,
           debt_da      = GREATEST(0, debt_da + v_delivery_fee)
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
-- 6. validate_delivery — AJOUT du paiement partiel (p_collected_da).
--    Sur une commande CASH, si le livreur saisit un montant encaissé < cash dû
--    (total_da), l'écart est enregistré (cash_shortfall_da) puis devient une
--    créance client. Le reste de la logique anti-fraude (code prépayé) est
--    INCHANGÉ. On DROP l'ancienne signature (4 args) pour éviter une surcharge.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.validate_delivery(UUID, TEXT, BOOLEAN, TEXT);

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

  -- La commande a-t-elle une part PRÉPAYÉE ?
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

  -- Paiement partiel : seulement pour les commandes CASH (total_da = cash dû,
  -- cashback/topup déjà déduits). Écart = dû − encaissé (jamais négatif).
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

  -- Appoint manquant → créance client (recouvrée à la prochaine commande).
  IF v_shortfall > 0 AND v_order.customer_id IS NOT NULL THEN
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

-- ---------------------------------------------------------------------------
-- 7. generate_delivery_ledger_on_complete — prise en compte de l'appoint
--    manquant : le livreur n'est PAS pénalisé, son owes_platform est réduit de
--    l'écart (la plateforme l'absorbe, recouvré ensuite via la créance client).
--    Le cash réellement collecté = total − écart.
--    (Reprend 0103 à l'identique, seul le bloc cash change.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_delivery_ledger_on_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s               public.platform_settings%ROWTYPE;
  v_products_da     INTEGER;
  v_comm_rate       NUMERIC(5, 4);
  v_cashback_rate   NUMERIC(5, 4);
  v_commission      INTEGER;
  v_service_fee     INTEGER;
  v_delivery_fee    INTEGER;
  v_driver_fee      INTEGER;
  v_driver_net      INTEGER;
  v_cashback        INTEGER;
  v_owes_merchant   INTEGER;
  v_owes_platform   INTEGER;
  v_shortfall       INTEGER;
  v_collected       INTEGER;
BEGIN
  IF NOT (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed'
          AND NEW.fulfillment_type = 'delivery'
          AND NEW.delivery_driver_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_s FROM public.platform_settings WHERE id = true;

  v_products_da  := GREATEST(0, COALESCE(NEW.net_total_da, NEW.subtotal_da - NEW.discount_da));
  v_service_fee  := COALESCE(NEW.service_fee_da, 0);
  v_delivery_fee := COALESCE(NEW.delivery_fee_da, 0);
  v_shortfall    := GREATEST(0, COALESCE(NEW.cash_shortfall_da, 0));

  IF NEW.payment_method = 'cash' THEN
    v_comm_rate     := public.resolve_rate(NEW.merchant_id, 'commission_cash');
    v_cashback_rate := public.resolve_rate(NEW.merchant_id, 'cashback_cash');
  ELSE
    v_comm_rate     := public.resolve_rate(NEW.merchant_id, 'commission_online');
    v_cashback_rate := public.resolve_rate(NEW.merchant_id, 'cashback_online');
  END IF;

  v_commission := round(v_products_da * v_comm_rate)::INTEGER;

  IF v_delivery_fee <= 0 THEN
    v_driver_fee := 0;
  ELSE
    v_driver_fee := LEAST(
      v_delivery_fee,
      GREATEST(
        v_s.driver_fee_min_da,
        LEAST(round(v_delivery_fee * v_s.driver_fee_rate)::INTEGER,
              round(v_delivery_fee * v_s.driver_fee_cap_rate)::INTEGER)
      )
    );
  END IF;
  v_driver_net := v_delivery_fee - v_driver_fee;

  UPDATE public.orders
     SET driver_fee_rate_applied   = v_s.driver_fee_rate,
         driver_fee_da             = v_driver_fee,
         driver_net_da             = v_driver_net,
         commission_rate_applied   = COALESCE(commission_rate_applied, v_comm_rate),
         commission_da             = COALESCE(commission_da, v_commission)
   WHERE id = NEW.id;

  INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
  VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_payout', v_driver_net, NULL)
  ON CONFLICT (order_id, type) DO NOTHING;

  IF NEW.payment_method = 'cash' THEN
    v_cashback := round(v_products_da * v_cashback_rate)::INTEGER;
    v_cashback := LEAST(v_cashback,
                        (v_products_da / 2),
                        GREATEST(v_commission + v_service_fee + v_delivery_fee, 0));

    -- Cash réellement collecté = total − appoint manquant.
    v_collected     := GREATEST(0, NEW.total_da - v_shortfall);
    v_owes_merchant := GREATEST(v_products_da - v_commission, 0);
    -- L'appoint manquant est ABSORBÉ par la plateforme (livreur non pénalisé) :
    -- on réduit ce qu'il doit reverser. Recouvré ensuite via la créance client.
    v_owes_platform := GREATEST(v_commission + v_service_fee + v_driver_fee - v_cashback - v_shortfall, 0);

    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_cash_collected', v_collected, NULL)
    ON CONFLICT (order_id, type) DO NOTHING;

    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_owes_merchant', v_owes_merchant, NULL)
    ON CONFLICT (order_id, type) DO NOTHING;

    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_owes_platform', v_owes_platform, NULL)
    ON CONFLICT (order_id, type) DO NOTHING;

    UPDATE public.orders
       SET driver_owes_platform_da  = v_owes_platform,
           driver_owes_merchant_da  = v_owes_merchant,
           driver_cash_collected_da = v_collected,
           cashback_rate_applied    = COALESCE(cashback_rate_applied, v_cashback_rate)
     WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Encours (float) & relevés : un driver_payout rattaché à une commande
--    NO-SHOW (delivery_failed_at NOT NULL) est dû par la plateforme au livreur
--    — exactement comme une commande prépayée (online). On l'inclut donc dans
--    « à recevoir » et on le déduit de l'encours cash.
-- ---------------------------------------------------------------------------
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
             ELSE 0 END), 0))::INTEGER
  FROM public.delivery_ledger dl
  LEFT JOIN public.orders o ON o.id = dl.order_id
  WHERE dl.driver_id = p_driver_id
    AND dl.settled_at IS NULL;
$$;

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

GRANT EXECUTE ON FUNCTION public.driver_outstanding(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_driver_statements(DATE, DATE) TO service_role;
