-- ============================================================================
-- 0424 — DURCISSEMENT du panier partagé (audit sécurité 31/07/2026).
--
--  P1-3  share_token : 32 bits (8 hex) → 64 bits (16 hex) pour les NOUVEAUX
--        paniers (les liens existants restent valides). Un balayage d'espace
--        devient irréaliste (4,3e9 → 1,8e19).
--  P1-6  Anti-abus « commander depuis la room » : le porteur du lien ne peut
--        plus geler un panier en boucle → membre OBLIGATOIRE + 1 création /
--        10 min (fonction de garde appelée par createRoomOrder).
--  P1-7  GARDE COLONNES sur shared_carts : côté rôles client, seules les
--        colonnes « produit » sont modifiables. order_id, payment_token,
--        payer_reveal_hash, captain_customer_id, merchant_id, expires_at
--        deviennent intouchables via PostgREST (même pour le capitaine) —
--        même doctrine que protect_order_financial_fields (0166).
-- ============================================================================

-- 1) Jetons de partage plus longs (NOUVEAUX paniers uniquement).
ALTER TABLE public.shared_carts
  ALTER COLUMN share_token
  SET DEFAULT substr(md5(gen_random_uuid()::text), 1, 16);

-- 2) Garde colonnes (BEFORE UPDATE) — ne bride QUE les rôles de connexion
--    client ; service_role / SECURITY DEFINER gardent la main.
CREATE OR REPLACE FUNCTION public.protect_shared_cart_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.id                  := OLD.id;
    NEW.share_token         := OLD.share_token;
    NEW.captain_customer_id := OLD.captain_customer_id;
    NEW.merchant_id         := OLD.merchant_id;
    NEW.order_id            := OLD.order_id;
    NEW.payment_token       := OLD.payment_token;
    NEW.payment_token_created_at := OLD.payment_token_created_at;
    NEW.payer_reveal_hash   := OLD.payer_reveal_hash;
    NEW.pay_requested_at    := OLD.pay_requested_at;
    NEW.expires_at          := OLD.expires_at;
    NEW.created_at          := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_shared_cart_fields ON public.shared_carts;
CREATE TRIGGER trg_protect_shared_cart_fields
  BEFORE UPDATE ON public.shared_carts
  FOR EACH ROW EXECUTE FUNCTION public.protect_shared_cart_fields();

-- 3) Garde « commander depuis la room » : membre + throttle 10 min.
--    Renvoie 'ok' | 'not_member' | 'too_soon'. SECURITY DEFINER : lit les
--    membres (RLS capitaine seul) et écrit l'horodatage de tentative.
CREATE OR REPLACE FUNCTION public.shared_cart_can_room_order(
  p_token       text,
  p_guest_token uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_cart   public.shared_carts%ROWTYPE;
  v_member uuid;
BEGIN
  SELECT * INTO v_cart FROM public.shared_carts WHERE share_token = p_token;
  IF v_cart.id IS NULL THEN RETURN 'not_member'; END IF;

  -- Membre du panier (invité au guest_token connu, ou capitaine connecté).
  v_member := public._shared_cart_actor(v_cart.id, p_guest_token);
  IF v_member IS NULL THEN RETURN 'not_member'; END IF;

  -- Un seul déclenchement toutes les 10 min (anti-gel en boucle du panier).
  IF v_cart.pay_requested_at IS NOT NULL
     AND v_cart.pay_requested_at > now() - interval '10 minutes'
     AND v_cart.order_id IS NULL THEN
    RETURN 'too_soon';
  END IF;

  UPDATE public.shared_carts
     SET pay_requested_at = now()
   WHERE id = v_cart.id;
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.shared_cart_can_room_order(text, uuid)
  FROM PUBLIC, anon, authenticated;
