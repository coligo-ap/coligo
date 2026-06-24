-- =============================================================================
-- 0253 — Drive : fondation du dispatch PUSH (PostGIS + KNN)
-- =============================================================================
-- Contexte (refonte scalabilité dispatch chauffeur) : on abandonne le modèle
-- « chaque chauffeur poll le serveur toutes les 12-15 s + abonnement Realtime
-- GLOBAL aux INSERT de `rides` » — qui est en O(courses × chauffeurs en ligne)
-- et sature Realtime/serverless/pooler dès quelques centaines de chauffeurs —
-- au profit d'un DISPATCH CÔTÉ SERVEUR : à la création d'une course, on
-- sélectionne les N chauffeurs éligibles les PLUS PROCHES et on leur pousse la
-- demande (broadcast ciblé). Le chauffeur n'écoute plus, ne poll plus.
--
-- Cette migration pose la FONDATION (additive, non bloquante — aucun code
-- applicatif ne dépend encore de ces objets) :
--   1. Active PostGIS (schéma `extensions`, convention repo).
--   2. Ajoute une colonne géographique indexée GiST à `chauffeur_presence`,
--      maintenue par trigger depuis lat/lng (source de vérité inchangée).
--   3. `chauffeur_dispatch_knn(...)` : primitive de matching KNN — les N
--      chauffeurs EN LIGNE + position FRAÎCHE + disponibles + éligibles, triés
--      par distance réelle au point de prise en charge.
--
-- IMPORTANT : le matching DOIT lire l'état « en ligne + fraîcheur » DANS LA BASE
-- (colonnes `is_online` / `updated_at`), car Realtime *Presence* vit en mémoire
-- et n'est PAS requêtable en SQL. La présence Realtime sert l'UI/liveness ; la
-- table reste la source de vérité du dispatch.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. PostGIS (idempotent). Installé dans `extensions` (cf. pg_trgm, pgcrypto).
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 2. Colonne géographique + index spatial sur la présence chauffeur.
--    `geog` est DÉRIVÉE de (lat, lng) — lat/lng restent la source de vérité
--    (lues partout ailleurs) ; `geog` n'existe que pour le KNN rapide.
-- ---------------------------------------------------------------------------
ALTER TABLE public.chauffeur_presence
  ADD COLUMN IF NOT EXISTS geog extensions.geography(Point, 4326);

CREATE OR REPLACE FUNCTION public.chauffeur_presence_sync_geog()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  -- ST_MakePoint(lng, lat) — ordre X,Y (longitude d'abord).
  NEW.geog := extensions.ST_SetSRID(
                extensions.ST_MakePoint(NEW.lng, NEW.lat), 4326
              )::extensions.geography;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chauffeur_presence_geog ON public.chauffeur_presence;
CREATE TRIGGER trg_chauffeur_presence_geog
  BEFORE INSERT OR UPDATE OF lat, lng ON public.chauffeur_presence
  FOR EACH ROW EXECUTE FUNCTION public.chauffeur_presence_sync_geog();

-- Backfill des lignes existantes (le trigger ne couvre que les écritures à venir).
UPDATE public.chauffeur_presence
  SET geog = extensions.ST_SetSRID(extensions.ST_MakePoint(lng, lat), 4326)::extensions.geography
  WHERE geog IS NULL;

-- Index spatial GiST : permet le KNN `<->` en O(log n).
CREATE INDEX IF NOT EXISTS idx_chauffeur_presence_geog
  ON public.chauffeur_presence USING GIST (geog);

-- ---------------------------------------------------------------------------
-- 3. Primitive de DISPATCH : les N chauffeurs les plus proches, éligibles.
--    Appelée par l'Edge Function / la RPC de création de course pour décider
--    À QUI pousser la demande (au lieu de la diffuser à tout le monde).
--
--    Filtres (tous côté serveur, anti-fantôme) :
--      • en ligne (`is_online`) ET position fraîche (`updated_at` récent) ;
--      • compte actif (non gelé, non bloqué, vérifié, user_id présent) ;
--      • DISPONIBLE : pas déjà sur une course active.
--    Tri : distance géographique réelle croissante (KNN GiST).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chauffeur_dispatch_knn(
  p_lat        DOUBLE PRECISION,
  p_lng        DOUBLE PRECISION,
  p_limit      INTEGER DEFAULT 20,
  p_max_km     NUMERIC DEFAULT 20,
  p_fresh_secs INTEGER DEFAULT 60
)
RETURNS TABLE(
  chauffeur_id UUID,
  user_id      UUID,
  dist_km      NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  WITH origin AS (
    SELECT extensions.ST_SetSRID(
             extensions.ST_MakePoint(p_lng, p_lat), 4326
           )::extensions.geography AS g
  )
  SELECT
    p.chauffeur_id,
    ch.user_id,
    (extensions.ST_Distance(p.geog, o.g) / 1000.0)::NUMERIC(7, 3) AS dist_km
  FROM public.chauffeur_presence p
  CROSS JOIN origin o
  JOIN public.chauffeurs ch ON ch.id = p.chauffeur_id
  WHERE p_lat IS NOT NULL AND p_lng IS NOT NULL
    AND p.is_online = true
    AND p.updated_at > now() - make_interval(secs => GREATEST(15, p_fresh_secs))
    AND ch.user_id IS NOT NULL
    AND COALESCE(ch.is_verified, false) = true
    AND COALESCE(ch.is_frozen, false) = false
    AND COALESCE(ch.is_blocked, false) = false
    -- Disponible : aucune course en cours qui lui est attribuée.
    AND NOT EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.chauffeur_id = ch.id
        AND r.status IN ('accepted', 'arriving', 'arrived', 'in_progress')
    )
    -- Borne dure de distance (en mètres) AVANT le tri KNN.
    AND extensions.ST_DWithin(
          p.geog, o.g,
          GREATEST(500, LEAST(COALESCE(p_max_km, 20), 50) * 1000)
        )
  ORDER BY p.geog OPERATOR(extensions.<->) o.g
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 50));
$$;

GRANT EXECUTE ON FUNCTION public.chauffeur_dispatch_knn(
  DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, NUMERIC, INTEGER
) TO authenticated, service_role;
