-- =============================================================================
-- 0245 — État PERSISTANT du filtre « Je rentre chez moi » (chauffeur)
-- =============================================================================
-- Jusqu'ici le toggle « je rentre chez moi » ne vivait QUE côté client
-- (localStorage). Le serveur ne traçait qu'un quota d'activations/jour
-- (home_dir_count/home_dir_date). Conséquence : le PUSH de nouvelle course ne
-- pouvait pas respecter ce filtre → un chauffeur en mode « retour maison »
-- recevait une notif pour une course à l'opposé de son domicile, absente de sa
-- liste (qui, elle, filtre côté client). Incohérence push ⇄ écrans.
--
-- On ajoute un FLAG persistant `home_dir_active` (source de vérité serveur) que
-- le trigger de push lit pour filtrer par direction (cf. lib/fcm/triggers.ts,
-- via la fonction PURE passesHomeDir partagée client+serveur).
-- =============================================================================

ALTER TABLE public.chauffeurs
  ADD COLUMN IF NOT EXISTS home_dir_active boolean NOT NULL DEFAULT false;

-- Activation : conserve le quota journalier ET pose le flag actif.
CREATE OR REPLACE FUNCTION public.chauffeur_home_dir_activate()
RETURNS TABLE(ok BOOLEAN, reason TEXT, remaining INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE s public.platform_settings%ROWTYPE; v_ch public.chauffeurs%ROWTYPE; v_today DATE; v_count INTEGER;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT * INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid() FOR UPDATE;
  IF v_ch.id IS NULL THEN ok:=false; reason:='not_a_chauffeur'; remaining:=0; RETURN NEXT; RETURN; END IF;
  IF v_ch.home_addr_text IS NULL THEN ok:=false; reason:='no_home_addr'; remaining:=0; RETURN NEXT; RETURN; END IF;
  v_today := (now() AT TIME ZONE 'Africa/Algiers')::DATE;
  v_count := CASE WHEN v_ch.home_dir_date = v_today THEN v_ch.home_dir_count ELSE 0 END;
  IF v_count >= s.drive_home_dir_max_per_day THEN
    ok:=false; reason:='daily_limit'; remaining:=0; RETURN NEXT; RETURN;
  END IF;
  UPDATE public.chauffeurs
     SET home_dir_date = v_today, home_dir_count = v_count + 1, home_dir_active = true
   WHERE id = v_ch.id;
  ok:=true; reason:=NULL; remaining := s.drive_home_dir_max_per_day - v_count - 1; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chauffeur_home_dir_activate() TO authenticated;

-- Désactivation : retire le flag (le quota du jour reste consommé).
CREATE OR REPLACE FUNCTION public.chauffeur_home_dir_deactivate()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.chauffeurs SET home_dir_active = false WHERE user_id = auth.uid();
END;
$$;
GRANT EXECUTE ON FUNCTION public.chauffeur_home_dir_deactivate() TO authenticated;
