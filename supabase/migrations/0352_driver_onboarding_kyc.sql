-- =============================================================================
-- 0352 — Parcours d'inscription livreur (KYC) + verrouillage bypass-proof
-- =============================================================================
-- Problème corrigé : à la création de son compte, un livreur pouvait revenir en
-- arrière, atteindre l'accueil, se mettre EN LIGNE et recevoir des courses sans
-- avoir transmis le moindre document ni été validé par l'équipe Coligo.
--
-- Modèle d'états (source de vérité = la base) :
--   1. compte créé              → submitted_at IS NULL            (dossier KYC)
--   2. dossier envoyé           → submitted_at NOT NULL, !verified (attente)
--   3. refusé par l'équipe      → rejected_at NOT NULL, submitted_at = NULL
--   4. compte vérifié           → is_verified = true
--   5. félicitations vues       → verified_ack_at NOT NULL
--   6. mode d'activité choisi   → onboarding_done_at NOT NULL     (compte actif)
--
-- Le verrouillage est appliqué en base (ici), côté serveur (server actions) et
-- côté interface. Même en appelant les RPC directement avec un JWT valide, un
-- livreur NON VÉRIFIÉ ne peut ni se mettre en ligne, ni être présent pour le
-- dispatch, ni rejoindre un commerçant, ni démarrer une tournée.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Colonnes d'état du parcours
-- -----------------------------------------------------------------------------
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS submitted_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason   TEXT,
  ADD COLUMN IF NOT EXISTS verified_ack_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_done_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS selfie_url         TEXT;

COMMENT ON COLUMN public.drivers.submitted_at IS
  'Date d''envoi du dossier KYC. NULL = dossier non transmis (ou refusé).';
COMMENT ON COLUMN public.drivers.verified_ack_at IS
  'Date à laquelle le livreur a vu l''écran « Compte vérifié ».';
COMMENT ON COLUMN public.drivers.onboarding_done_at IS
  'Date à laquelle le livreur a choisi son mode d''activité (fin du parcours).';

-- Types de pièces : on ajoute le selfie et l'assurance (véhicule motorisé).
ALTER TABLE public.driver_documents
  DROP CONSTRAINT IF EXISTS driver_documents_doc_type_check;
ALTER TABLE public.driver_documents
  ADD CONSTRAINT driver_documents_doc_type_check
  CHECK (doc_type = ANY (ARRAY[
    'cni', 'permis', 'carte_grise', 'passeport', 'assurance', 'selfie', 'autre'
  ]));

-- -----------------------------------------------------------------------------
-- 2. Garde d'auto-modification du profil livreur
-- -----------------------------------------------------------------------------
-- Réécriture (le trigger était SECURITY DEFINER, donc aveugle au rôle appelant) :
-- on brime UNIQUEMENT les écritures faites par un rôle de connexion interactif
-- (authenticated / anon). Les fonctions SECURITY DEFINER de la plateforme et le
-- service_role (server actions, admin) passent intacts — cf. pattern mig 0269.
CREATE OR REPLACE FUNCTION public.drivers_self_update_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  -- N'agit QUE sur une auto-modification par le livreur lui-même.
  IF auth.uid() IS DISTINCT FROM OLD.user_id THEN RETURN NEW; END IF;
  IF public.is_super_admin() THEN RETURN NEW; END IF;

  -- Colonnes protégées : jamais modifiables par le livreur.
  IF NEW.is_verified        IS DISTINCT FROM OLD.is_verified
  OR NEW.is_frozen          IS DISTINCT FROM OLD.is_frozen
  OR NEW.is_blocked         IS DISTINCT FROM OLD.is_blocked
  OR NEW.verified_at        IS DISTINCT FROM OLD.verified_at
  OR NEW.verified_by        IS DISTINCT FROM OLD.verified_by
  OR NEW.blocked_at         IS DISTINCT FROM OLD.blocked_at
  OR NEW.block_reason       IS DISTINCT FROM OLD.block_reason
  OR NEW.frozen_at          IS DISTINCT FROM OLD.frozen_at
  OR NEW.freeze_reason      IS DISTINCT FROM OLD.freeze_reason
  OR NEW.rating_avg         IS DISTINCT FROM OLD.rating_avg
  OR NEW.rating_count       IS DISTINCT FROM OLD.rating_count
  OR NEW.admin_note         IS DISTINCT FROM OLD.admin_note
  OR NEW.user_id            IS DISTINCT FROM OLD.user_id
  -- Étapes du parcours d'inscription : écrites par le serveur uniquement.
  OR NEW.submitted_at       IS DISTINCT FROM OLD.submitted_at
  OR NEW.rejected_at        IS DISTINCT FROM OLD.rejected_at
  OR NEW.rejection_reason   IS DISTINCT FROM OLD.rejection_reason
  OR NEW.verified_ack_at    IS DISTINCT FROM OLD.verified_ack_at
  OR NEW.onboarding_done_at IS DISTINCT FROM OLD.onboarding_done_at THEN
    RAISE EXCEPTION 'forbidden_protected_field';
  END IF;

  -- Compte vérifié → aucune modification directe (demande obligatoire).
  IF COALESCE(OLD.is_verified, false) THEN
    RAISE EXCEPTION 'profile_locked';
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Helper : le livreur appelant est-il OPÉRATIONNEL ?
-- -----------------------------------------------------------------------------
-- Vérifié par l'équipe Coligo ET non bloqué. Le GEL (is_frozen) reste une
-- sanction souple traitée séparément (le livreur garde l'accès en lecture).
CREATE OR REPLACE FUNCTION public.driver_is_active(p_driver_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(d.is_verified, false)
     AND COALESCE(d.is_blocked, false) = false
     AND d.submitted_at IS NOT NULL
  FROM public.drivers d
  WHERE d.id = p_driver_id;
$$;

-- Variante « livreur connecté » (aucun argument) — utilisable depuis l'app.
CREATE OR REPLACE FUNCTION public.current_driver_is_active()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(bool_or(
    COALESCE(d.is_verified, false)
    AND COALESCE(d.is_blocked, false) = false
    AND d.submitted_at IS NOT NULL
  ), false)
  FROM public.drivers d
  WHERE d.user_id = auth.uid();
$$;

-- EXECUTE requis pour CHAQUE rôle appelant, y compris `anon` : la fonction est
-- appelée depuis le trigger de `merchant_drivers` (cf. §5), qui s'exécute sous
-- le rôle de connexion réel.
GRANT EXECUTE ON FUNCTION public.driver_is_active(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.current_driver_is_active() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Verrous sur les RPC opérationnelles
-- -----------------------------------------------------------------------------

-- 4a. Mise en ligne (disponibilité par paire livreur↔commerçant).
CREATE OR REPLACE FUNCTION public.set_driver_availability(
  p_merchant_driver_id UUID,
  p_status driver_avail_status
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user              UUID;
  v_blocked_or_frozen BOOLEAN;
  v_verified          BOOLEAN;
  v_current_order     UUID;
BEGIN
  SELECT d.user_id,
         (COALESCE(d.is_frozen, false) OR COALESCE(d.is_blocked, false)),
         COALESCE(d.is_verified, false)
    INTO v_user, v_blocked_or_frozen, v_verified
  FROM public.merchant_drivers md
  JOIN public.drivers d ON d.id = md.driver_id
  WHERE md.id = p_merchant_driver_id AND md.status = 'active';

  IF v_user IS NULL OR v_user <> auth.uid() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Compte NON VÉRIFIÉ par l'équipe Coligo → mise en ligne impossible.
  IF NOT v_verified AND p_status <> 'offline' THEN
    RAISE EXCEPTION 'account_not_verified';
  END IF;

  -- Gelé/bloqué → seul le retour « offline » est permis.
  IF v_blocked_or_frozen AND p_status <> 'offline' THEN
    RAISE EXCEPTION 'account_frozen';
  END IF;

  SELECT current_order_id INTO v_current_order
  FROM public.driver_availability WHERE merchant_driver_id = p_merchant_driver_id;

  IF v_current_order IS NOT NULL AND p_status <> 'busy' THEN
    RAISE EXCEPTION 'has_pending_order';
  END IF;

  INSERT INTO public.driver_availability (merchant_driver_id, status)
    VALUES (p_merchant_driver_id, p_status)
    ON CONFLICT (merchant_driver_id)
    DO UPDATE SET status = p_status;
END;
$$;

-- 4b. Présence (heartbeat) : un livreur non vérifié n'apparaît jamais comme
--     présent → il n'est ni compté ni ciblé par le dispatch/les push.
CREATE OR REPLACE FUNCTION public.driver_heartbeat(p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver UUID;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN; END IF;
  IF p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN RETURN; END IF;

  SELECT id INTO v_driver
  FROM public.drivers
  WHERE user_id = auth.uid()
    AND COALESCE(is_verified, false) = true
    AND COALESCE(is_blocked, false) = false;
  IF v_driver IS NULL THEN RETURN; END IF;

  INSERT INTO public.driver_presence (driver_id, lat, lng, updated_at)
  VALUES (v_driver, p_lat, p_lng, now())
  ON CONFLICT (driver_id) DO UPDATE
    SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, updated_at = now();
END;
$$;

-- 4c. Attribution d'une course Express : réservée aux livreurs vérifiés.
CREATE OR REPLACE FUNCTION public.pull_next_express_nearby(
  p_lat NUMERIC, p_lng NUMERIC, p_radius_km NUMERIC DEFAULT 6
)
RETURNS TABLE(res_order_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id   UUID;
  v_zone_lat    NUMERIC;
  v_zone_lng    NUMERIC;
  v_zone_radius NUMERIC;
  v_cfg_radius  NUMERIC;
  v_ref_lat     NUMERIC;
  v_ref_lng     NUMERIC;
  v_radius      NUMERIC;
  v_can_cash    BOOLEAN;
  v_order       RECORD;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN; END IF;

  -- Kill-switch super-admin : service express coupé = aucune attribution.
  IF public.feature_blocked('express') THEN RETURN; END IF;

  -- Appelant = un livreur VÉRIFIÉ, ni gelé NI bloqué (+ sa zone de travail perso).
  SELECT id, work_zone_lat, work_zone_lng, work_zone_radius_km
    INTO v_driver_id, v_zone_lat, v_zone_lng, v_zone_radius
  FROM public.drivers
  WHERE user_id = auth.uid()
    AND COALESCE(is_verified, false) = true
    AND COALESCE(is_frozen, false) = false
    AND COALESCE(is_blocked, false) = false;
  IF v_driver_id IS NULL THEN RETURN; END IF;

  -- A3 : auto-guérison — les commandes gelées par un livreur disparu
  -- redeviennent attribuables au moment exact où quelqu'un cherche une course.
  PERFORM public.release_stale_express_claims();

  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.delivery_driver_id = v_driver_id
      AND o.status NOT IN ('completed', 'cancelled')
      AND o.delivery_delivered_at IS NULL
  ) THEN
    RETURN;
  END IF;

  -- A2 : plafond d'encours COD (mig 0103). Au plafond, le livreur ne reçoit
  -- plus d'ESPÈCES ; l'online reste ouvert.
  v_can_cash := public.driver_can_accept(v_driver_id);

  SELECT COALESCE(express_dispatch_radius_km, 6) INTO v_cfg_radius
  FROM public.platform_settings WHERE id = true;

  IF v_zone_lat IS NOT NULL AND v_zone_lng IS NOT NULL
     AND COALESCE(v_zone_radius, 0) > 0 THEN
    v_ref_lat := v_zone_lat; v_ref_lng := v_zone_lng;
    v_radius  := GREATEST(0.5, LEAST(v_zone_radius, 50));
  ELSE
    v_ref_lat := p_lat; v_ref_lng := p_lng;
    v_radius  := GREATEST(0.5, LEAST(COALESCE(v_cfg_radius, 6), 50));
  END IF;

  SELECT o.id AS id,
         public.km_between(p_lat, p_lng, m.latitude, m.longitude) AS dist_km
    INTO v_order
  FROM public.orders o
  JOIN public.merchants m ON m.id = o.merchant_id
  WHERE o.fulfillment_type = 'delivery'
    AND o.delivery_mode = 'express'
    AND o.delivery_driver_id IS NULL
    AND o.status IN ('preparing', 'ready')
    AND m.express_enabled = true
    AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
    AND (o.payment_method <> 'cash' OR v_can_cash)
    AND (
      o.prep_notif_at IS NULL
      OR o.marked_ready_at IS NOT NULL
      OR o.status = 'ready'
      OR o.prep_notif_at <= now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.express_declines ed
      WHERE ed.order_id = o.id
        AND ed.driver_id = v_driver_id
        AND ed.declined_at > now() - interval '10 minutes'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.merchant_drivers md
      WHERE md.merchant_id = o.merchant_id
        AND md.driver_id = v_driver_id
        AND md.status = 'blocked'
    )
    AND public.km_between(v_ref_lat, v_ref_lng, m.latitude, m.longitude) <= v_radius
  ORDER BY dist_km ASC, o.created_at ASC
  FOR UPDATE OF o SKIP LOCKED
  LIMIT 1;

  IF v_order.id IS NULL THEN RETURN; END IF;

  UPDATE public.orders
    SET delivery_driver_id = v_driver_id,
        driver_claimed_at  = now(),
        driver_notified_at = COALESCE(driver_notified_at, now())
    WHERE id = v_order.id;

  res_order_id := v_order.id;
  RETURN NEXT;
END;
$$;

-- 4d. Ciblage des push / dispatch : jamais un livreur non vérifié.
CREATE OR REPLACE FUNCTION public.drivers_present_near(
  p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION,
  p_radius_km NUMERIC DEFAULT 6, p_within_min INTEGER DEFAULT 3
)
RETURNS TABLE(user_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT d.user_id
  FROM public.driver_presence p
  JOIN public.drivers d ON d.id = p.driver_id
  WHERE p.updated_at > now() - make_interval(mins => GREATEST(1, p_within_min))
    AND d.user_id IS NOT NULL
    AND COALESCE(d.is_verified, false) = true
    AND COALESCE(d.is_frozen, false) = false
    AND COALESCE(d.is_blocked, false) = false
    AND p_lat IS NOT NULL AND p_lng IS NOT NULL
    AND (6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(p_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(p.lat))
        )))) <= GREATEST(0.5, LEAST(COALESCE(p_radius_km, 6), 20));
$$;

CREATE OR REPLACE FUNCTION public.express_teaser_targets(
  p_merchant_id UUID, p_radius_km NUMERIC DEFAULT 8,
  p_present_min INTEGER DEFAULT 3, p_throttle_min INTEGER DEFAULT 30
)
RETURNS TABLE(user_id UUID, available_count INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_lat   DOUBLE PRECISION;
  v_lng   DOUBLE PRECISION;
  v_count INTEGER;
  v_rad   NUMERIC := GREATEST(1, LEAST(COALESCE(p_radius_km, 8), 30));
BEGIN
  SELECT latitude, longitude INTO v_lat, v_lng
  FROM public.merchants WHERE id = p_merchant_id;
  IF v_lat IS NULL OR v_lng IS NULL THEN RETURN; END IF;

  SELECT count(*) INTO v_count
  FROM public.orders o
  JOIN public.merchants m ON m.id = o.merchant_id
  WHERE o.fulfillment_type = 'delivery'
    AND o.delivery_mode = 'express'
    AND o.delivery_driver_id IS NULL
    AND o.status IN ('preparing', 'ready')
    AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
    AND (6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(v_lat)) * cos(radians(m.latitude)) * cos(radians(m.longitude) - radians(v_lng))
          + sin(radians(v_lat)) * sin(radians(m.latitude))
        )))) <= v_rad;

  IF COALESCE(v_count, 0) = 0 THEN RETURN; END IF;

  RETURN QUERY
  WITH targets AS (
    SELECT d.user_id AS uid, p.driver_id AS did
    FROM public.driver_presence p
    JOIN public.drivers d ON d.id = p.driver_id
    WHERE d.user_id IS NOT NULL
      AND COALESCE(d.is_verified, false) = true
      AND COALESCE(d.is_frozen, false) = false
      AND COALESCE(d.is_blocked, false) = false
      AND p.updated_at <= now() - make_interval(mins => GREATEST(1, p_present_min))
      AND (p.last_teaser_at IS NULL
           OR p.last_teaser_at < now() - make_interval(mins => GREATEST(5, p_throttle_min)))
      AND (6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(v_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(v_lng))
            + sin(radians(v_lat)) * sin(radians(p.lat))
          )))) <= v_rad
  ), marked AS (
    UPDATE public.driver_presence dp
       SET last_teaser_at = now()
      FROM targets t
     WHERE dp.driver_id = t.did
    RETURNING t.uid AS uid
  )
  SELECT uid, v_count FROM marked;
END;
$$;

-- 4e. Démarrage de tournée : réservé aux livreurs vérifiés.
CREATE OR REPLACE FUNCTION public.start_tour(p_merchant_driver_id UUID, p_slot_id UUID)
RETURNS TABLE(ok BOOLEAN, reason TEXT, tour_id UUID, stops_count INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user        UUID := auth.uid();
  v_link        public.merchant_drivers%ROWTYPE;
  v_driver_user UUID;
  v_verified    BOOLEAN;
  v_slot        public.delivery_slots%ROWTYPE;
  v_lat         DOUBLE PRECISION;
  v_lng         DOUBLE PRECISION;
  v_existing_id UUID;
  v_tour_id     UUID;
  v_next        INTEGER := 1;
  v_count       INTEGER := 0;
  v_best        RECORD;
BEGIN
  SELECT * INTO v_link FROM public.merchant_drivers WHERE id = p_merchant_driver_id;
  IF v_link.id IS NULL OR v_link.status <> 'active' THEN
    ok := false; reason := 'link_not_active'; RETURN NEXT; RETURN;
  END IF;
  SELECT d.user_id, COALESCE(d.is_verified, false) AND COALESCE(d.is_blocked, false) = false
    INTO v_driver_user, v_verified
  FROM public.drivers d WHERE d.id = v_link.driver_id;
  IF v_user IS NULL OR v_driver_user IS DISTINCT FROM v_user THEN
    ok := false; reason := 'unauthorized'; RETURN NEXT; RETURN;
  END IF;
  IF NOT COALESCE(v_verified, false) THEN
    ok := false; reason := 'account_not_verified'; RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_slot FROM public.delivery_slots WHERE id = p_slot_id FOR UPDATE;
  IF v_slot.id IS NULL OR v_slot.merchant_id <> v_link.merchant_id THEN
    ok := false; reason := 'slot_not_found'; RETURN NEXT; RETURN;
  END IF;
  IF v_slot.status = 'cancelled' THEN
    ok := false; reason := 'slot_cancelled'; RETURN NEXT; RETURN;
  END IF;

  SELECT m.latitude, m.longitude INTO v_lat, v_lng
  FROM public.merchants m WHERE m.id = v_link.merchant_id;
  IF v_lat IS NULL OR v_lng IS NULL THEN
    ok := false; reason := 'merchant_position_missing'; RETURN NEXT; RETURN;
  END IF;

  SELECT t.id INTO v_existing_id
  FROM public.delivery_tours t
  WHERE t.slot_id = p_slot_id AND t.driver_id = v_link.driver_id
    AND t.status <> 'cancelled'
  LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    SELECT count(*)::INTEGER INTO v_count FROM public.tour_stops s WHERE s.tour_id = v_existing_id;
    ok := true; reason := 'already_started'; tour_id := v_existing_id; stops_count := v_count;
    RETURN NEXT; RETURN;
  END IF;

  INSERT INTO public.delivery_tours (merchant_id, driver_id, slot_id, status, started_at)
  VALUES (v_link.merchant_id, v_link.driver_id, p_slot_id, 'in_progress', now())
  RETURNING id INTO v_tour_id;

  LOOP
    SELECT o.id, o.delivery_lat AS lat, o.delivery_lng AS lng
      INTO v_best
    FROM public.orders o
    WHERE o.delivery_slot_id = p_slot_id
      AND o.fulfillment_type = 'delivery'
      AND o.delivery_mode = 'tour'
      AND o.status NOT IN ('completed', 'cancelled')
      AND (o.payment_method <> 'online' OR o.payment_status = 'paid')
      AND (o.delivery_driver_id IS NULL OR o.delivery_driver_id = v_link.driver_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.tour_stops s
        JOIN public.delivery_tours t ON t.id = s.tour_id
        WHERE s.order_id = o.id AND t.status IN ('planned', 'in_progress')
      )
    ORDER BY
      CASE WHEN o.delivery_lat IS NULL OR o.delivery_lng IS NULL THEN 1 ELSE 0 END,
      (o.delivery_lat - v_lat) * (o.delivery_lat - v_lat) +
      (o.delivery_lng - v_lng) * (o.delivery_lng - v_lng)
    LIMIT 1
    FOR UPDATE OF o SKIP LOCKED;

    EXIT WHEN v_best.id IS NULL;

    INSERT INTO public.tour_stops (tour_id, order_id, stop_order)
    VALUES (v_tour_id, v_best.id, v_next);

    UPDATE public.orders SET delivery_driver_id = v_link.driver_id WHERE id = v_best.id;

    IF v_best.lat IS NOT NULL AND v_best.lng IS NOT NULL THEN
      v_lat := v_best.lat; v_lng := v_best.lng;
    END IF;
    v_next  := v_next + 1;
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    DELETE FROM public.delivery_tours WHERE id = v_tour_id;
    ok := false; reason := 'no_orders'; RETURN NEXT; RETURN;
  END IF;

  ok := true; reason := NULL; tour_id := v_tour_id; stops_count := v_count;
  RETURN NEXT;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. « Rejoindre un commerçant » : impossible avant vérification
-- -----------------------------------------------------------------------------
-- Enforcement à l'INSERT du lien, TOUS RÔLES APPLICATIFS COMPRIS (le lien est
-- créé en service_role par la server action) → aucun contournement possible par
-- appel direct de l'API ou du endpoint REST.
-- Non SECURITY DEFINER (le trigger doit voir le VRAI rôle appelant) ; la lecture
-- du statut passe par driver_is_active(), elle définer — cf. pattern mig 0269.
CREATE OR REPLACE FUNCTION public.enforce_merchant_driver_verified()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  -- Accès DB direct (migrations, scripts d'exploitation) : non bridé.
  IF current_user NOT IN ('authenticated', 'anon', 'service_role') THEN
    RETURN NEW;
  END IF;

  -- driver_is_active() renvoie NULL si le livreur n'existe pas → on refuse.
  IF NOT COALESCE(public.driver_is_active(NEW.driver_id), false) THEN
    RAISE EXCEPTION 'driver_not_verified'
      USING ERRCODE = 'check_violation',
            HINT = 'Le compte livreur doit être vérifié par l''équipe Coligo.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS merchant_drivers_verified_guard_trg ON public.merchant_drivers;
CREATE TRIGGER merchant_drivers_verified_guard_trg
  BEFORE INSERT ON public.merchant_drivers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_merchant_driver_verified();

-- -----------------------------------------------------------------------------
-- 6. Notifications internes du livreur
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.driver_notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id  UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  route      TEXT,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS driver_notifications_driver_idx
  ON public.driver_notifications (driver_id, created_at DESC);

ALTER TABLE public.driver_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_notifications_owner_read ON public.driver_notifications;
CREATE POLICY driver_notifications_owner_read ON public.driver_notifications
  FOR SELECT USING (
    driver_id = public.driver_id_for_user(auth.uid()) OR public.is_super_admin()
  );

DROP POLICY IF EXISTS driver_notifications_admin_write ON public.driver_notifications;
CREATE POLICY driver_notifications_admin_write ON public.driver_notifications
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- Marquage « lu » : RPC dédiée (aucune policy UPDATE pour le livreur → il ne
-- peut pas réécrire le contenu d'une notification).
CREATE OR REPLACE FUNCTION public.driver_mark_notifications_read()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver UUID;
  v_count  INTEGER;
BEGIN
  SELECT id INTO v_driver FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver IS NULL THEN RETURN 0; END IF;
  UPDATE public.driver_notifications
     SET read_at = now()
   WHERE driver_id = v_driver AND read_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.driver_mark_notifications_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_mark_notifications_read() TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. Réglage plateforme : notifier automatiquement à l'activation
-- -----------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS notify_driver_on_verify BOOLEAN NOT NULL DEFAULT true;
COMMENT ON COLUMN public.platform_settings.notify_driver_on_verify IS
  'Notifier automatiquement le livreur (push + notification interne) lors de l''activation de son compte.';

-- -----------------------------------------------------------------------------
-- 8. Reprise de l'existant (aucun livreur déjà en activité ne doit régresser)
-- -----------------------------------------------------------------------------
-- Dossier réputé transmis pour tout livreur déjà vérifié ou ayant déjà déposé
-- au moins une pièce.
UPDATE public.drivers d
   SET submitted_at = COALESCE(d.submitted_at, d.created_at)
 WHERE d.submitted_at IS NULL
   AND (
     COALESCE(d.is_verified, false)
     OR EXISTS (SELECT 1 FROM public.driver_documents dd WHERE dd.driver_id = d.id)
   );

-- Les livreurs déjà vérifiés ne doivent pas revoir l'écran de félicitations ni
-- le choix du mode d'activité.
UPDATE public.drivers
   SET verified_ack_at    = COALESCE(verified_ack_at, verified_at, now()),
       onboarding_done_at = COALESCE(onboarding_done_at, verified_at, now())
 WHERE COALESCE(is_verified, false);
