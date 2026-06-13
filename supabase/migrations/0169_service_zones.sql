-- =============================================================================
-- 0169 — Moteur de ZONES géographiques, disponibilités & restrictions de service
-- =============================================================================
-- Objectif (style Uber/Yassir/DoorDash) : un super-admin autorise OU bloque
-- chaque service (express / tour / drive) par périmètre géographique, et toute
-- inscription/commande/course est vérifiée AUTOMATIQUEMENT côté backend (bypass-
-- proof) ET frontend (UX).
--
-- Périmètres supportés (scope) :
--   • country  — pays entier (DZ) : kill-switch géographique.
--   • wilaya   — par code wilaya (résolu via reverse-geocode côté appelant).
--   • commune  — wilaya + nom de commune.
--   • radius   — disque (centre lat/lng + rayon km), 100 % géométrique.
--   • polygon  — périmètre dessiné sur carte (anneau GeoJSON [[lng,lat],…]).
--
-- Résolution : GÉOMÉTRIQUE D'ABORD (radius/polygon/country tranchent à partir
-- du seul lat/lng → enforçables en base, donc INFALSIFIABLES). wilaya/commune
-- sont un complément (l'appelant passe le code wilaya/commune reverse-géocodé).
--
-- Direction (Drive) : une règle peut viser 'origin', 'destination' ou 'any' →
-- on peut autoriser A→B mais refuser B→A.
--
-- Priorité : la règle ACTIVE de plus forte `priority` qui matche tranche
-- (spécificité du scope en départage). Sinon on applique le défaut du service
-- (`service_zone_defaults.default_allow`). Défaut initial = TOUT AUTORISÉ →
-- aucun changement de comportement tant qu'aucune règle n'est créée.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_zone_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label         TEXT NOT NULL,
  service       TEXT NOT NULL CHECK (service IN ('express', 'tour', 'drive')),
  mode          TEXT NOT NULL CHECK (mode IN ('allow', 'block')),
  scope         TEXT NOT NULL CHECK (scope IN ('country', 'wilaya', 'commune', 'radius', 'polygon')),
  direction     TEXT NOT NULL DEFAULT 'any' CHECK (direction IN ('any', 'origin', 'destination')),
  priority      INTEGER NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT true,
  coming_soon   BOOLEAN NOT NULL DEFAULT false,
  -- Charges utiles selon le scope (toutes nullables) :
  country_code  TEXT,
  wilaya_code   TEXT,
  commune       TEXT,
  center_lat    DOUBLE PRECISION,
  center_lng    DOUBLE PRECISION,
  radius_km     NUMERIC,
  polygon       JSONB,
  note          TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_zone_rules_lookup
  ON public.service_zone_rules (service, active, priority DESC);

-- Défauts + interrupteurs par service.
CREATE TABLE IF NOT EXISTS public.service_zone_defaults (
  service         TEXT PRIMARY KEY CHECK (service IN ('express', 'tour', 'drive')),
  -- Si true : autorisé partout SAUF là où une règle 'block' matche.
  -- Si false : bloqué partout SAUF là où une règle 'allow' matche (allow-list).
  default_allow   BOOLEAN NOT NULL DEFAULT true,
  -- Interrupteur global du service (kill-switch).
  service_active  BOOLEAN NOT NULL DEFAULT true,
  -- Distance max (km) du trajet/de la livraison (NULL = pas de limite).
  max_distance_km NUMERIC,
  updated_by      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Comportement actuel préservé : tout autorisé tant qu'aucune règle.
INSERT INTO public.service_zone_defaults (service, default_allow, service_active)
VALUES ('express', true, true), ('tour', true, true), ('drive', true, true)
ON CONFLICT (service) DO NOTHING;

-- Liste d'attente « Prévenez-moi quand ma zone est couverte ».
CREATE TABLE IF NOT EXISTS public.zone_waitlist (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service      TEXT NOT NULL CHECK (service IN ('express', 'tour', 'drive')),
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  wilaya_code  TEXT,
  commune      TEXT,
  contact      TEXT,
  user_id      UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_zone_waitlist_service ON public.zone_waitlist (service, created_at DESC);

-- RLS : tables pilotées UNIQUEMENT par les RPC SECURITY DEFINER + service_role
-- (admin). Aucune policy → aucun rôle de connexion (anon/authenticated) ne lit
-- ni n'écrit en direct.
ALTER TABLE public.service_zone_rules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_zone_defaults  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zone_waitlist          ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2. Colonnes wilaya/commune sur orders (remplies par l'action checkout via
--    reverse-geocode) → permet au trigger d'enforcer aussi les règles
--    wilaya/commune, et sert l'analytique.
-- ----------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_wilaya_code TEXT,
  ADD COLUMN IF NOT EXISTS delivery_commune     TEXT;

-- ----------------------------------------------------------------------------
-- 3. Helper : point dans polygone (ray casting). Anneau = JSONB [[lng,lat],…].
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._coligo_point_in_polygon(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_ring JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  n INT; i INT; j INT;
  xi DOUBLE PRECISION; yi DOUBLE PRECISION;
  xj DOUBLE PRECISION; yj DOUBLE PRECISION;
  inside BOOLEAN := false;
BEGIN
  IF p_ring IS NULL OR jsonb_typeof(p_ring) <> 'array' THEN RETURN false; END IF;
  n := jsonb_array_length(p_ring);
  IF n < 3 THEN RETURN false; END IF;
  j := n - 1;
  FOR i IN 0..n - 1 LOOP
    xi := (p_ring -> i ->> 0)::DOUBLE PRECISION;  -- lng
    yi := (p_ring -> i ->> 1)::DOUBLE PRECISION;  -- lat
    xj := (p_ring -> j ->> 0)::DOUBLE PRECISION;
    yj := (p_ring -> j ->> 1)::DOUBLE PRECISION;
    IF ((yi > p_lat) <> (yj > p_lat))
       AND (p_lng < (xj - xi) * (p_lat - yi) / NULLIF(yj - yi, 0) + xi) THEN
      inside := NOT inside;
    END IF;
    j := i;
  END LOOP;
  RETURN inside;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Moteur de résolution : un point est-il couvert pour ce service ?
--    Renvoie (allowed, reason, label, coming_soon).
--    reason ∈ ok | service_inactive | blocked | no_coverage
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.evaluate_service_zone(
  p_service     TEXT,
  p_lat         DOUBLE PRECISION,
  p_lng         DOUBLE PRECISION,
  p_wilaya_code TEXT DEFAULT NULL,
  p_commune     TEXT DEFAULT NULL,
  p_role        TEXT DEFAULT 'any'  -- 'origin' | 'destination' | 'any'
) RETURNS TABLE(allowed BOOLEAN, reason TEXT, label TEXT, coming_soon BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_default_allow  BOOLEAN := true;
  v_service_active BOOLEAN := true;
  r        RECORD;
  v_dist   NUMERIC;
  v_match  BOOLEAN;
BEGIN
  IF p_service NOT IN ('express', 'tour', 'drive') THEN
    RETURN QUERY SELECT true, 'ok'::TEXT, NULL::TEXT, false; RETURN;
  END IF;

  SELECT d.default_allow, d.service_active
    INTO v_default_allow, v_service_active
  FROM public.service_zone_defaults d WHERE d.service = p_service;
  IF NOT FOUND THEN
    v_default_allow := true; v_service_active := true;
  END IF;

  IF NOT v_service_active THEN
    RETURN QUERY SELECT false, 'service_inactive'::TEXT, NULL::TEXT, false; RETURN;
  END IF;

  IF p_lat IS NULL OR p_lng IS NULL THEN
    RETURN QUERY SELECT v_default_allow,
      (CASE WHEN v_default_allow THEN 'ok' ELSE 'no_coverage' END)::TEXT,
      NULL::TEXT, false; RETURN;
  END IF;

  FOR r IN
    SELECT * FROM public.service_zone_rules
    WHERE active = true AND service = p_service
      AND (direction = 'any' OR direction = p_role)
    ORDER BY priority DESC,
      (CASE scope WHEN 'polygon' THEN 4 WHEN 'radius' THEN 3
                  WHEN 'commune' THEN 2 WHEN 'wilaya' THEN 1 ELSE 0 END) DESC,
      created_at DESC
  LOOP
    v_match := false;

    IF r.scope = 'country' THEN
      v_match := (r.country_code IS NULL OR r.country_code = 'DZ');
    ELSIF r.scope = 'wilaya' THEN
      v_match := (p_wilaya_code IS NOT NULL AND p_wilaya_code = r.wilaya_code);
    ELSIF r.scope = 'commune' THEN
      v_match := (p_wilaya_code IS NOT NULL AND p_wilaya_code = r.wilaya_code
                  AND p_commune IS NOT NULL
                  AND lower(btrim(p_commune)) = lower(btrim(COALESCE(r.commune, ''))));
    ELSIF r.scope = 'radius' THEN
      IF r.center_lat IS NOT NULL AND r.center_lng IS NOT NULL AND r.radius_km IS NOT NULL THEN
        v_dist := 6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(p_lat)) * cos(radians(r.center_lat)) *
            cos(radians(r.center_lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(r.center_lat)))));
        v_match := v_dist <= r.radius_km;
      END IF;
    ELSIF r.scope = 'polygon' THEN
      v_match := public._coligo_point_in_polygon(p_lat, p_lng, r.polygon);
    END IF;

    IF v_match THEN
      IF r.mode = 'block' THEN
        RETURN QUERY SELECT false, 'blocked'::TEXT, r.label, r.coming_soon; RETURN;
      ELSE
        RETURN QUERY SELECT true, 'ok'::TEXT, r.label, false; RETURN;
      END IF;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_default_allow,
    (CASE WHEN v_default_allow THEN 'ok' ELSE 'no_coverage' END)::TEXT,
    NULL::TEXT, false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.evaluate_service_zone(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT)
  TO anon, authenticated, service_role;

-- Distance max d'un service (NULL = aucune limite). Léger, pour l'enforcement.
CREATE OR REPLACE FUNCTION public.service_max_distance_km(p_service TEXT)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT max_distance_km FROM public.service_zone_defaults WHERE service = p_service;
$$;
GRANT EXECUTE ON FUNCTION public.service_max_distance_km(TEXT) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Enforcement LIVRAISON (bypass-proof) : trigger BEFORE INSERT sur orders.
--    Ne bride QUE les écritures directes (rôle de connexion utilisateur), comme
--    0166 — les DEFINER (postgres) et service_role (admin) passent intacts.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_order_service_zone()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v RECORD;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF NEW.fulfillment_type IS DISTINCT FROM 'delivery' THEN RETURN NEW; END IF;
  IF NEW.delivery_mode NOT IN ('express', 'tour') THEN RETURN NEW; END IF;
  IF NEW.delivery_lat IS NULL OR NEW.delivery_lng IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v FROM public.evaluate_service_zone(
    NEW.delivery_mode, NEW.delivery_lat, NEW.delivery_lng,
    NEW.delivery_wilaya_code, NEW.delivery_commune, 'destination');

  IF NOT v.allowed THEN
    RAISE EXCEPTION 'service_zone_blocked:%', COALESCE(v.reason, 'blocked')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_order_service_zone_trg ON public.orders;
CREATE TRIGGER enforce_order_service_zone_trg
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_order_service_zone();

-- ----------------------------------------------------------------------------
-- 6. Enforcement DRIVE : on réécrit request_ride en ajoutant la vérification
--    ZONE départ (origin) + arrivée (destination) + distance max. Le reste du
--    corps est repris À L'IDENTIQUE de 0140 (ne rien casser).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_ride(
  p_pickup_lat   DOUBLE PRECISION,
  p_pickup_lng   DOUBLE PRECISION,
  p_pickup_text  TEXT,
  p_dest_lat     DOUBLE PRECISION,
  p_dest_lng     DOUBLE PRECISION,
  p_dest_text    TEXT,
  p_distance_km  NUMERIC,
  p_proposed_price INTEGER,
  p_payment_method TEXT DEFAULT 'cash',
  p_gamme        TEXT DEFAULT 'classic',
  p_boost_da     INTEGER DEFAULT 0,
  p_female_only  BOOLEAN DEFAULT false,
  p_proxy_name   TEXT DEFAULT NULL,
  p_proxy_phone  TEXT DEFAULT NULL,
  p_operation_id TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE;
  v_customer UUID; v_female_ok BOOLEAN; v_suggest INTEGER; v_floor INTEGER;
  v_boost INTEGER; v_ride UUID; v_existing UUID;
  v_org RECORD; v_dst RECORD; v_max_km NUMERIC;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT cu.id, cu.is_female_verified INTO v_customer, v_female_ok
    FROM public.customers cu WHERE cu.user_id = auth.uid();
  IF v_customer IS NULL THEN RAISE EXCEPTION 'Profil client introuvable.' USING ERRCODE='check_violation'; END IF;
  IF p_payment_method NOT IN ('cash','card','coligo_pay') THEN p_payment_method := 'cash'; END IF;
  IF p_gamme NOT IN ('classic','confort','moto') THEN p_gamme := 'classic'; END IF;

  -- Idempotence : même opération → renvoyer la course existante.
  IF p_operation_id IS NOT NULL THEN
    SELECT r.id INTO v_existing FROM public.rides r
     WHERE r.customer_id = v_customer AND r.client_operation_id = p_operation_id;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  END IF;

  -- Anti-spam : une seule course active à la fois par client.
  IF EXISTS (SELECT 1 FROM public.rides WHERE customer_id = v_customer
             AND status IN ('searching','accepted','arriving','arrived','in_progress')) THEN
    RAISE EXCEPTION 'Vous avez déjà une course en cours.' USING ERRCODE='check_violation';
  END IF;

  -- « Femme au volant » : flag plateforme + cliente au profil vérifié.
  IF p_female_only AND NOT (s.drive_female_filter_enabled AND COALESCE(v_female_ok, false)) THEN
    p_female_only := false;
  END IF;

  -- === MOTEUR DE ZONES (mig 0169) : couverture départ + arrivée + distance ===
  SELECT * INTO v_org FROM public.evaluate_service_zone('drive', p_pickup_lat, p_pickup_lng, NULL, NULL, 'origin');
  IF NOT v_org.allowed THEN
    RAISE EXCEPTION 'drive_zone_origin:%', COALESCE(v_org.reason, 'blocked') USING ERRCODE='check_violation';
  END IF;
  SELECT * INTO v_dst FROM public.evaluate_service_zone('drive', p_dest_lat, p_dest_lng, NULL, NULL, 'destination');
  IF NOT v_dst.allowed THEN
    RAISE EXCEPTION 'drive_zone_dest:%', COALESCE(v_dst.reason, 'blocked') USING ERRCODE='check_violation';
  END IF;
  v_max_km := public.service_max_distance_km('drive');
  IF v_max_km IS NOT NULL AND COALESCE(p_distance_km, 0) > v_max_km THEN
    RAISE EXCEPTION 'drive_zone_maxdist:%', v_max_km USING ERRCODE='check_violation';
  END IF;
  -- ===========================================================================

  v_suggest := public.drive_recommended_price(p_distance_km, p_gamme);
  v_floor   := public.drive_price_floor(p_distance_km, p_gamme);
  -- Boost : min config, pas de 5, jamais négatif.
  v_boost := GREATEST(0, COALESCE(p_boost_da, 0));
  IF v_boost > 0 THEN
    v_boost := GREATEST(s.drive_boost_min_da, round(v_boost::NUMERIC / s.drive_boost_step_da) * s.drive_boost_step_da)::INTEGER;
  END IF;

  INSERT INTO public.rides (customer_id, status, pickup_lat, pickup_lng, pickup_text,
    dest_lat, dest_lng, dest_text, distance_km, suggested_price_da, proposed_price_da,
    payment_method, gamme, boost_amount_da, female_only, proxy_name, proxy_phone,
    client_operation_id, expires_at)
  VALUES (v_customer, 'searching', p_pickup_lat, p_pickup_lng, p_pickup_text,
    p_dest_lat, p_dest_lng, p_dest_text, GREATEST(0, p_distance_km), v_suggest,
    -- Clamp PLANCHER silencieux (jamais affiché comme option côté client).
    GREATEST(v_floor, COALESCE(NULLIF(p_proposed_price, 0), v_suggest)),
    p_payment_method, p_gamme, v_boost, p_female_only,
    NULLIF(btrim(COALESCE(p_proxy_name,'')),''), NULLIF(btrim(COALESCE(p_proxy_phone,'')),''),
    p_operation_id, now() + make_interval(mins => s.drive_request_ttl_min))
  RETURNING id INTO v_ride;

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (v_ride, NULL, 'searching',
    'Course demandée · ' || p_gamme
    || CASE WHEN v_boost > 0 THEN ' · boost +' || v_boost || ' DA' ELSE '' END
    || CASE WHEN p_female_only THEN ' · femme au volant' ELSE '' END);
  RETURN v_ride;
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_ride(DOUBLE PRECISION,DOUBLE PRECISION,TEXT,DOUBLE PRECISION,DOUBLE PRECISION,TEXT,NUMERIC,INTEGER,TEXT,TEXT,INTEGER,BOOLEAN,TEXT,TEXT,TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. Liste d'attente « Prévenez-moi » (public, best-effort).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_zone_waitlist(
  p_service TEXT,
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL,
  p_wilaya_code TEXT DEFAULT NULL,
  p_commune TEXT DEFAULT NULL,
  p_contact TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_service NOT IN ('express', 'tour', 'drive') THEN RETURN; END IF;
  INSERT INTO public.zone_waitlist (service, lat, lng, wilaya_code, commune, contact, user_id)
  VALUES (p_service, p_lat, p_lng, p_wilaya_code, p_commune,
          NULLIF(btrim(COALESCE(p_contact, '')), ''), auth.uid());
END;
$$;
GRANT EXECUTE ON FUNCTION public.join_zone_waitlist(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT)
  TO anon, authenticated, service_role;

-- =============================================================================
-- VÉRIF :
--   SELECT * FROM public.service_zone_defaults;
--   SELECT * FROM public.evaluate_service_zone('express', 36.75, 5.07);
-- =============================================================================
