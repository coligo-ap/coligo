-- =============================================================================
-- 0365 — Drive : RELANCE de diffusion façon Bolt quand la recherche s'affame
-- =============================================================================
-- Avant : l'escalade de rayon (mig 0255) s'arrêtait au plafond (25 km). Une
-- course que tous les chauffeurs à portée avaient REFUSÉE ne repartait JAMAIS :
-- les refus la masquent de leurs listes (mig 0149/0257), plus personne ne la
-- voyait, le client attendait dans le vide jusqu'au TTL.
--
-- Désormais, au plafond, si la course n'a AUCUNE offre en attente (`offered`)
-- que le client pourrait accepter, et après un refroidissement plus long que
-- l'escalade (anti-spam FCM), on EFFACE les refus (`declined`) et on remet
-- `last_dispatch_at` : le serveur re-diffuse alors la MÊME demande (broadcast
-- + FCM) aux chauffeurs — y compris ceux qui l'avaient écartée — en boucle,
-- jusqu'à un preneur ou l'expiration (TTL `expires_at`).
--
-- Déclencheur inchangé (mig 0255) : le poll du CLIENT en attente, serveur
-- autoritaire (ownership + intervalle mini + plafond) — pas de cron rapide sur
-- le plan Vercel.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.drive_escalate_dispatch(p_ride_id UUID)
RETURNS INTEGER                       -- rayon (km) à re-diffuser, NULL si rien à faire
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ride     public.rides%ROWTYPE;
  v_default  INTEGER;
  v_step     INTEGER := 5;            -- +5 km par escalade
  v_max      INTEGER := 25;           -- plafond (= zone de travail max d'un chauffeur)
  v_interval INTERVAL := INTERVAL '25 seconds';
  -- Relance au plafond : refroidissement plus long (chaque relance ré-émet un
  -- FCM aux mêmes chauffeurs — on relance vite, mais sans harceler).
  v_relance  INTERVAL := INTERVAL '60 seconds';
  v_cur      INTEGER;
  v_next     INTEGER;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Propriété : seul le client de la course peut l'escalader (defense-in-depth).
  IF v_ride.customer_id NOT IN (
    SELECT id FROM public.customers WHERE user_id = auth.uid()
  ) THEN
    RETURN NULL;
  END IF;

  -- Uniquement une course EN RECHERCHE, sans chauffeur, payée si carte, non expirée.
  IF v_ride.status <> 'searching' OR v_ride.chauffeur_id IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF v_ride.payment_method = 'card' AND v_ride.online_paid_at IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_ride.expires_at IS NOT NULL AND v_ride.expires_at <= now() THEN
    RETURN NULL;
  END IF;

  -- Anti-rafale : au plus une (re)diffusion par intervalle.
  IF v_ride.last_dispatch_at IS NOT NULL
     AND v_ride.last_dispatch_at > now() - v_interval THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(drive_default_radius_km, 10) INTO v_default
    FROM public.platform_settings WHERE id = true;

  v_cur  := COALESCE(v_ride.dispatch_radius_km, v_default);
  v_next := LEAST(v_max, v_cur + v_step);

  -- 1. Tant qu'on n'est pas au plafond : élargir d'un cran (comportement 0255).
  IF v_next > v_cur THEN
    UPDATE public.rides
      SET dispatch_radius_km = v_next, last_dispatch_at = now()
      WHERE id = p_ride_id;
    RETURN v_next;
  END IF;

  -- 2. Plafond atteint : RELANCE façon Bolt — uniquement si la recherche
  --    s'affame (aucune offre en attente que le client pourrait accepter).
  IF EXISTS (
    SELECT 1 FROM public.ride_offers o
     WHERE o.ride_id = p_ride_id AND o.status = 'offered'
  ) THEN
    RETURN NULL;
  END IF;
  IF v_ride.last_dispatch_at IS NOT NULL
     AND v_ride.last_dispatch_at > now() - v_relance THEN
    RETURN NULL;
  END IF;

  -- Les refus sont effacés : la demande RÉAPPARAÎT chez les chauffeurs qui
  -- l'avaient écartée (même proposition, nouvelle chance), et la re-diffusion
  -- (broadcast + FCM) les prévient immédiatement.
  DELETE FROM public.ride_offers o
   WHERE o.ride_id = p_ride_id AND o.status = 'declined';

  UPDATE public.rides SET last_dispatch_at = now() WHERE id = p_ride_id;
  RETURN v_cur;
END;
$$;

GRANT EXECUTE ON FUNCTION public.drive_escalate_dispatch(UUID) TO authenticated;
