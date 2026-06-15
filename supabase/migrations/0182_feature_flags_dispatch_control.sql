-- =============================================================================
-- 0182 — Kill-switches super-admin (feature_flags) + rayons de dispatch
--        configurables (A) + zone de travail livreur/chauffeur (B)
-- =============================================================================
-- Le super-admin pilote la DISPONIBILITÉ de 4 fonctionnalités (drive,
-- paiement en ligne, Coligo Pay, cashback) avec 4 états :
--   active       → normal
--   hidden       → retiré du front + API bloquée
--   coming_soon  → affiché grisé « bientôt disponible » + API bloquée
--   maintenance  → affiché + message perso (FR/AR) + API bloquée
-- L'enforcement API est BYPASS-PROOF : triggers BEFORE INSERT sur les tables
-- concernées (jamais contournable via PostgREST direct), pas seulement le front.
--
-- (A) Rayons de dispatch configurables : express/drive lisent platform_settings.
-- (B) Zone de travail perso (centre+rayon) PERSISTÉE et ENFORCÉE côté serveur :
--     un livreur/chauffeur ne reçoit QUE les commandes/courses de sa zone ;
--     repli sur le rayon configurable autour de la position live si pas de zone.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Table des drapeaux + helpers
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feature_flags (
  key        TEXT PRIMARY KEY,
  status     TEXT NOT NULL DEFAULT 'active'
             CHECK (status IN ('active', 'hidden', 'coming_soon', 'maintenance')),
  title_fr   TEXT,
  title_ar   TEXT,
  message_fr TEXT,
  message_ar TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

INSERT INTO public.feature_flags (key)
VALUES ('drive'), ('online_payment'), ('coligo_pay'), ('cashback')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feature_flags_select_all ON public.feature_flags;
-- Lecture par TOUT LE MONDE (anon inclus) : le front en a besoin pour masquer /
-- griser / afficher le message, dès la page d'accueil non connectée.
CREATE POLICY feature_flags_select_all ON public.feature_flags
  FOR SELECT USING (true);

DROP POLICY IF EXISTS feature_flags_write_admin ON public.feature_flags;
CREATE POLICY feature_flags_write_admin ON public.feature_flags
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- Statut courant d'une fonctionnalité (défaut 'active' si non listée).
CREATE OR REPLACE FUNCTION public.feature_status(p_key TEXT)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT status FROM public.feature_flags WHERE key = p_key), 'active');
$$;

-- TRUE si la fonctionnalité n'est PAS active (donc API à bloquer).
CREATE OR REPLACE FUNCTION public.feature_blocked(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.feature_status(p_key) <> 'active';
$$;

GRANT EXECUTE ON FUNCTION public.feature_status(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.feature_blocked(TEXT) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) Enforcement BYPASS-PROOF (triggers BEFORE INSERT)
-- -----------------------------------------------------------------------------
-- DRIVE : aucune nouvelle course tant que le service n'est pas actif.
CREATE OR REPLACE FUNCTION public.enforce_feature_drive_rides()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF public.feature_blocked('drive') THEN
    RAISE EXCEPTION 'feature_disabled:drive' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_feature_drive_rides ON public.rides;
CREATE TRIGGER trg_feature_drive_rides BEFORE INSERT ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.enforce_feature_drive_rides();

-- COLIGO PAY : ni paiement marchand QR, ni transfert P2P.
CREATE OR REPLACE FUNCTION public.enforce_feature_coligo_pay()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF public.feature_blocked('coligo_pay') THEN
    RAISE EXCEPTION 'feature_disabled:coligo_pay' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_feature_cpay_pay ON public.coligo_pay_payments;
CREATE TRIGGER trg_feature_cpay_pay BEFORE INSERT ON public.coligo_pay_payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_feature_coligo_pay();
DROP TRIGGER IF EXISTS trg_feature_cpay_xfer ON public.coligo_pay_transfers;
CREATE TRIGGER trg_feature_cpay_xfer BEFORE INSERT ON public.coligo_pay_transfers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_feature_coligo_pay();

-- PAIEMENT EN LIGNE : aucune commande en paiement en ligne.
CREATE OR REPLACE FUNCTION public.enforce_feature_online_payment()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.payment_method = 'online' AND public.feature_blocked('online_payment') THEN
    RAISE EXCEPTION 'feature_disabled:online_payment' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_feature_online_payment ON public.orders;
CREATE TRIGGER trg_feature_online_payment BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_feature_online_payment();

-- CASHBACK : on NE bloque PAS la complétion de commande (sinon on casse le
-- flux) — on SAUTE simplement le gain quand la fonctionnalité est désactivée.
-- (Re-définition de la fonction de 0118 + une garde au début.)
CREATE OR REPLACE FUNCTION public.grant_customer_cashback_on_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_products     INTEGER;
  v_cash_rate    NUMERIC(5, 4);
  v_comm_rate    NUMERIC(5, 4);
  v_amount       INTEGER;
  v_commission   INTEGER;
  v_service_fee  INTEGER;
  v_delivery_fee INTEGER;
BEGIN
  IF NOT (NEW.status = 'completed'
          AND OLD.status IS DISTINCT FROM 'completed'
          AND NEW.customer_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  -- Cashback désactivé par le super-admin → aucun gain (sans bloquer la commande).
  IF public.feature_blocked('cashback') THEN
    RETURN NEW;
  END IF;

  -- Assiette = panier NET (après promo), figé. Exclut frais service/livraison.
  v_products := GREATEST(0, COALESCE(NEW.net_total_da, NEW.subtotal_da - NEW.discount_da));

  IF NEW.payment_method = 'cash' THEN
    v_cash_rate := public.resolve_rate(NEW.merchant_id, 'cashback_cash');
    v_comm_rate := public.resolve_rate(NEW.merchant_id, 'commission_cash');
  ELSE
    v_cash_rate := public.resolve_rate(NEW.merchant_id, 'cashback_online');
    v_comm_rate := public.resolve_rate(NEW.merchant_id, 'commission_online');
  END IF;

  v_amount := round(v_products * v_cash_rate)::INTEGER;

  -- En COD, le cashback est ABSORBÉ par la plateforme via la réduction de
  -- driver_owes_platform (0116), avec ce plafond exact. On l'applique au crédit
  -- client pour que crédit == montant absorbé (réconciliation parfaite).
  IF NEW.payment_method = 'cash' THEN
    v_commission   := round(v_products * v_comm_rate)::INTEGER;
    v_service_fee  := COALESCE(NEW.service_fee_da, 0);
    v_delivery_fee := COALESCE(NEW.delivery_fee_da, 0);
    v_amount := LEAST(
      v_amount,
      (v_products / 2),
      GREATEST(v_commission + v_service_fee + v_delivery_fee, 0)
    );
  END IF;

  IF v_amount > 0 THEN
    INSERT INTO public.customer_wallet_entries
      (customer_id, order_id, type, source, amount_da)
    VALUES
      (NEW.customer_id, NEW.id, 'cashback_earned', 'cashback', v_amount)
    ON CONFLICT (order_id, type) DO NOTHING;

    -- Snapshot RÉEL versé (source de vérité pour la compta/affichage).
    UPDATE public.orders SET cashback_da = v_amount WHERE id = NEW.id;

    UPDATE public.cashback_grants
       SET status      = 'granted',
           customer_id = COALESCE(customer_id, NEW.customer_id)
     WHERE order_id = NEW.id
       AND status   = 'pending';
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3) (A) Rayons de dispatch configurables
-- -----------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS express_dispatch_radius_km NUMERIC(5, 1) NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS drive_dispatch_radius_km   NUMERIC(5, 1) NOT NULL DEFAULT 8;

ALTER TABLE public.platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_dispatch_radius_pos;
ALTER TABLE public.platform_settings
  ADD CONSTRAINT platform_settings_dispatch_radius_pos
    CHECK (express_dispatch_radius_km > 0 AND drive_dispatch_radius_km > 0);

-- -----------------------------------------------------------------------------
-- 4) (B) Zone de travail perso (livreur + chauffeur)
-- -----------------------------------------------------------------------------
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS work_zone_lat       NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS work_zone_lng       NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS work_zone_radius_km NUMERIC(5, 1);

ALTER TABLE public.chauffeurs
  ADD COLUMN IF NOT EXISTS work_zone_lat       NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS work_zone_lng       NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS work_zone_radius_km NUMERIC(5, 1);

-- Distance Haversine (km) — petit helper réutilisable pour le dispatch.
CREATE OR REPLACE FUNCTION public.km_between(
  a_lat DOUBLE PRECISION, a_lng DOUBLE PRECISION,
  b_lat DOUBLE PRECISION, b_lng DOUBLE PRECISION
) RETURNS DOUBLE PRECISION
LANGUAGE sql IMMUTABLE AS $$
  SELECT 6371 * acos(LEAST(1, GREATEST(-1,
    cos(radians(a_lat)) * cos(radians(b_lat)) * cos(radians(b_lng) - radians(a_lng))
    + sin(radians(a_lat)) * sin(radians(b_lat)))));
$$;

-- -----------------------------------------------------------------------------
-- 5) Dispatch EXPRESS — rayon configurable + zone perso enforcée serveur
--    (re-définition de 0108 ; filtre par zone si définie, sinon position live ;
--     tri par distance à la position LIVE du livreur dans tous les cas.)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pull_next_express_nearby(
  p_lat numeric, p_lng numeric, p_radius_km numeric DEFAULT 6)
RETURNS TABLE(res_order_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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
  v_order       RECORD;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN; END IF;

  -- Appelant = un livreur ni gelé NI bloqué (+ sa zone de travail perso).
  SELECT id, work_zone_lat, work_zone_lng, work_zone_radius_km
    INTO v_driver_id, v_zone_lat, v_zone_lng, v_zone_radius
  FROM public.drivers
  WHERE user_id = auth.uid()
    AND COALESCE(is_frozen, false) = false
    AND COALESCE(is_blocked, false) = false;
  IF v_driver_id IS NULL THEN RETURN; END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.delivery_driver_id = v_driver_id
      AND o.status NOT IN ('completed', 'cancelled')
      AND o.delivery_delivered_at IS NULL
  ) THEN
    RETURN;
  END IF;

  -- Rayon par défaut = réglage plateforme (A).
  SELECT COALESCE(express_dispatch_radius_km, 6) INTO v_cfg_radius
  FROM public.platform_settings WHERE id = true;

  -- (B) Zone perso prioritaire ; sinon position live + rayon configurable.
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
    -- Filtre géo : zone perso si définie, sinon position live.
    AND public.km_between(v_ref_lat, v_ref_lng, m.latitude, m.longitude) <= v_radius
  ORDER BY dist_km ASC, o.created_at ASC
  FOR UPDATE OF o SKIP LOCKED
  LIMIT 1;

  IF v_order.id IS NULL THEN RETURN; END IF;

  UPDATE public.orders
    SET delivery_driver_id = v_driver_id,
        driver_notified_at = COALESCE(driver_notified_at, now())
    WHERE id = v_order.id;

  res_order_id := v_order.id;
  RETURN NEXT;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6) Dispatch DRIVE — garde feature + rayon configurable + zone perso enforcée
--    (re-définition de 0150 ; filtre pickup par zone si définie.)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chauffeur_nearby_rides(
  p_lat       DOUBLE PRECISION,
  p_lng       DOUBLE PRECISION,
  p_radius_km NUMERIC DEFAULT 8
)
RETURNS TABLE(
  id                 UUID,
  pickup_text        TEXT,
  dest_text          TEXT,
  pickup_lat         DOUBLE PRECISION,
  pickup_lng         DOUBLE PRECISION,
  dest_lat           DOUBLE PRECISION,
  dest_lng           DOUBLE PRECISION,
  distance_km        NUMERIC,
  proposed_price_da  INTEGER,
  suggested_price_da INTEGER,
  boost_amount_da    INTEGER,
  gamme              TEXT,
  female_only        BOOLEAN,
  payment_method     TEXT,
  pickup_dist_km     NUMERIC,
  created_at         TIMESTAMPTZ,
  my_offer_da        INTEGER,
  customer_name      TEXT,
  customer_rating    NUMERIC,
  customer_since     TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ch public.chauffeurs%ROWTYPE;
  v_female_online BOOLEAN;
  v_cfg_radius NUMERIC;
  v_ref_lat NUMERIC;
  v_ref_lng NUMERIC;
  v_radius  NUMERIC;
BEGIN
  -- Drive en pause/maintenance → le chauffeur ne voit aucune course.
  IF public.feature_blocked('drive') THEN RETURN; END IF;

  SELECT c.* INTO v_ch FROM public.chauffeurs c
  WHERE c.user_id = auth.uid()
    AND c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked;
  IF v_ch.id IS NULL OR p_lat IS NULL OR p_lng IS NULL THEN RETURN; END IF;
  v_female_online := public.drive_female_online();

  SELECT COALESCE(drive_dispatch_radius_km, 8) INTO v_cfg_radius
  FROM public.platform_settings WHERE id = true;

  -- (B) Zone perso prioritaire ; sinon position live + rayon configurable.
  IF v_ch.work_zone_lat IS NOT NULL AND v_ch.work_zone_lng IS NOT NULL
     AND COALESCE(v_ch.work_zone_radius_km, 0) > 0 THEN
    v_ref_lat := v_ch.work_zone_lat; v_ref_lng := v_ch.work_zone_lng;
    v_radius  := GREATEST(0.5, LEAST(v_ch.work_zone_radius_km, 60));
  ELSE
    v_ref_lat := p_lat; v_ref_lng := p_lng;
    v_radius  := GREATEST(0.5, LEAST(COALESCE(v_cfg_radius, 8), 60));
  END IF;

  RETURN QUERY
  SELECT r.id, r.pickup_text, r.dest_text,
         r.pickup_lat, r.pickup_lng, r.dest_lat, r.dest_lng,
         r.distance_km, r.proposed_price_da, r.suggested_price_da,
         r.boost_amount_da, r.gamme, r.female_only, r.payment_method,
         public.km_between(p_lat, p_lng, r.pickup_lat, r.pickup_lng)::NUMERIC AS pickup_dist_km,
         r.created_at,
         (SELECT o.price_da FROM public.ride_offers o
           WHERE o.ride_id = r.id AND o.chauffeur_id = v_ch.id AND o.status = 'offered') AS my_offer_da,
         COALESCE(NULLIF(split_part(cu.full_name, ' ', 1), ''), 'Client') AS customer_name,
         (SELECT round(avg(r2.client_rating)::NUMERIC, 1) FROM public.rides r2
           WHERE r2.customer_id = r.customer_id AND r2.client_rating IS NOT NULL) AS customer_rating,
         cu.created_at AS customer_since
  FROM public.rides r
  JOIN public.customers cu ON cu.id = r.customer_id
  WHERE r.status = 'searching'
    AND (r.expires_at IS NULL OR r.expires_at > now())
    AND (r.payment_method <> 'card' OR r.online_paid_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM public.ride_offers od
                    WHERE od.ride_id = r.id AND od.chauffeur_id = v_ch.id AND od.status = 'declined')
    AND (CASE v_ch.gamme
          WHEN 'confort' THEN r.gamme IN ('classic','confort')
          WHEN 'classic' THEN r.gamme = 'classic'
          ELSE r.gamme = 'moto' END)
    AND (NOT r.female_only OR v_ch.is_female_verified OR NOT v_female_online)
    -- Filtre géo : zone perso si définie, sinon position live.
    AND public.km_between(v_ref_lat, v_ref_lng, r.pickup_lat, r.pickup_lng) <= v_radius
  ORDER BY (r.boost_amount_da > 0) DESC, r.created_at DESC
  LIMIT 30;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7) Setters de zone de travail (persistance serveur, scopés à auth.uid()).
--    p_lat/p_lng NULL → retire la zone (repli sur le rayon configurable).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_driver_work_zone(
  p_lat numeric, p_lng numeric, p_radius_km numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.drivers
    SET work_zone_lat = p_lat,
        work_zone_lng = p_lng,
        work_zone_radius_km = CASE
          WHEN p_lat IS NULL OR p_lng IS NULL THEN NULL
          ELSE GREATEST(0.5, LEAST(COALESCE(p_radius_km, 5), 50)) END
  WHERE user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.set_chauffeur_work_zone(
  p_lat numeric, p_lng numeric, p_radius_km numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.chauffeurs
    SET work_zone_lat = p_lat,
        work_zone_lng = p_lng,
        work_zone_radius_km = CASE
          WHEN p_lat IS NULL OR p_lng IS NULL THEN NULL
          ELSE GREATEST(0.5, LEAST(COALESCE(p_radius_km, 8), 60)) END
  WHERE user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_driver_work_zone(numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_chauffeur_work_zone(numeric, numeric, numeric) TO authenticated;
