-- =============================================================================
-- 0264 — Partage du numéro client au chauffeur (Coligo Call vs numéro direct)
-- =============================================================================
-- Par défaut le numéro réel du client n'est PAS partagé : le chauffeur ne peut
-- joindre le client que via Coligo Call (appel in-app Agora, aucun numéro
-- exposé). Le client peut CHOISIR d'afficher son vrai numéro (toggle), à tout
-- moment, y compris pendant la course. Le déblocage est gaté CÔTÉ SERVEUR : tant
-- que client_phone_shared = false, le numéro réel n'est JAMAIS envoyé au front
-- chauffeur (cf. getChauffeurActiveRide) — pas un simple masquage visuel.
-- =============================================================================

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS client_phone_shared BOOLEAN NOT NULL DEFAULT false;

-- RPC : le CLIENT (propriétaire de la course) bascule le partage de son numéro.
-- SECURITY DEFINER + garde d'appartenance ; ne touche que ses courses actives.
CREATE OR REPLACE FUNCTION public.set_ride_phone_shared(
  p_ride_id UUID,
  p_shared BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer UUID;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'not a customer';
  END IF;

  UPDATE public.rides
    SET client_phone_shared = COALESCE(p_shared, false)
    WHERE id = p_ride_id
      AND customer_id = v_customer
      AND status IN ('searching','offered','accepted','arriving','arrived','in_progress');

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.set_ride_phone_shared(UUID, BOOLEAN) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_ride_phone_shared(UUID, BOOLEAN) TO authenticated;
