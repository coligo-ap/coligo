-- =============================================================================
-- 0255 — Drive : re-dispatch avec ÉLARGISSEMENT progressif du rayon
-- =============================================================================
-- Quand une course reste « searching » sans preneur, on élargit progressivement
-- le rayon de DIFFUSION pour atteindre des chauffeurs plus loin — MAIS seulement
-- ceux qui ont choisi une grande « zone de travail » (le filtre par
-- work_zone_radius_km de chaque chauffeur reste la garde finale : on ne pousse
-- JAMAIS hors de la zone qu'il a acceptée). Pas de cron sub-journalier (plan
-- Vercel Hobby) : l'escalade est déclenchée par le POLL du CLIENT en attente
-- (écran /drive), serveur autoritaire (anti-abus : intervalle mini + plafond).
--
-- Mécanisme : `rides.dispatch_radius_km` (rayon courant de diffusion, NULL =
-- défaut plateforme) + `last_dispatch_at` (anti-rafale). La RPC
-- `drive_escalate_dispatch` augmente le rayon d'un cran (borné) et renvoie le
-- nouveau rayon ; le serveur re-diffuse alors (broadcast + FCM) — `notify
-- ChauffeursNewRide` lit désormais `dispatch_radius_km`.
-- =============================================================================

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS dispatch_radius_km INTEGER,
  ADD COLUMN IF NOT EXISTS last_dispatch_at   TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.drive_escalate_dispatch(p_ride_id UUID)
RETURNS INTEGER                       -- nouveau rayon (km), ou NULL si pas d'escalade
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ride        public.rides%ROWTYPE;
  v_default     INTEGER;
  v_step        INTEGER := 5;          -- +5 km par escalade
  v_max         INTEGER := 25;         -- plafond (= zone de travail max d'un chauffeur)
  v_interval    INTERVAL := INTERVAL '25 seconds';
  v_cur         INTEGER;
  v_next        INTEGER;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Propriété : seul le client de la course peut l'escalader (defense-in-depth).
  IF v_ride.customer_id NOT IN (
    SELECT id FROM public.customers WHERE user_id = auth.uid()
  ) THEN
    RETURN NULL;
  END IF;

  -- Uniquement une course EN RECHERCHE, sans chauffeur, payée si carte.
  IF v_ride.status <> 'searching' OR v_ride.chauffeur_id IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF v_ride.payment_method = 'card' AND v_ride.online_paid_at IS NULL THEN
    RETURN NULL;
  END IF;

  -- Anti-rafale : au plus une escalade par intervalle.
  IF v_ride.last_dispatch_at IS NOT NULL
     AND v_ride.last_dispatch_at > now() - v_interval THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(drive_default_radius_km, 10) INTO v_default
    FROM public.platform_settings WHERE id = true;

  v_cur  := COALESCE(v_ride.dispatch_radius_km, v_default);
  v_next := LEAST(v_max, v_cur + v_step);
  IF v_next <= v_cur THEN
    RETURN NULL;                        -- déjà au plafond
  END IF;

  UPDATE public.rides
    SET dispatch_radius_km = v_next, last_dispatch_at = now()
    WHERE id = p_ride_id;
  RETURN v_next;
END;
$$;

GRANT EXECUTE ON FUNCTION public.drive_escalate_dispatch(UUID) TO authenticated;
