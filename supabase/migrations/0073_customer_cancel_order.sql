-- =============================================================================
-- 0073 — Annulation d'une commande PAR LE CLIENT (anti-fraude)
-- =============================================================================
-- Le client peut annuler SA commande UNIQUEMENT tant qu'elle n'est pas encore
-- acceptée par le commerçant (status = 'pending'). Règles :
--   - Propriété vérifiée côté serveur (auth.uid() → customers.id).
--   - Verrou de ligne (FOR UPDATE) + UPDATE ... WHERE status='pending' :
--     anti-course avec l'acceptation commerçant (un seul gagne).
--   - Paiement EN LIGNE déjà réglé (payment_status='paid') → annulation client
--     INTERDITE (remboursement manuel via support — pas de refund Chargily auto).
--   - Les triggers de re-crédit cashback/topup (mig 0017/0019) se déclenchent
--     automatiquement sur le passage à 'cancelled'.
--
-- `cancelled_by` distingue l'origine de l'annulation ('customer' / 'merchant' /
-- 'system') → permet au board commerçant d'afficher une alerte SEULEMENT quand
-- c'est le CLIENT qui annule (pas quand le commerçant refuse lui-même).
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT
    CHECK (cancelled_by IS NULL OR cancelled_by IN ('customer', 'merchant', 'system'));

CREATE OR REPLACE FUNCTION public.cancel_order_by_customer(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer uuid;
  v_order    RECORD;
BEGIN
  SELECT id INTO v_customer
  FROM public.customers
  WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'Profil client introuvable.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Verrouille la commande le temps de la décision (anti-course acceptation).
  SELECT id, customer_id, merchant_id, status, payment_method, payment_status,
         order_number, customer_name
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

  -- Payé en ligne → pas d'auto-annulation (remboursement manuel via support).
  IF v_order.payment_method = 'online' AND v_order.payment_status = 'paid' THEN
    RAISE EXCEPTION 'Commande déjà payée en ligne : contacte le support pour le remboursement.'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.orders
  SET status = 'cancelled', cancelled_by = 'customer'
  WHERE id = p_order_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La commande vient de changer d''état, réessaie.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Journal d'audit (idempotence non nécessaire : une seule annulation possible).
  INSERT INTO public.order_events (order_id, from_status, to_status, note)
  VALUES (p_order_id, 'pending', 'cancelled', 'Annulée par le client');

  RETURN jsonb_build_object(
    'ok', true,
    'merchant_id', v_order.merchant_id,
    'order_number', v_order.order_number,
    'customer_name', v_order.customer_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_order_by_customer(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cancel_order_by_customer(uuid) TO authenticated;
