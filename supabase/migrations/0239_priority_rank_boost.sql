-- =============================================================================
-- 0239 — Pass Prioritaire : avantage RÉEL aussi dans le classement client
-- =============================================================================
-- Le pass Prioritaire (mig 0210) livrait déjà 2 avantages concrets :
--   (1) coup d'avance au dispatch : fenêtre `dispatch_priority_delay_sec` (10 s)
--       où l'offre est réservée aux Prioritaires — `chauffeur_offer_ride` (0210) ;
--   (2) badge « ⚡ Prioritaire » montré au client — `my_ride_offers` (0211),
--       rendu dans components/customer/drive/drive-ride.tsx.
--
-- MANQUAIT : le classement « Recommandés » côté client (`drive_rank_score`,
-- 0149, utilisé par `my_ride_offers ORDER BY rank_score DESC`) ne tenait PAS
-- compte du pass. Un Prioritaire pouvait proposer en PREMIER (avantage 1) tout
-- en s'affichant SOUS un non-abonné mieux noté → « proposé en premier » sonnait
-- creux. On ajoute donc un coup de pouce de visibilité au score : l'offre d'un
-- Prioritaire remonte dans la liste. Accélère SANS bloquer (jamais exclusif —
-- cohérent avec la promesse « la priorité accélère, sans jamais te bloquer »).
--
-- Reprend `drive_rank_score` (0149) À L'IDENTIQUE + facteur prioritaire ×1,12
-- (entre Pro 1,06 et Premium 1,15). Les plans payants étant masqués au lancement
-- (mig 0238), tout le monde est 'free' (×1,0) → le pass crée une vraie
-- différenciation de visibilité.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.drive_rank_score(
  p_chauffeur_id UUID, p_eta_km NUMERIC DEFAULT NULL
) RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  st RECORD; v_plan TEXT; v_online BOOLEAN; v_score NUMERIC;
BEGIN
  SELECT * INTO st FROM public.drive_chauffeur_stats(p_chauffeur_id);
  SELECT rp.plan INTO v_plan FROM public.resolve_drive_plan(p_chauffeur_id) rp;
  SELECT (p.is_online AND p.updated_at > now() - INTERVAL '2 minutes') INTO v_online
    FROM public.chauffeur_presence p WHERE p.chauffeur_id = p_chauffeur_id;

  v_score :=
      0.22 * LEAST(1, GREATEST(0, (COALESCE(st.rating, 4.2) - 3) / 2))        -- note moyenne
    + 0.12 * COALESCE(st.satisfaction, 0.75)                                  -- taux de satisfaction
    + 0.08 * COALESCE(st.win_rate, 0.50)                                      -- taux d'acceptation (offres retenues)
    + 0.10 * (1 - COALESCE(st.cancel_rate, 0.05))                             -- fiabilité (annulations)
    + 0.10 * COALESCE(st.punctuality, 0.75)                                   -- ponctualité
    + 0.06 * COALESCE(st.clean_rate, 1)                                       -- qualité (sans signalement)
    + 0.08 * LEAST(1, ln(1 + COALESCE(st.rides_done, 0)) / ln(301))           -- expérience (log, sature à ~300)
    + 0.05 * LEAST(1, COALESCE(st.seniority_days, 0) / 365.0)                 -- ancienneté
    + 0.14 * CASE WHEN p_eta_km IS NULL THEN 0.5
                  ELSE GREATEST(0, 1 - LEAST(p_eta_km, 8) / 8) END            -- proximité / ETA
    + 0.05 * CASE WHEN COALESCE(v_online, false) THEN 1 ELSE 0.4 END;         -- disponibilité temps réel

  v_score := v_score * CASE COALESCE(v_plan, 'free')
    WHEN 'premium' THEN 1.15 WHEN 'pro' THEN 1.06 ELSE 1.0 END;

  -- Pass Prioritaire (mig 0210) : coup de pouce de visibilité dans la liste
  -- « Recommandés » du client. Accélère, ne bloque jamais.
  IF public.is_priority('chauffeur', p_chauffeur_id) THEN
    v_score := v_score * 1.12;
  END IF;

  RETURN round(v_score * 100, 1);
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_rank_score(UUID, NUMERIC) TO authenticated, service_role;
