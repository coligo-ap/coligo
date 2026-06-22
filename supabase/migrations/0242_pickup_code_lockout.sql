-- =============================================================================
-- 0242 — Anti brute-force du code de retrait + séquençage de la livraison
-- =============================================================================
-- FAILLES (audit 2026-06-22) :
--   • F-2 (MAJEUR) : `validate_delivery` comparait le code à 4 chiffres (9000
--     valeurs) SANS aucun compteur d'essais ni lockout → un livreur attribué
--     peut tenter les 9000 codes en boucle pour valider une remise non
--     effectuée (fraude no-show).
--   • C-2 (MAJEUR) : `validate_delivery` complétait la livraison sans vérifier
--     que la commande avait été RÉCUPÉRÉE (`delivery_picked_up_at`).
--   • C-3 (MAJEUR) : `mark_delivery_picked_up` acceptait le pickup quel que soit
--     le statut amont (même 'pending').
--
-- CORRECTIF :
--   - Compteur `delivery_code_attempts` + `delivery_code_locked_until` sur
--     orders ; lockout 10 min après 5 essais erronés (réplique le modèle PIN
--     Coligo Pay). Reset à la validation réussie.
--   - `validate_delivery` exige `delivery_picked_up_at IS NOT NULL`.
--   - `mark_delivery_picked_up` exige `status IN ('preparing','ready')`.
--   - Suppression de l'overload 5-args obsolète de `validate_delivery`
--     (chemin non gardé, non appelé) pour réduire la surface.
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_code_attempts     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_code_locked_until TIMESTAMPTZ;

-- Retire l'overload obsolète (0114) — seul le 4-args est appelé (driver UI).
DROP FUNCTION IF EXISTS public.validate_delivery(UUID, TEXT, BOOLEAN, TEXT, INTEGER);

-- -----------------------------------------------------------------------------
-- validate_delivery (4-args) — base 0116 + lockout (F-2) + pickup requis (C-2)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_delivery(
  p_order_id        UUID,
  p_provided_code   TEXT,
  p_skip_code       BOOLEAN DEFAULT false,
  p_client_operation_id TEXT DEFAULT NULL
) RETURNS TABLE(ok BOOLEAN, reason TEXT) AS $$
DECLARE
  v_user UUID := auth.uid();
  v_driver_id UUID;
  v_order      public.orders%ROWTYPE;
  v_prepaid    BOOLEAN;
  v_bad_code   BOOLEAN := false;
  v_attempts   INTEGER;
  c_max_attempts CONSTANT INTEGER := 5;
  c_lock_minutes CONSTANT INTEGER := 10;
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

  -- F-2 : lockout anti brute-force.
  IF v_order.delivery_code_locked_until IS NOT NULL
     AND v_order.delivery_code_locked_until > now() THEN
    ok := false; reason := 'too_many_attempts'; RETURN NEXT; RETURN;
  END IF;

  -- C-2 : on ne valide pas une livraison jamais récupérée chez le commerçant.
  IF v_order.delivery_picked_up_at IS NULL THEN
    ok := false; reason := 'not_picked_up'; RETURN NEXT; RETURN;
  END IF;

  v_prepaid := (v_order.payment_method = 'online')
            OR (COALESCE(v_order.cashback_used_da, 0) > 0)
            OR (COALESCE(v_order.topup_used_da, 0) > 0);

  IF v_prepaid THEN
    IF p_skip_code OR p_provided_code IS NULL OR btrim(p_provided_code) = '' THEN
      ok := false; reason := 'code_required'; RETURN NEXT; RETURN;
    END IF;
    IF p_provided_code <> v_order.pickup_code THEN
      v_bad_code := true;
    END IF;
  ELSE
    IF NOT p_skip_code AND p_provided_code IS NOT NULL AND btrim(p_provided_code) <> '' THEN
      IF p_provided_code <> v_order.pickup_code THEN
        v_bad_code := true;
      END IF;
    END IF;
  END IF;

  IF v_bad_code THEN
    v_attempts := COALESCE(v_order.delivery_code_attempts, 0) + 1;
    UPDATE public.orders
      SET delivery_code_attempts = v_attempts,
          delivery_code_locked_until = CASE
            WHEN v_attempts >= c_max_attempts
            THEN now() + make_interval(mins => c_lock_minutes)
            ELSE delivery_code_locked_until END
      WHERE id = p_order_id;
    ok := false;
    reason := CASE WHEN v_attempts >= c_max_attempts THEN 'too_many_attempts' ELSE 'bad_code' END;
    RETURN NEXT; RETURN;
  END IF;

  UPDATE public.orders
    SET status = 'completed',
        delivery_delivered_at = now(),
        delivery_code_attempts = 0,
        delivery_code_locked_until = NULL,
        validated_without_code =
          (p_provided_code IS NULL OR btrim(p_provided_code) = '' OR p_skip_code)
          AND NOT v_prepaid
    WHERE id = p_order_id;

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

GRANT EXECUTE ON FUNCTION public.validate_delivery(UUID, TEXT, BOOLEAN, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- mark_delivery_picked_up — base 0048 + statut amont requis (C-3)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_delivery_picked_up(p_order_id UUID)
RETURNS TABLE(ok BOOLEAN, reason TEXT) AS $$
DECLARE
  v_driver_id UUID;
  v_order     public.orders%ROWTYPE;
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
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
    ok := false; reason := 'already_delivered'; RETURN NEXT; RETURN;
  END IF;
  -- C-3 : récupération possible seulement après mise en préparation.
  IF v_order.status NOT IN ('preparing', 'ready') THEN
    ok := false; reason := 'not_ready'; RETURN NEXT; RETURN;
  END IF;

  UPDATE public.orders
    SET delivery_picked_up_at = COALESCE(delivery_picked_up_at, now())
    WHERE id = p_order_id;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.mark_delivery_picked_up(UUID) TO authenticated;
