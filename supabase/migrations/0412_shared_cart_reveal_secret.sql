-- =============================================================================
-- 0412 — Panier partagé : le code de retrait ne se révèle qu'AU PAYEUR
-- =============================================================================
-- Revue sécurité : depuis 0411, shared_cart_payment_info renvoyait
-- order_number + pickup_code à TOUT porteur du lien public /payer/{ptoken}
-- une fois la commande payée — or ce lien circule dans le groupe WhatsApp
-- (et 0409 permet de le générer depuis la room). Un inconnu à qui le lien
-- fuit pouvait présenter le code au commerçant et repartir avec la commande.
-- Décision :
--   1. Un SECRET DE RÉVÉLATION est généré au démarrage du paiement
--      (startGuestPayment / startGuestIntlPayment) et remis au SEUL navigateur
--      du payeur ; la table ne stocke que son hash sha256. Deux payeurs
--      simultanés : le dernier à démarrer gagne le secret — l'autre voit
--      « payé » sans les codes (le capitaine, lui, a tout sur SA commande).
--   2. shared_cart_payment_info(p_payment_token, p_reveal) ne renvoie
--      order_number + pickup_code que si le secret correspond ET payé.
--   3. Commande en LIVRAISON : pickup_code JAMAIS renvoyé ici (c'est le PIN
--      que le DESTINATAIRE donne au LIVREUR) ; la RPC expose is_delivery pour
--      que la page affiche le bon libellé.
-- =============================================================================

ALTER TABLE public.shared_carts
  ADD COLUMN IF NOT EXISTS payer_reveal_hash text;

-- Signature étendue → DROP obligatoire (CREATE OR REPLACE créerait une
-- SURCHARGE (text) + (text, text) ambiguë pour PostgREST).
DROP FUNCTION IF EXISTS public.shared_cart_payment_info(text);

CREATE FUNCTION public.shared_cart_payment_info(
  p_payment_token text,
  p_reveal text DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cart public.shared_carts%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_captain text;
  v_paid boolean;
  v_reveal_ok boolean;
  v_delivery boolean;
BEGIN
  IF public.feature_blocked('shared_cart') THEN RETURN NULL; END IF;

  SELECT * INTO v_cart FROM public.shared_carts
   WHERE payment_token = p_payment_token;
  IF v_cart.id IS NULL OR v_cart.order_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_cart.order_id;
  IF v_order.id IS NULL THEN RETURN NULL; END IF;

  SELECT split_part(btrim(COALESCE(c.full_name, '')), ' ', 1) INTO v_captain
    FROM public.customers c WHERE c.id = v_cart.captain_customer_id;

  v_paid := v_order.payment_status IN ('paid', 'refunded');
  -- Seul le navigateur qui a DÉMARRÉ le paiement détient le secret en clair.
  v_reveal_ok := p_reveal IS NOT NULL
             AND v_cart.payer_reveal_hash IS NOT NULL
             AND encode(extensions.digest(p_reveal, 'sha256'), 'hex')
                 = v_cart.payer_reveal_hash;
  v_delivery := v_order.fulfillment_type = 'delivery';

  RETURN jsonb_build_object(
    'captain_name', NULLIF(v_captain, ''),
    'merchant', (
      SELECT jsonb_build_object('name', m.name, 'logo_url', m.logo_url)
        FROM public.merchants m WHERE m.id = v_cart.merchant_id
    ),
    'total_da', v_order.total_da,
    'payment_status', v_order.payment_status,
    'order_status', v_order.status,
    'share_token', v_cart.share_token,
    'is_delivery', v_delivery,
    -- Révélés APRÈS paiement et AU PAYEUR seulement — le lien, lui, circule.
    'order_number', CASE WHEN v_paid AND v_reveal_ok
                         THEN v_order.order_number END,
    'pickup_code',  CASE WHEN v_paid AND v_reveal_ok AND NOT v_delivery
                          AND v_order.status <> 'cancelled'
                         THEN v_order.pickup_code END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.shared_cart_payment_info(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shared_cart_payment_info(text, text) TO anon, authenticated;

-- =============================================================================
-- VÉRIFICATION :
--   SELECT public.shared_cart_payment_info('inconnu');            -- NULL (anon OK)
--   -- payé SANS p_reveal → payment_status présent, codes ABSENTS ;
--   -- payé AVEC le bon p_reveal (retrait) → order_number + pickup_code ;
--   -- livraison → pickup_code toujours absent (PIN livreur du destinataire).
-- =============================================================================
