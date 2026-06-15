-- =============================================================================
-- 0175 — Accusés de lecture du chat Drive (Envoyé / Reçu / Lu)
-- =============================================================================
-- Ajoute delivered_at / read_at à ride_messages et un RPC SECURITY DEFINER qui
-- laisse le DESTINATAIRE marquer les messages reçus (delivered) puis lus (read).
-- On NE rouvre PAS d'UPDATE client (l'historique du corps reste immuable, 0165) :
-- le RPC ne touche que les deux horodatages, et seulement sur les messages de
-- l'AUTRE camp.
-- =============================================================================

ALTER TABLE public.ride_messages
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.mark_ride_messages_read(
  p_ride_id UUID,
  p_read BOOLEAN DEFAULT TRUE
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_customer BOOLEAN;
  v_is_chauffeur BOOLEAN;
  v_other TEXT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.rides r
    JOIN public.customers cu ON cu.id = r.customer_id
    WHERE r.id = p_ride_id AND cu.user_id = auth.uid()
  ) INTO v_is_customer;

  SELECT EXISTS (
    SELECT 1 FROM public.rides r
    JOIN public.chauffeurs c ON c.id = r.chauffeur_id
    WHERE r.id = p_ride_id AND c.user_id = auth.uid()
  ) INTO v_is_chauffeur;

  IF NOT v_is_customer AND NOT v_is_chauffeur THEN
    RETURN;
  END IF;

  -- Le lecteur marque les messages envoyés par l'AUTRE camp.
  v_other := CASE WHEN v_is_customer THEN 'chauffeur' ELSE 'customer' END;

  UPDATE public.ride_messages
     SET delivered_at = COALESCE(delivered_at, now()),
         read_at = CASE WHEN p_read THEN COALESCE(read_at, now()) ELSE read_at END
   WHERE ride_id = p_ride_id
     AND sender = v_other
     AND (delivered_at IS NULL OR (p_read AND read_at IS NULL));
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_ride_messages_read(UUID, BOOLEAN) TO authenticated;
