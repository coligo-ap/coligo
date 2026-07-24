-- =============================================================================
-- 0410 — Panier partagé : « un proche veut payer » (rappel au capitaine)
-- =============================================================================
-- La room affiche DEUX boutons en bas : « Ajouter des produits » et « Payer ».
-- Tant que le capitaine n'a pas validé la commande, le « Payer » d'un invité
-- PRÉVIENT le capitaine (push) — rate-limité à 1 rappel / 10 min par panier.
-- =============================================================================

ALTER TABLE public.shared_carts
  ADD COLUMN IF NOT EXISTS pay_requested_at TIMESTAMPTZ;

-- Pose le rappel (conditionnel : jamais plus d'un par 10 minutes).
CREATE OR REPLACE FUNCTION public.shared_cart_request_payment(p_token text)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cart public.shared_carts%ROWTYPE;
BEGIN
  IF public.feature_blocked('shared_cart') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;

  SELECT * INTO v_cart FROM public.shared_carts
   WHERE share_token = p_token FOR UPDATE;
  IF v_cart.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  -- Une commande existe déjà → le bouton doit rediriger vers /payer, pas ici.
  IF v_cart.order_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_ordered');
  END IF;
  IF v_cart.status NOT IN ('open', 'locked') OR now() > v_cart.expires_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'closed');
  END IF;
  IF v_cart.pay_requested_at IS NOT NULL
     AND v_cart.pay_requested_at > now() - interval '10 minutes' THEN
    -- Déjà prévenu récemment : on répond OK (l'invité n'a pas à le savoir).
    RETURN jsonb_build_object('ok', true, 'notified', false,
                              'captain_customer_id', v_cart.captain_customer_id);
  END IF;

  UPDATE public.shared_carts
     SET pay_requested_at = now(), updated_at = now()
   WHERE id = v_cart.id;

  RETURN jsonb_build_object('ok', true, 'notified', true,
                            'captain_customer_id', v_cart.captain_customer_id);
END;
$$;

REVOKE ALL ON FUNCTION public.shared_cart_request_payment(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shared_cart_request_payment(text) TO anon, authenticated;

-- =============================================================================
-- VÉRIFICATION : SELECT public.shared_cart_request_payment('deadbeef'); -- not_found
-- =============================================================================
