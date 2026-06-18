-- ============================================================
-- 0202 — « Je rentre chez moi » : passe la limite de changement
-- d'adresse domicile de 1×/semaine à 3×/semaine (fenêtre glissante
-- de 7 jours), conformément à la demande produit.
--
-- Comptage par FENÊTRE de 7 jours :
--   - première fenêtre ouverte au 1er changement ;
--   - jusqu'à 3 changements par fenêtre ;
--   - au-delà : rate_limited, déblocage = window_start + 7 jours ;
--   - correction libre 15 min après un changement (ne consomme pas) ;
--   - fenêtre expirée (> 7 j) → réinitialisée au changement suivant.
-- L'activation du filtre directionnel reste limitée par ailleurs.
-- ============================================================

ALTER TABLE public.chauffeurs
  ADD COLUMN IF NOT EXISTS home_addr_change_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS home_addr_window_start TIMESTAMPTZ;

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
  v_new_window BOOLEAN;
  v_window TIMESTAMPTZ;
  v_count INT;
  v_limit CONSTANT INT := 3;
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

  -- Fenêtre de correction : 15 min après le dernier changement (ne consomme pas).
  v_grace := v_ch.home_addr_changed_at IS NOT NULL
             AND v_ch.home_addr_changed_at > now() - INTERVAL '15 minutes';

  -- Fenêtre glissante de 7 jours : neuve si jamais ouverte ou expirée.
  v_new_window := v_ch.home_addr_window_start IS NULL
                  OR v_ch.home_addr_window_start <= now() - INTERVAL '7 days';
  v_window := CASE WHEN v_new_window THEN now() ELSE v_ch.home_addr_window_start END;
  v_count := CASE WHEN v_new_window THEN 0 ELSE COALESCE(v_ch.home_addr_change_count, 0) END;

  -- Limite : 3 changements par fenêtre (hors correction de 15 min).
  IF v_ch.home_addr_text IS NOT NULL
     AND NOT v_grace
     AND v_count >= v_limit THEN
    ok:=false; reason:='rate_limited';
    next_allowed := v_window + INTERVAL '7 days';
    RETURN NEXT; RETURN;
  END IF;

  UPDATE public.chauffeurs
     SET home_addr_text = v_new,
         home_lat = p_lat,
         home_lng = p_lng,
         -- la correction sous 15 min ne repousse PAS le compteur/fenêtre
         home_addr_changed_at = CASE WHEN v_grace THEN v_ch.home_addr_changed_at ELSE now() END,
         home_addr_window_start = CASE WHEN v_grace THEN v_ch.home_addr_window_start ELSE v_window END,
         home_addr_change_count = CASE WHEN v_grace THEN v_ch.home_addr_change_count ELSE v_count + 1 END
   WHERE id = v_ch.id;
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chauffeur_set_home(TEXT, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;
