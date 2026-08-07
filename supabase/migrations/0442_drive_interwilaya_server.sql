-- =============================================================================
-- 0442 — Coligo Drive : l'INTER-WILAYAS devient une réalité SERVEUR.
-- =============================================================================
-- Jusqu'ici (commit fd2b53f3) la détection « Inter-wilayas » était 100 %
-- frontend (lib/drive/interwilaya.ts) : badge/onglet d'affichage, zéro colonne
-- DB → invisible pour l'admin, infiltrable côté API, pas de kill-switch.
-- Cette migration :
--   1. `wilaya_centroids` (58 chefs-lieux, miroir lib/config/wilaya-centroids)
--      + `drive_nearest_wilaya(lat,lng)` (plus proche voisin équirectangulaire,
--      MÊME règle que le front).
--   2. `rides.pickup_wilaya / dest_wilaya / is_interwilaya` calculées par
--      TRIGGER BEFORE INSERT (jamais une valeur cliente — bypass-proof) ; le
--      même trigger ENFORCE le flag `drive_interwilaya` (aucune exemption de
--      rôle : service_role compris). Backfill de l'existant.
--   3. Feature flag `drive_interwilaya` (kill-switch super-admin dédié,
--      actif par défaut) + `platform_settings.drive_interwilaya_radius_km`
--      (rayon d'approche de la sous-page chauffeur, défaut 60 km).
--   4. RPC `chauffeur_interwilaya_rides` : les demandes inter-wilayas dans un
--      rayon ÉLARGI (un chauffeur accepte de rouler plus loin pour un long
--      trajet payant) — mêmes gardes d'éligibilité que chauffeur_nearby_rides.
--   5. `chauffeur_nearby_rides` (repart de la DERNIÈRE version, 0388) :
--      masque les courses inter si le flag est coupé.
--   6. `admin_search_rides` v2 : filtre `p_trip` ('inter'|'ville') + colonne
--      `is_interwilaya` en sortie (badge + filtre dans l'explorateur admin).
-- =============================================================================

-- ── 1. Référentiel wilayas (chef-lieu) + plus proche voisin ────────────────
CREATE TABLE IF NOT EXISTS public.wilaya_centroids (
  code TEXT PRIMARY KEY,
  lat  DOUBLE PRECISION NOT NULL,
  lng  DOUBLE PRECISION NOT NULL
);
ALTER TABLE public.wilaya_centroids ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wilaya_centroids_read ON public.wilaya_centroids;
CREATE POLICY wilaya_centroids_read ON public.wilaya_centroids
  FOR SELECT USING (true);

INSERT INTO public.wilaya_centroids (code, lat, lng) VALUES
  ('01', 27.87, -0.29), ('02', 36.16, 1.33), ('03', 33.8, 2.87),
  ('04', 35.88, 7.11), ('05', 35.56, 6.17), ('06', 36.75, 5.06),
  ('07', 34.85, 5.73), ('08', 31.62, -2.22), ('09', 36.47, 2.83),
  ('10', 36.38, 3.9), ('11', 22.79, 5.53), ('12', 35.4, 8.12),
  ('13', 34.88, -1.32), ('14', 35.37, 1.32), ('15', 36.71, 4.05),
  ('16', 36.75, 3.06), ('17', 34.67, 3.25), ('18', 36.82, 5.77),
  ('19', 36.19, 5.41), ('20', 34.83, 0.15), ('21', 36.88, 6.91),
  ('22', 35.19, -0.63), ('23', 36.9, 7.77), ('24', 36.46, 7.43),
  ('25', 36.37, 6.61), ('26', 36.26, 2.75), ('27', 35.93, 0.09),
  ('28', 35.7, 4.54), ('29', 35.4, 0.14), ('30', 31.95, 5.33),
  ('31', 35.7, -0.63), ('32', 33.68, 1.02), ('33', 26.48, 8.47),
  ('34', 36.07, 4.76), ('35', 36.76, 3.47), ('36', 36.77, 8.31),
  ('37', 27.67, -8.15), ('38', 35.61, 1.81), ('39', 33.37, 6.86),
  ('40', 35.43, 7.14), ('41', 36.29, 7.95), ('42', 36.59, 2.45),
  ('43', 36.45, 6.26), ('44', 36.26, 1.97), ('45', 33.27, -0.31),
  ('46', 35.3, -1.14), ('47', 32.49, 3.67), ('48', 35.74, 0.56),
  ('49', 29.26, 0.23), ('50', 21.33, 0.95), ('51', 34.42, 5.06),
  ('52', 30.13, -2.17), ('53', 27.19, 2.48), ('54', 19.57, 5.77),
  ('55', 33.1, 6.06), ('56', 24.55, 9.48), ('57', 33.95, 5.92),
  ('58', 30.58, 2.88)
ON CONFLICT (code) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng;

-- Plus proche centroïde (équirectangulaire — même heuristique que le front).
CREATE OR REPLACE FUNCTION public.drive_nearest_wilaya(
  p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION
) RETURNS TEXT
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT w.code
    FROM public.wilaya_centroids w
   WHERE p_lat IS NOT NULL AND p_lng IS NOT NULL
   ORDER BY (w.lat - p_lat) * (w.lat - p_lat)
          + ((w.lng - p_lng) * cos(radians(p_lat)))
            * ((w.lng - p_lng) * cos(radians(p_lat))) ASC
   LIMIT 1;
$$;

-- ── 2. Colonnes rides + trigger de classification / enforcement ────────────
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS pickup_wilaya TEXT,
  ADD COLUMN IF NOT EXISTS dest_wilaya   TEXT,
  ADD COLUMN IF NOT EXISTS is_interwilaya BOOLEAN NOT NULL DEFAULT false;

-- Classification SERVEUR (jamais la valeur cliente) : wilayas ≠ ET trajet
-- ≥ 35 km (même seuil MIN_INTER_KM que lib/drive/interwilaya.ts — le km route
-- validé par le devis, avec le vol d'oiseau en garde-fou si un client
-- sous-déclarait la distance). Enforce AUSSI le kill-switch dédié : AUCUNE
-- exemption de rôle (post-RLS tout passe en service_role — piège connu).
CREATE OR REPLACE FUNCTION public.classify_ride_trip()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from  TEXT;
  v_to    TEXT;
  v_km    NUMERIC;
  v_inter BOOLEAN := false;
BEGIN
  IF NEW.pickup_lat IS NOT NULL AND NEW.pickup_lng IS NOT NULL
     AND NEW.dest_lat IS NOT NULL AND NEW.dest_lng IS NOT NULL THEN
    v_from := public.drive_nearest_wilaya(NEW.pickup_lat, NEW.pickup_lng);
    v_to   := public.drive_nearest_wilaya(NEW.dest_lat, NEW.dest_lng);
    v_km   := GREATEST(
      COALESCE(NEW.distance_km, 0),
      public.km_between(NEW.pickup_lat, NEW.pickup_lng,
                        NEW.dest_lat, NEW.dest_lng)::NUMERIC);
    v_inter := v_from IS NOT NULL AND v_to IS NOT NULL
               AND v_from <> v_to AND v_km >= 35;
  END IF;
  NEW.pickup_wilaya  := v_from;
  NEW.dest_wilaya    := v_to;
  NEW.is_interwilaya := v_inter;

  IF v_inter AND public.feature_blocked('drive_interwilaya') THEN
    RAISE EXCEPTION 'feature_disabled:drive_interwilaya'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_classify_ride_trip ON public.rides;
CREATE TRIGGER trg_classify_ride_trip BEFORE INSERT ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.classify_ride_trip();

-- Backfill de l'existant (les fonctions sont STABLE — appel direct en SET).
UPDATE public.rides r
   SET pickup_wilaya  = public.drive_nearest_wilaya(r.pickup_lat, r.pickup_lng),
       dest_wilaya    = public.drive_nearest_wilaya(r.dest_lat, r.dest_lng),
       is_interwilaya = (
         public.drive_nearest_wilaya(r.pickup_lat, r.pickup_lng) IS NOT NULL
         AND public.drive_nearest_wilaya(r.dest_lat, r.dest_lng) IS NOT NULL
         AND public.drive_nearest_wilaya(r.pickup_lat, r.pickup_lng)
             <> public.drive_nearest_wilaya(r.dest_lat, r.dest_lng)
         AND GREATEST(
               COALESCE(r.distance_km, 0),
               public.km_between(r.pickup_lat, r.pickup_lng,
                                 r.dest_lat, r.dest_lng)::NUMERIC) >= 35)
 WHERE r.pickup_lat IS NOT NULL AND r.pickup_lng IS NOT NULL
   AND r.dest_lat IS NOT NULL AND r.dest_lng IS NOT NULL;

-- Sous-page chauffeur : les inter en recherche, triées récentes d'abord.
CREATE INDEX IF NOT EXISTS idx_rides_interwilaya_searching
  ON public.rides (created_at DESC)
  WHERE is_interwilaya AND status = 'searching';

-- ── 3. Kill-switch dédié + rayon d'approche configurable ───────────────────
INSERT INTO public.feature_flags (key)
VALUES ('drive_interwilaya')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS drive_interwilaya_radius_km INTEGER NOT NULL DEFAULT 60;

-- ── 4. RPC sous-page chauffeur : demandes INTER dans un rayon élargi ───────
-- Même contrat de sortie que chauffeur_nearby_rides (le type NearbyRide du
-- front est réutilisé tel quel). Différences : filtre is_interwilaya, rayon
-- d'approche élargi (drive_interwilaya_radius_km, clamp 20..150 — un long
-- trajet justifie une approche plus longue), pas de « top-up » v_min (liste
-- exhaustive du rayon), gates drive ET drive_interwilaya.
CREATE OR REPLACE FUNCTION public.chauffeur_interwilaya_rides(
  p_lat double precision, p_lng double precision,
  p_chauffeur_id uuid DEFAULT NULL::uuid
)
 RETURNS TABLE(id uuid, pickup_text text, dest_text text, pickup_lat double precision, pickup_lng double precision, dest_lat double precision, dest_lng double precision, distance_km numeric, proposed_price_da integer, suggested_price_da integer, boost_amount_da integer, gamme text, female_only boolean, payment_method text, pickup_dist_km numeric, created_at timestamp with time zone, my_offer_da integer, customer_name text, customer_rating numeric, customer_since timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ch public.chauffeurs%ROWTYPE;
  v_female_online BOOLEAN;
  v_radius NUMERIC;
BEGIN
  IF public.feature_blocked('drive')
     OR public.feature_blocked('drive_interwilaya') THEN
    RETURN;
  END IF;

  SELECT c.* INTO v_ch FROM public.chauffeurs c
  WHERE (
          (auth.uid() IS NOT NULL AND c.user_id = auth.uid())
          OR (auth.uid() IS NULL AND p_chauffeur_id IS NOT NULL AND c.id = p_chauffeur_id)
        )
    AND c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked;
  IF v_ch.id IS NULL OR p_lat IS NULL OR p_lng IS NULL THEN RETURN; END IF;
  v_female_online := public.drive_female_online();

  SELECT GREATEST(20, LEAST(COALESCE(ps.drive_interwilaya_radius_km, 60), 150))
    INTO v_radius
    FROM public.platform_settings ps WHERE ps.id = true;
  v_radius := COALESCE(v_radius, 60);

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
    AND r.is_interwilaya
    AND (r.expires_at IS NULL OR r.expires_at > now())
    AND NOT EXISTS (SELECT 1 FROM public.ride_offers od
                    WHERE od.ride_id = r.id AND od.chauffeur_id = v_ch.id AND od.status = 'declined')
    AND (CASE v_ch.gamme
          WHEN 'confort' THEN r.gamme IN ('classic','confort')
          WHEN 'classic' THEN r.gamme = 'classic'
          ELSE r.gamme = 'moto' END)
    AND (NOT r.female_only OR v_ch.is_female_verified OR NOT v_female_online)
    AND public.km_between(p_lat, p_lng, r.pickup_lat, r.pickup_lng) <= v_radius
  ORDER BY (r.boost_amount_da > 0) DESC, r.created_at DESC
  LIMIT 30;
END;
$function$;
REVOKE ALL ON FUNCTION public.chauffeur_interwilaya_rides(double precision, double precision, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chauffeur_interwilaya_rides(double precision, double precision, uuid) TO authenticated, service_role;

-- ── 5. chauffeur_nearby_rides : masque les inter si le flag est coupé ──────
-- REPART TEXTUELLEMENT de la DERNIÈRE version (0388) — seule addition : la
-- condition sur is_interwilaya (une course inter encore en recherche ne doit
-- plus s'afficher quand le service est suspendu ; le trigger empêche déjà
-- toute nouvelle création).
CREATE OR REPLACE FUNCTION public.chauffeur_nearby_rides(p_lat double precision, p_lng double precision, p_radius_km numeric DEFAULT NULL::numeric, p_chauffeur_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, pickup_text text, dest_text text, pickup_lat double precision, pickup_lng double precision, dest_lat double precision, dest_lng double precision, distance_km numeric, proposed_price_da integer, suggested_price_da integer, boost_amount_da integer, gamme text, female_only boolean, payment_method text, pickup_dist_km numeric, created_at timestamp with time zone, my_offer_da integer, customer_name text, customer_rating numeric, customer_since timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ch public.chauffeurs%ROWTYPE;
  v_female_online BOOLEAN;
  v_radius NUMERIC;
  v_default NUMERIC;
  v_max    NUMERIC := 20;
  v_min    INTEGER := 6;
BEGIN
  IF public.feature_blocked('drive') THEN RETURN; END IF;

  SELECT c.* INTO v_ch FROM public.chauffeurs c
  WHERE (
          (auth.uid() IS NOT NULL AND c.user_id = auth.uid())
          OR (auth.uid() IS NULL AND p_chauffeur_id IS NOT NULL AND c.id = p_chauffeur_id)
        )
    AND c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked;
  IF v_ch.id IS NULL OR p_lat IS NULL OR p_lng IS NULL THEN RETURN; END IF;
  v_female_online := public.drive_female_online();

  SELECT COALESCE(ps.drive_default_radius_km, 10) INTO v_default
    FROM public.platform_settings ps WHERE ps.id = true;
  v_default := GREATEST(5, LEAST(COALESCE(v_default, 10), v_max));
  v_radius := GREATEST(5, LEAST(
    COALESCE(NULLIF(v_ch.work_zone_radius_km, 0), v_default, p_radius_km, 10), v_max));

  RETURN QUERY
  WITH elig AS (
    SELECT r.id, r.pickup_text, r.dest_text,
           r.pickup_lat, r.pickup_lng, r.dest_lat, r.dest_lng,
           r.distance_km, r.proposed_price_da, r.suggested_price_da,
           r.boost_amount_da, r.gamme, r.female_only, r.payment_method,
           public.km_between(p_lat, p_lng, r.pickup_lat, r.pickup_lng)::NUMERIC AS pdist,
           r.created_at, r.customer_id,
           cu.full_name AS cu_name, cu.created_at AS cu_since
    FROM public.rides r
    JOIN public.customers cu ON cu.id = r.customer_id
    WHERE r.status = 'searching'
      AND (r.expires_at IS NULL OR r.expires_at > now())
      -- Inter-wilayas suspendu (0442) → les courses inter disparaissent.
      AND (NOT r.is_interwilaya OR NOT public.feature_blocked('drive_interwilaya'))
      -- Carte visible en recherche (paiement à l'acceptation, mig 0386/0388).
      AND NOT EXISTS (SELECT 1 FROM public.ride_offers od
                      WHERE od.ride_id = r.id AND od.chauffeur_id = v_ch.id AND od.status = 'declined')
      AND (CASE v_ch.gamme
            WHEN 'confort' THEN r.gamme IN ('classic','confort')
            WHEN 'classic' THEN r.gamme = 'classic'
            ELSE r.gamme = 'moto' END)
      AND (NOT r.female_only OR v_ch.is_female_verified OR NOT v_female_online)
      AND public.km_between(p_lat, p_lng, r.pickup_lat, r.pickup_lng) <= v_max
  ),
  ranked AS (
    SELECT e.*, row_number() OVER (ORDER BY e.pdist ASC) AS rn FROM elig e
  )
  SELECT k.id, k.pickup_text, k.dest_text,
         k.pickup_lat, k.pickup_lng, k.dest_lat, k.dest_lng,
         k.distance_km, k.proposed_price_da, k.suggested_price_da,
         k.boost_amount_da, k.gamme, k.female_only, k.payment_method,
         k.pdist AS pickup_dist_km,
         k.created_at,
         (SELECT o.price_da FROM public.ride_offers o
           WHERE o.ride_id = k.id AND o.chauffeur_id = v_ch.id AND o.status = 'offered') AS my_offer_da,
         COALESCE(NULLIF(split_part(k.cu_name, ' ', 1), ''), 'Client') AS customer_name,
         (SELECT round(avg(r2.client_rating)::NUMERIC, 1) FROM public.rides r2
           WHERE r2.customer_id = k.customer_id AND r2.client_rating IS NOT NULL) AS customer_rating,
         k.cu_since AS customer_since
  FROM ranked k
  WHERE k.pdist <= v_radius OR k.rn <= v_min
  ORDER BY (k.boost_amount_da > 0) DESC, k.created_at DESC
  LIMIT 30;
END;
$function$;

-- ── 6. admin_search_rides v2 : filtre trajet + colonne is_interwilaya ──────
-- Signature et sortie changent → DROP puis recréation + re-GRANT.
DROP FUNCTION IF EXISTS public.admin_search_rides(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,INTEGER,INTEGER);
CREATE OR REPLACE FUNCTION public.admin_search_rides(
  p_q           TEXT DEFAULT NULL,
  p_chauffeur_q TEXT DEFAULT NULL,
  p_status      TEXT DEFAULT NULL,
  p_payment     TEXT DEFAULT NULL,
  p_from        TIMESTAMPTZ DEFAULT NULL,
  p_to          TIMESTAMPTZ DEFAULT NULL,
  p_trip        TEXT DEFAULT NULL, -- 'inter' | 'ville' | NULL (tous)
  p_limit       INTEGER DEFAULT 30,
  p_offset      INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID, status TEXT, payment_method TEXT,
  price_da INTEGER, escrow_da INTEGER, admin_refunded_da INTEGER,
  pickup_text TEXT, dest_text TEXT, gamme TEXT,
  is_interwilaya BOOLEAN, pickup_wilaya TEXT, dest_wilaya TEXT,
  customer_id UUID, customer_name TEXT, customer_phone TEXT,
  chauffeur_id UUID, chauffeur_name TEXT,
  cancelled_by TEXT, created_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q  TEXT := NULLIF(btrim(COALESCE(p_q, '')), '');
  v_cq TEXT := NULLIF(btrim(COALESCE(p_chauffeur_q, '')), '');
BEGIN
  IF NOT public.admin_can('drive') THEN
    RETURN; -- fail-closed
  END IF;

  RETURN QUERY
  SELECT
    r.id, r.status::TEXT, r.payment_method,
    GREATEST(0, COALESCE(r.agreed_price_da,
                         r.proposed_price_da + r.boost_amount_da, 0)) AS price_da,
    r.escrow_da, r.admin_refunded_da,
    r.pickup_text, r.dest_text, r.gamme,
    r.is_interwilaya, r.pickup_wilaya, r.dest_wilaya,
    r.customer_id, cu.full_name, cu.phone,
    r.chauffeur_id, ch.full_name,
    r.cancelled_by, r.created_at, r.completed_at,
    COUNT(*) OVER () AS total_count
  FROM public.rides r
  JOIN public.customers cu ON cu.id = r.customer_id
  LEFT JOIN public.chauffeurs ch ON ch.id = r.chauffeur_id
  WHERE
    (v_q IS NULL
      OR cu.full_name ILIKE '%' || v_q || '%'
      OR cu.phone ILIKE '%' || v_q || '%'
      OR r.pickup_text ILIKE '%' || v_q || '%'
      OR r.dest_text ILIKE '%' || v_q || '%'
      OR r.id::TEXT = lower(v_q)
      OR r.customer_id::TEXT = lower(v_q))
    AND (v_cq IS NULL
      OR (ch.id IS NOT NULL AND (
            ch.full_name ILIKE '%' || v_cq || '%'
         OR ch.phone ILIKE '%' || v_cq || '%'
         OR ch.id::TEXT = lower(v_cq))))
    AND (p_status IS NULL
      OR (p_status = 'active'
          AND r.status IN ('searching','scheduled','accepted','arriving','arrived','in_progress'))
      OR r.status::TEXT = p_status)
    AND (p_payment IS NULL OR r.payment_method = p_payment)
    AND (p_trip IS NULL
      OR (p_trip = 'inter' AND r.is_interwilaya)
      OR (p_trip = 'ville' AND NOT r.is_interwilaya))
    AND (p_from IS NULL OR r.created_at >= p_from)
    AND (p_to IS NULL OR r.created_at < p_to)
  ORDER BY r.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_search_rides(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,INTEGER,INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_rides(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,INTEGER,INTEGER) TO authenticated;
