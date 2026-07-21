-- =============================================================================
-- 0393 — Coligo Drive : FENÊTRE DE PAIEMENT carte (expiration → annulation)
-- =============================================================================
-- Modèle « payer à l'acceptation » (0386) : quand le client choisit un
-- chauffeur, l'offre est RÉSERVÉE 3 min le temps du paiement. Jusqu'ici, une
-- réservation périmée était juste effacée EN SILENCE
-- (drive_release_stale_reservations) : la course restait en recherche, le
-- chauffeur n'apprenait jamais qu'il avait été retenu puis relâché, et rien
-- n'était tracé.
--
-- APRÈS : la fenêtre de paiement devient un vrai état métier.
--   - le client dispose de `reserved_until` (renvoyé à la réservation) pour
--     payer — un compte à rebours s'affiche côté client ;
--   - à l'expiration : la course est ANNULÉE (cancelled_by =
--     'system_payment_timeout'), TOUTES ses offres passent en 'expired' et le
--     chauffeur redevient immédiatement disponible ;
--   - la fonction RENVOIE les lignes expirées : l'appelant JS notifie le
--     chauffeur (push + cloche) — « paiement non finalisé, vous êtes de
--     nouveau disponible » — pour qu'il ne reste jamais bloqué sans explication.
--
-- Anti-fraude / robustesse :
--   - aucun paramètre : impossible de viser la course d'autrui, la fonction ne
--     traite QUE des lignes objectivement périmées (bypass-proof) ;
--   - verrou FOR UPDATE sur la course avant annulation : un paiement confirmé
--     dans la même seconde (webhook) gagne, on n'annule JAMAIS une course
--     payée ;
--   - un webhook qui arrive APRÈS l'annulation retombe sur le chemin de
--     remboursement existant de drive_card_accept_reserved (course non
--     'searching' ⇒ recrédit Coligo Pay idempotent) : jamais de débit sans
--     course.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) La réservation renvoie sa DATE LIMITE (compte à rebours client).
--    Changement de colonnes de retour ⇒ DROP + CREATE (CREATE OR REPLACE ne
--    peut pas modifier le type de retour), puis re-GRANT.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.drive_card_reserve_offer(uuid);

CREATE FUNCTION public.drive_card_reserve_offer(p_offer_id uuid)
RETURNS TABLE (
  ok boolean, reason text, price_da integer, ride_id uuid, reserved_until timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer uuid;
  v_offer public.ride_offers%ROWTYPE;
  v_ride public.rides%ROWTYPE;
  v_deadline timestamptz;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN ok:=false; reason:='no_customer'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_offer FROM public.ride_offers WHERE id = p_offer_id FOR UPDATE;
  IF v_offer.id IS NULL THEN ok:=false; reason:='offer_not_found'; RETURN NEXT; RETURN; END IF;
  IF v_offer.status <> 'offered'
     OR (v_offer.expires_at IS NOT NULL AND v_offer.expires_at < now()) THEN
    ok:=false; reason:='offer_expired'; RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = v_offer.ride_id FOR UPDATE;
  IF v_ride.customer_id <> v_customer THEN ok:=false; reason:='not_your_ride'; RETURN NEXT; RETURN; END IF;
  IF v_ride.payment_method <> 'card' THEN ok:=false; reason:='not_card'; RETURN NEXT; RETURN; END IF;
  IF v_ride.online_paid_at IS NOT NULL THEN ok:=false; reason:='already_paid'; RETURN NEXT; RETURN; END IF;
  IF v_ride.status <> 'searching' THEN ok:=false; reason:='ride_not_open'; RETURN NEXT; RETURN; END IF;

  PERFORM 1 FROM public.chauffeurs c WHERE c.id = v_offer.chauffeur_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.rides r WHERE r.chauffeur_id = v_offer.chauffeur_id
             AND r.status IN ('accepted','arriving','arrived','in_progress')) THEN
    ok:=false; reason:='chauffeur_busy'; RETURN NEXT; RETURN;
  END IF;
  IF public._drive_chauffeur_reserved_elsewhere(v_offer.chauffeur_id, v_ride.id) THEN
    ok:=false; reason:='chauffeur_busy'; RETURN NEXT; RETURN;
  END IF;

  -- Libère une réservation précédente du même client sur CETTE course (il
  -- change de chauffeur) puis réserve celle-ci.
  UPDATE public.ride_offers SET reserved_until = NULL, reserved_by = NULL
   WHERE ride_offers.ride_id = v_ride.id AND id <> p_offer_id
     AND status = 'offered' AND reserved_by = v_customer;

  v_deadline := now() + interval '3 minutes';
  UPDATE public.ride_offers
     SET reserved_until = v_deadline, reserved_by = v_customer
   WHERE id = p_offer_id;

  ok:=true; reason:=NULL; price_da:=v_offer.price_da; ride_id:=v_ride.id;
  reserved_until:=v_deadline; RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.drive_card_reserve_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.drive_card_reserve_offer(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Expiration de la fenêtre de paiement : annule la course, libère et
--    RENVOIE les chauffeurs à notifier.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_card_expire_payments()
RETURNS TABLE (
  ride_id uuid, chauffeur_id uuid, offer_id uuid, customer_id uuid, price_da integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v RECORD; v_locked uuid;
BEGIN
  FOR v IN
    SELECT o.id AS oid, o.ride_id AS rid, o.chauffeur_id AS chid,
           o.price_da AS price, r.customer_id AS cust
      FROM public.ride_offers o
      JOIN public.rides r ON r.id = o.ride_id
     WHERE o.status = 'offered'
       AND o.reserved_by IS NOT NULL
       AND o.reserved_until IS NOT NULL
       AND o.reserved_until < now()
       AND r.status = 'searching'
       AND r.payment_method = 'card'
       AND r.online_paid_at IS NULL
     ORDER BY o.reserved_until
     LIMIT 50
  LOOP
    -- Re-vérification SOUS VERROU : si le webhook a payé entre le SELECT et
    -- ici, la course n'est plus 'searching' → on la laisse tranquille.
    SELECT id INTO v_locked FROM public.rides
     WHERE id = v.rid AND status = 'searching' AND online_paid_at IS NULL
     FOR UPDATE;
    CONTINUE WHEN v_locked IS NULL;

    -- Le chauffeur retenu est libéré, et toutes les offres de la course
    -- tombent (la course n'existe plus) → aucun écran chauffeur ne reste
    -- collé sur une demande morte.
    UPDATE public.ride_offers
       SET reserved_until = NULL, reserved_by = NULL, status = 'expired'
     WHERE ride_offers.ride_id = v.rid AND status = 'offered';

    UPDATE public.rides
       SET status = 'cancelled',
           cancelled_at = now(),
           cancelled_by = 'system_payment_timeout',
           card_failed_at = now()
     WHERE id = v.rid;

    ride_id := v.rid; chauffeur_id := v.chid; offer_id := v.oid;
    customer_id := v.cust; price_da := v.price;
    RETURN NEXT;
    v_locked := NULL;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.drive_card_expire_payments() FROM PUBLIC, anon;
-- Appelée en fire-and-forget par les ticks client ET chauffeur (pas de cron
-- sub-minute possible sur Vercel) : aucun argument, donc rien à falsifier.
GRANT EXECUTE ON FUNCTION public.drive_card_expire_payments() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) NEUTRALISATION de l'ancien nettoyage SILENCIEUX.
--    drive_expire_stale_searches() (0388) appelle drive_release_stale_reservations()
--    à chaque tick chauffeur. S'il continuait d'effacer reserved_by/reserved_until,
--    il EFFACERAIT LA PREUVE de la fenêtre expirée avant que
--    drive_card_expire_payments() ne puisse annuler la course et faire notifier
--    le chauffeur → expirations muettes, exactement ce qu'on veut supprimer.
--    On garde donc la fonction (appelée par 0388) mais elle ne fait plus rien :
--    l'expiration des fenêtres de paiement a UN SEUL chemin, celui qui notifie.
--    Une réservation périmée non balayée est inoffensive : _drive_chauffeur_
--    reserved_elsewhere ne compte que `reserved_until > now()`, le chauffeur
--    n'est donc jamais bloqué au-delà de la fenêtre.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_release_stale_reservations()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- Volontairement vide : cf. commentaire ci-dessus (mig 0393).
  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION public.drive_release_stale_reservations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.drive_release_stale_reservations() TO authenticated, service_role;
