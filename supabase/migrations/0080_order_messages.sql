-- =============================================================================
-- 0080 — Chat in-app léger client ↔ livreur (messages prédéfinis)
-- =============================================================================
-- Messagerie minimaliste attachée à UNE commande en livraison. Pas de texte
-- libre : seulement des codes de messages prédéfinis (cf. lib/chat/messages.ts)
-- rendus/localisés côté client (FR/AR). Le client et SON livreur attribué
-- peuvent échanger tant que la livraison est active.
--
-- Archi : table dédiée `order_messages` (≠ orders, volume potentiellement
-- multiple par commande). Realtime activé dessus → le destinataire reçoit le
-- message en direct. L'INSERT passe par le RPC SECURITY DEFINER
-- `send_order_message` (détermine le rôle de l'appelant + valide l'état) ; la
-- lecture passe par RLS (chacun ne voit que les messages de SA commande).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.order_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  sender_role    TEXT NOT NULL CHECK (sender_role IN ('customer', 'courier')),
  sender_user_id UUID NOT NULL,
  code           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS order_messages_order_idx
  ON public.order_messages (order_id, created_at);

ALTER TABLE public.order_messages ENABLE ROW LEVEL SECURITY;

-- Lecture : le CLIENT propriétaire de la commande.
DROP POLICY IF EXISTS order_messages_select_customer ON public.order_messages;
CREATE POLICY order_messages_select_customer ON public.order_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders o
      JOIN public.customers c ON c.id = o.customer_id
      WHERE o.id = order_messages.order_id
        AND c.user_id = auth.uid()
    )
  );

-- Lecture : le LIVREUR attribué à la commande.
DROP POLICY IF EXISTS order_messages_select_driver ON public.order_messages;
CREATE POLICY order_messages_select_driver ON public.order_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders o
      JOIN public.drivers d ON d.id = o.delivery_driver_id
      WHERE o.id = order_messages.order_id
        AND d.user_id = auth.uid()
    )
  );

-- Pas de policy INSERT/UPDATE : l'écriture passe UNIQUEMENT par le RPC ci-dessous.

-- RPC d'envoi : détermine le rôle de l'appelant (client OU livreur attribué),
-- valide que la livraison est active, puis insère. SECURITY DEFINER pour
-- contourner l'absence de policy INSERT.
CREATE OR REPLACE FUNCTION public.send_order_message(
  p_order_id UUID,
  p_code TEXT
) RETURNS TABLE(ok BOOLEAN, reason TEXT, sender_role TEXT) AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_order public.orders%ROWTYPE;
  v_role  TEXT;
BEGIN
  IF p_code IS NULL OR length(p_code) = 0 OR length(p_code) > 40 THEN
    ok := false; reason := 'bad_code'; sender_role := NULL; RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    ok := false; reason := 'order_not_found'; sender_role := NULL; RETURN NEXT; RETURN;
  END IF;

  -- Livraison active uniquement : commande en livraison, livreur attribué, pas
  -- encore livrée / annulée.
  IF v_order.fulfillment_type <> 'delivery'
     OR v_order.delivery_driver_id IS NULL
     OR v_order.delivery_delivered_at IS NOT NULL
     OR v_order.status IN ('completed', 'cancelled') THEN
    ok := false; reason := 'not_active'; sender_role := NULL; RETURN NEXT; RETURN;
  END IF;

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

  INSERT INTO public.order_messages (order_id, sender_role, sender_user_id, code)
  VALUES (p_order_id, v_role, v_uid, p_code);

  ok := true; reason := NULL; sender_role := v_role; RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.send_order_message(UUID, TEXT) TO authenticated;

-- Active Realtime sur la table (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'order_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_messages;
  END IF;
END $$;
