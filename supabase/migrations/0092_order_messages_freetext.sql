-- =============================================================================
-- 0092 — Chat in-app : texte libre (en plus des messages prédéfinis)
-- =============================================================================
-- Le client et le livreur peuvent désormais s'écrire en TEXTE LIBRE, en plus
-- des boutons rapides existants. Garde-fous demandés :
--   • limite de caractères par message  → 300 (tronqué/refusé côté RPC)
--   • limite de longueur de discussion  → 200 messages max par commande
--   • la discussion se FERME à la livraison → déjà garanti (le RPC refuse si
--     livrée / annulée, cf. statut + delivery_delivered_at).
--
-- Schéma : on ajoute une colonne `body` (texte libre) et on rend `code`
-- nullable (un message est SOIT un code prédéfini SOIT un texte libre).
-- =============================================================================

ALTER TABLE public.order_messages
  ADD COLUMN IF NOT EXISTS body TEXT;

ALTER TABLE public.order_messages
  ALTER COLUMN code DROP NOT NULL;

-- Un message porte exactement un contenu : un code OU un texte.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_messages_content_ck'
  ) THEN
    ALTER TABLE public.order_messages
      ADD CONSTRAINT order_messages_content_ck
      CHECK (code IS NOT NULL OR body IS NOT NULL);
  END IF;
END $$;

-- RPC texte libre : mêmes contrôles d'accès/état que send_order_message, plus
-- les deux limites (longueur de message + longueur de discussion).
CREATE OR REPLACE FUNCTION public.send_order_text_message(
  p_order_id UUID,
  p_text TEXT
) RETURNS TABLE(ok BOOLEAN, reason TEXT, sender_role TEXT) AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_order  public.orders%ROWTYPE;
  v_role   TEXT;
  v_text   TEXT := btrim(COALESCE(p_text, ''));
  v_count  INTEGER;
BEGIN
  IF length(v_text) = 0 THEN
    ok := false; reason := 'empty'; sender_role := NULL; RETURN NEXT; RETURN;
  END IF;
  IF length(v_text) > 300 THEN
    ok := false; reason := 'too_long'; sender_role := NULL; RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    ok := false; reason := 'order_not_found'; sender_role := NULL; RETURN NEXT; RETURN;
  END IF;

  -- Livraison active uniquement (la discussion se ferme à la livraison).
  IF v_order.fulfillment_type <> 'delivery'
     OR v_order.delivery_driver_id IS NULL
     OR v_order.delivery_delivered_at IS NOT NULL
     OR v_order.status IN ('completed', 'cancelled') THEN
    ok := false; reason := 'not_active'; sender_role := NULL; RETURN NEXT; RETURN;
  END IF;

  -- Rôle de l'appelant.
  IF EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = v_order.customer_id AND c.user_id = v_uid
  ) THEN
    v_role := 'customer';
  ELSIF EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = v_order.delivery_driver_id AND d.user_id = v_uid
  ) THEN
    v_role := 'courier';
  ELSE
    ok := false; reason := 'not_authorized'; sender_role := NULL; RETURN NEXT; RETURN;
  END IF;

  -- Longueur de discussion bornée (anti-spam / anti-flood).
  SELECT count(*) INTO v_count
  FROM public.order_messages
  WHERE order_id = p_order_id;
  IF v_count >= 200 THEN
    ok := false; reason := 'too_many'; sender_role := v_role; RETURN NEXT; RETURN;
  END IF;

  INSERT INTO public.order_messages (order_id, sender_role, sender_user_id, body)
  VALUES (p_order_id, v_role, v_uid, v_text);

  ok := true; reason := NULL; sender_role := v_role; RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.send_order_text_message(UUID, TEXT) TO authenticated;
