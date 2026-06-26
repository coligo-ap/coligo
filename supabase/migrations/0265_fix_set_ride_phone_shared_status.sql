-- =============================================================================
-- 0265 — Correctif set_ride_phone_shared : statuts ride_status VALIDES
-- =============================================================================
-- 0264 listait 'offered' (absent de l'enum ride_status) → la RPC échouait à
-- l'exécution (cast enum). On restreint aux statuts réels où le client peut
-- afficher/masquer son numéro (course non terminée).
-- =============================================================================

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
      AND status IN (
        'searching','scheduled','accepted','arriving','arrived','in_progress'
      );

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.set_ride_phone_shared(UUID, BOOLEAN) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_ride_phone_shared(UUID, BOOLEAN) TO authenticated;
