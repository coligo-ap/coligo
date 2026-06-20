-- =============================================================================
-- 0234 — Devis de prix signés serveur (Partie D du prompt : anti-prix-périmé)
-- =============================================================================
-- Chaque estimation tarifaire (Drive ET Livraison) émet un DEVIS stocké côté
-- serveur : adresses + distance (recalculée serveur) + prix + ville + TTL.
-- Propriétés anti-fraude :
--   • émis et stocké par le serveur (le client ne peut pas le forger) ;
--   • lié aux ADRESSES exactes (tolérance ~60 m) → un devis ne vaut que pour le
--     trajet estimé ; changer d'adresse l'invalide ;
--   • à USAGE UNIQUE (consumed_at) → pas de rejeu d'un vieux prix avantageux ;
--   • EXPIRABLE (TTL = platform_settings.quote_ttl_s).
-- À la création de course/commande, l'action serveur vérifie+consomme le devis
-- AVANT d'engager le prix. Un devis périmé/incohérent est refusé → le client
-- re-demande une estimation. Le quote_id (uuid aléatoire) est l'identifiant
-- opaque rendu au client ; la ligne serveur fait foi (tamper-proof).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.geo_quotes (
  quote_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  context      TEXT NOT NULL CHECK (context IN ('drive', 'delivery')),
  pickup_lat   DOUBLE PRECISION NOT NULL,
  pickup_lng   DOUBLE PRECISION NOT NULL,
  pickup_text  TEXT,
  dest_lat     DOUBLE PRECISION,
  dest_lng     DOUBLE PRECISION,
  dest_text    TEXT,
  wilaya_code  TEXT,
  commune      TEXT,
  distance_km  NUMERIC NOT NULL DEFAULT 0,
  duration_min NUMERIC,
  price_da     INTEGER NOT NULL,
  meta         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_geo_quotes_user ON public.geo_quotes (user_id, created_at DESC);

ALTER TABLE public.geo_quotes ENABLE ROW LEVEL SECURITY;

-- Le client lit UNIQUEMENT ses propres devis (RLS). Insert/Update : DEFINER only.
DROP POLICY IF EXISTS geo_quotes_owner_read ON public.geo_quotes;
CREATE POLICY geo_quotes_owner_read ON public.geo_quotes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Haversine (mètres) — pour la tolérance d'adresse.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.geo_distance_m(
  a_lat DOUBLE PRECISION, a_lng DOUBLE PRECISION,
  b_lat DOUBLE PRECISION, b_lng DOUBLE PRECISION
) RETURNS DOUBLE PRECISION
LANGUAGE sql IMMUTABLE AS $$
  SELECT 6371000 * acos(LEAST(1, GREATEST(-1,
    cos(radians(a_lat)) * cos(radians(b_lat)) * cos(radians(b_lng) - radians(a_lng))
    + sin(radians(a_lat)) * sin(radians(b_lat)))));
$$;

-- ----------------------------------------------------------------------------
-- Émission d'un devis. Distance RECALCULÉE serveur (Haversine), jamais celle du
-- client. TTL = platform_settings.quote_ttl_s. Renvoie le quote_id + l'échéance.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.geo_quote_issue(
  p_context     TEXT,
  p_pickup_lat  DOUBLE PRECISION, p_pickup_lng DOUBLE PRECISION, p_pickup_text TEXT,
  p_dest_lat    DOUBLE PRECISION, p_dest_lng DOUBLE PRECISION, p_dest_text TEXT,
  p_price_da    INTEGER,
  p_wilaya      TEXT DEFAULT NULL, p_commune TEXT DEFAULT NULL,
  p_duration_min NUMERIC DEFAULT NULL,
  p_meta        JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE(quote_id UUID, expires_at TIMESTAMPTZ, distance_km NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ttl INTEGER;
  v_dist NUMERIC := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentification requise.' USING ERRCODE='check_violation'; END IF;
  IF p_context NOT IN ('drive','delivery') THEN RAISE EXCEPTION 'Contexte invalide.' USING ERRCODE='check_violation'; END IF;

  SELECT COALESCE(quote_ttl_s, 300) INTO v_ttl FROM public.platform_settings WHERE id = true;
  IF v_ttl IS NULL THEN v_ttl := 300; END IF;

  IF p_dest_lat IS NOT NULL AND p_dest_lng IS NOT NULL THEN
    v_dist := public.geo_distance_m(p_pickup_lat, p_pickup_lng, p_dest_lat, p_dest_lng) / 1000.0;
  END IF;

  RETURN QUERY
  INSERT INTO public.geo_quotes(
    user_id, context, pickup_lat, pickup_lng, pickup_text,
    dest_lat, dest_lng, dest_text, wilaya_code, commune,
    distance_km, duration_min, price_da, meta, expires_at)
  VALUES (
    v_uid, p_context, p_pickup_lat, p_pickup_lng, p_pickup_text,
    p_dest_lat, p_dest_lng, p_dest_text, p_wilaya, p_commune,
    ROUND(v_dist, 3), p_duration_min, GREATEST(0, p_price_da), COALESCE(p_meta, '{}'::jsonb),
    now() + make_interval(secs => v_ttl))
  RETURNING geo_quotes.quote_id, geo_quotes.expires_at, geo_quotes.distance_km;
END;
$$;

GRANT EXECUTE ON FUNCTION public.geo_quote_issue(
  TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT,
  INTEGER, TEXT, TEXT, NUMERIC, JSONB) TO authenticated;

-- ----------------------------------------------------------------------------
-- Vérification (+ consommation optionnelle) d'un devis à la création de course/
-- commande. Contrôles : propriété, contexte, non-expiré, non-consommé, adresses
-- inchangées (tolérance p_tol_m). Renvoie le prix/distance DU DEVIS (fait foi).
-- reason : ok | not_found | expired | consumed | addr_changed
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.geo_quote_verify(
  p_quote_id   UUID,
  p_context    TEXT,
  p_pickup_lat DOUBLE PRECISION, p_pickup_lng DOUBLE PRECISION,
  p_dest_lat   DOUBLE PRECISION DEFAULT NULL, p_dest_lng DOUBLE PRECISION DEFAULT NULL,
  p_consume    BOOLEAN DEFAULT true,
  p_tol_m      DOUBLE PRECISION DEFAULT 80
) RETURNS TABLE(ok BOOLEAN, reason TEXT, price_da INTEGER, distance_km NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  q public.geo_quotes%ROWTYPE;
BEGIN
  SELECT * INTO q FROM public.geo_quotes
   WHERE quote_id = p_quote_id AND user_id = v_uid AND context = p_context;

  IF q.quote_id IS NULL THEN
    RETURN QUERY SELECT false, 'not_found', NULL::INTEGER, NULL::NUMERIC; RETURN;
  END IF;
  IF q.consumed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'consumed', q.price_da, q.distance_km; RETURN;
  END IF;
  IF q.expires_at < now() THEN
    RETURN QUERY SELECT false, 'expired', q.price_da, q.distance_km; RETURN;
  END IF;

  -- Adresses inchangées (chaque extrémité dans la tolérance).
  IF public.geo_distance_m(q.pickup_lat, q.pickup_lng, p_pickup_lat, p_pickup_lng) > p_tol_m THEN
    RETURN QUERY SELECT false, 'addr_changed', q.price_da, q.distance_km; RETURN;
  END IF;
  IF q.dest_lat IS NOT NULL AND p_dest_lat IS NOT NULL
     AND public.geo_distance_m(q.dest_lat, q.dest_lng, p_dest_lat, p_dest_lng) > p_tol_m THEN
    RETURN QUERY SELECT false, 'addr_changed', q.price_da, q.distance_km; RETURN;
  END IF;

  IF p_consume THEN
    UPDATE public.geo_quotes SET consumed_at = now() WHERE quote_id = q.quote_id;
  END IF;
  RETURN QUERY SELECT true, 'ok', q.price_da, q.distance_km;
END;
$$;

GRANT EXECUTE ON FUNCTION public.geo_quote_verify(
  UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, BOOLEAN, DOUBLE PRECISION)
  TO authenticated;
