-- =============================================================================
-- 0129 — Express : sur le réseau livreurs DÈS le début de la préparation
-- =============================================================================
-- Décision fondateur (2026-06-10) : on N'ATTEND PLUS la fin de préparation pour
-- proposer la course aux livreurs. Dès que le commerçant commence à préparer
-- (status → preparing), la commande Express est immédiatement ATTRIBUABLE sur le
-- réseau (le livreur peut foncer pendant que le plat se prépare). Concrètement :
--   prep_notif_at := now()  (au lieu de now() + (prep − ~3 min)).
--
-- On conserve prep_estimated_ready_at (info « prêt vers HH:MM ») et marked_ready_at.
-- (Reprend 0060 à l'identique, seul prep_notif_at change.)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_express_prep_timing()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_prep    INTEGER;
  v_default INTEGER;
  v_min     INTEGER;
  v_max     INTEGER;
BEGIN
  -- Marqueur « prêt » (accélérateur) au passage en ready.
  IF NEW.status = 'ready' AND NEW.marked_ready_at IS NULL THEN
    NEW.marked_ready_at := now();
  END IF;

  -- Timing calculé UNE fois, au passage en preparing d'une commande Express.
  IF NEW.delivery_mode = 'express'
     AND NEW.status = 'preparing'
     AND NEW.prep_started_at IS NULL THEN

    SELECT default_prep_time_minutes, min_prep_time_minutes, max_prep_time_minutes
      INTO v_default, v_min, v_max
    FROM public.platform_settings LIMIT 1;
    v_default := COALESCE(v_default, 10);
    v_min := COALESCE(v_min, 5);
    v_max := COALESCE(v_max, 30);

    SELECT prep_time_min INTO v_prep FROM public.merchants WHERE id = NEW.merchant_id;
    v_prep := LEAST(GREATEST(COALESCE(v_prep, v_default), v_min), v_max);

    NEW.prep_started_at := now();
    NEW.prep_estimated_ready_at := now() + make_interval(mins => v_prep);
    -- DISPATCH IMMÉDIAT : sur le réseau livreurs dès le début de la préparation.
    NEW.prep_notif_at := now();
  END IF;

  RETURN NEW;
END;
$$;
