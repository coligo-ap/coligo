-- =============================================================================
-- 0256 — Drive : `chauffeurs_present_near` passe à PostGIS (index GiST)
-- =============================================================================
-- La sélection des chauffeurs proches utilisait un haversine en `acos()` calculé
-- DEUX fois par ligne (distance affichée + filtre rayon) → scan séquentiel O(n)
-- de chauffeur_presence. On bascule sur la colonne `geog` + index GiST (mig
-- 0253) : `ST_DWithin` filtre via l'index (O(log n)) et `ST_Distance` donne la
-- distance réelle. TOUTE la logique métier est CONSERVÉE À L'IDENTIQUE (matching
-- gamme, « femme au volant », favoris client, priorité premium, démo, fraîcheur,
-- vérifié/gelé/bloqué, ordre de tri). Mêmes paramètres, même type de retour.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.chauffeurs_present_near(
  p_lat        DOUBLE PRECISION,
  p_lng        DOUBLE PRECISION,
  p_radius_km  NUMERIC DEFAULT 6,
  p_within_min INTEGER DEFAULT 3,
  p_gamme      TEXT DEFAULT NULL,
  p_female_only BOOLEAN DEFAULT false,
  p_customer_id UUID DEFAULT NULL
)
RETURNS TABLE(
  user_id UUID, chauffeur_id UUID, dist_km NUMERIC,
  is_premium BOOLEAN, is_favorite BOOLEAN, is_female BOOLEAN
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_female_online BOOLEAN := false;
  v_origin extensions.geography;
  v_radius_m DOUBLE PRECISION := GREATEST(0.5, LEAST(COALESCE(p_radius_km, 6), 30)) * 1000;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN; END IF;
  IF COALESCE(p_female_only, false) THEN
    v_female_online := public.drive_female_online();
  END IF;
  v_origin := extensions.ST_SetSRID(
                extensions.ST_MakePoint(p_lng, p_lat), 4326
              )::extensions.geography;

  RETURN QUERY
  SELECT ch.user_id, ch.id,
    (extensions.ST_Distance(p.geog, v_origin) / 1000.0)::NUMERIC AS dist_km,
    (rp.plan = 'premium') AS is_premium,
    (p_customer_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.customer_favorite_chauffeurs f
       WHERE f.customer_id = p_customer_id AND f.chauffeur_id = ch.id)) AS is_favorite,
    ch.is_female_verified AS is_female
  FROM public.chauffeur_presence p
  JOIN public.chauffeurs ch ON ch.id = p.chauffeur_id
  CROSS JOIN LATERAL public.resolve_drive_plan(ch.id) rp
  WHERE p.is_online = true
    AND (p.updated_at > now() - make_interval(mins => GREATEST(1, p_within_min)) OR ch.is_demo)
    AND ch.user_id IS NOT NULL
    AND COALESCE(ch.is_verified, false) = true
    AND COALESCE(ch.is_frozen, false) = false
    AND COALESCE(ch.is_blocked, false) = false
    AND (p_gamme IS NULL OR (CASE ch.gamme
          WHEN 'confort' THEN p_gamme IN ('classic','confort')
          WHEN 'classic' THEN p_gamme = 'classic'
          ELSE p_gamme = 'moto' END))
    AND (NOT COALESCE(p_female_only,false) OR ch.is_female_verified OR NOT v_female_online)
    -- Filtre rayon via l'index GiST (remplace le double haversine acos()).
    AND extensions.ST_DWithin(p.geog, v_origin, v_radius_m)
  ORDER BY 4 DESC, 5 DESC, 3 ASC;
END;
$function$;
