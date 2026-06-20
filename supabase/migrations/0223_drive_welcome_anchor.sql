-- ============================================================================
-- 0223 — Nouveau client : remise « cosmétique » par ancrage (coût plateforme 0)
-- ----------------------------------------------------------------------------
-- Idée (proprio) : au lieu de FINANCER la 1ʳᵉ course, on affiche un prix gonflé
-- (ancre barrée) et un code « BIENVENUE −30% » qui ramène au prix NORMAL (réel).
-- Le chauffeur touche le prix réel, la plateforme ne paie RIEN — c'est un effet
-- d'ancrage psychologique (le client a l'impression d'une grosse remise).
--
--   ancre = prix_réel / (1 − rate)      (ex. rate 30% → ancre = réel × 1,43)
--   code BIENVENUE −rate                → ancre × (1 − rate) = prix_réel
--   le client paie le prix RÉEL ; « économie » affichée = ancre − réel.
-- ============================================================================

UPDATE public.platform_settings SET drive_newcustomer_rate = 0.30 WHERE id = true; -- remise de bienvenue affichée

-- Le type de retour change (0222 → 0223) : DROP obligatoire avant CREATE.
DROP FUNCTION IF EXISTS public.drive_first_ride_offer(INTEGER);
CREATE OR REPLACE FUNCTION public.drive_first_ride_offer(p_reco_da INTEGER)
RETURNS TABLE(is_new BOOLEAN, anchor_da INTEGER, pay_da INTEGER, save_da INTEGER, code TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE s public.platform_settings%ROWTYPE; v_cust UUID; v_done INTEGER; v_rate NUMERIC;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  pay_da := GREATEST(0, COALESCE(p_reco_da, 0));
  is_new := false; anchor_da := pay_da; save_da := 0; code := NULL;
  IF NOT s.drive_newcustomer_enabled THEN RETURN NEXT; RETURN; END IF;
  SELECT cu.id INTO v_cust FROM public.customers cu WHERE cu.user_id = auth.uid();
  IF v_cust IS NULL THEN RETURN NEXT; RETURN; END IF;
  SELECT count(*)::INTEGER INTO v_done
    FROM public.rides r WHERE r.customer_id = v_cust AND r.status = 'completed';
  IF v_done = 0 THEN
    v_rate := LEAST(0.5, GREATEST(0, s.drive_newcustomer_rate));
    is_new := true;
    -- ancre gonflée : barème affiché AVANT le code (atterrit au prix réel après −rate).
    anchor_da := (round(pay_da / GREATEST(0.5, 1 - v_rate) / 5) * 5)::INTEGER;
    save_da := anchor_da - pay_da;
    code := 'BIENVENUE';
  END IF;
  RETURN NEXT;
END; $$;
GRANT EXECUTE ON FUNCTION public.drive_first_ride_offer(INTEGER) TO authenticated;
