-- ============================================================
-- 0158 — « Je rentre chez moi » : limite ANTI-FRAUDE sur le
-- changement d'adresse domicile.
--
-- Sans limite, un chauffeur pouvait changer son « domicile » à
-- chaque course pour transformer le filtre directionnel en
-- sélecteur de courses gratuit. Règle :
--   - premier enregistrement : libre ;
--   - correction libre pendant 15 min après un changement
--     (erreur de saisie) — sans repousser le compteur ;
--   - ensuite : 1 changement par 7 jours (date de déblocage
--     renvoyée pour affichage).
-- L'ACTIVATION du filtre reste limitée par ailleurs (2/jour).
-- ============================================================

ALTER TABLE public.chauffeurs
  ADD COLUMN IF NOT EXISTS home_addr_changed_at TIMESTAMPTZ;

DROP FUNCTION IF EXISTS public.chauffeur_set_home(TEXT, DOUBLE PRECISION, DOUBLE PRECISION);

CREATE OR REPLACE FUNCTION public.chauffeur_set_home(
  p_addr TEXT,
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL
)
RETURNS TABLE(ok BOOLEAN, reason TEXT, next_allowed TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ch public.chauffeurs%ROWTYPE;
  v_new TEXT;
  v_grace BOOLEAN;
BEGIN
  SELECT * INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid() FOR UPDATE;
  IF v_ch.id IS NULL THEN ok:=false; reason:='not_a_chauffeur'; RETURN NEXT; RETURN; END IF;
  v_new := NULLIF(btrim(COALESCE(p_addr,'')),'');
  IF v_new IS NULL THEN ok:=false; reason:='empty_addr'; RETURN NEXT; RETURN; END IF;

  -- Adresse identique : no-op (ne consomme pas le quota).
  IF v_ch.home_addr_text = v_new
     AND v_ch.home_lat IS NOT DISTINCT FROM p_lat
     AND v_ch.home_lng IS NOT DISTINCT FROM p_lng THEN
    ok:=true; reason:='unchanged'; RETURN NEXT; RETURN;
  END IF;

  -- Fenêtre de correction : 15 min après le dernier changement.
  v_grace := v_ch.home_addr_changed_at IS NOT NULL
             AND v_ch.home_addr_changed_at > now() - INTERVAL '15 minutes';

  IF v_ch.home_addr_text IS NOT NULL
     AND v_ch.home_addr_changed_at IS NOT NULL
     AND NOT v_grace
     AND v_ch.home_addr_changed_at > now() - INTERVAL '7 days' THEN
    ok:=false; reason:='rate_limited';
    next_allowed := v_ch.home_addr_changed_at + INTERVAL '7 days';
    RETURN NEXT; RETURN;
  END IF;

  UPDATE public.chauffeurs
     SET home_addr_text = v_new,
         home_lat = p_lat,
         home_lng = p_lng,
         -- la correction sous 15 min ne repousse PAS le compteur (sinon on
         -- pourrait enchaîner les fenêtres de grâce indéfiniment)
         home_addr_changed_at = CASE WHEN v_grace THEN v_ch.home_addr_changed_at ELSE now() END
   WHERE id = v_ch.id;
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chauffeur_set_home(TEXT, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;
