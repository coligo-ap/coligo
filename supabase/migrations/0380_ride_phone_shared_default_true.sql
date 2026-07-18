-- =============================================================================
-- 0380 — Numéro du client AFFICHÉ par défaut au chauffeur (décision produit
-- 18/07/2026, inverse du défaut privacy-first de la mig 0264)
-- =============================================================================
-- Le numéro réel (ou celui du proche) est partagé au chauffeur dès la
-- création de la course ; le client peut le MASQUER à tout moment via le
-- toggle de l'écran course (set_ride_phone_shared, gating SERVEUR inchangé :
-- masqué ⇒ le numéro ne quitte jamais la base).

ALTER TABLE public.rides
  ALTER COLUMN client_phone_shared SET DEFAULT true;

-- Courses ACTIVES en cours : on les aligne sur la nouvelle politique (le
-- client garde le toggle pour re-masquer immédiatement s'il préfère).
UPDATE public.rides
   SET client_phone_shared = true
 WHERE status IN ('searching','scheduled','accepted','arriving','arrived','in_progress')
   AND client_phone_shared = false;
