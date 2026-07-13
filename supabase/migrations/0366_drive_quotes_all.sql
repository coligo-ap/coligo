-- =============================================================================
-- 0366 — Drive : devis des 3 gammes en UN SEUL aller-retour
-- =============================================================================
-- `getDriveQuotes` faisait 6 RPC PostgREST (3 gammes × smart_quote +
-- similar_range) : 6 requêtes HTTP série/parallèles depuis la fonction
-- serverless → latence perçue sur l'écran prix (le client attend LE prix).
-- `drive_quotes_all` regroupe tout en une requête : Postgres évalue les six
-- fonctions en interne, l'app ne paie plus qu'un aller-retour.
-- Aucune logique de prix modifiée : simple composition des fonctions
-- existantes (mig 0235 smart_quote, mig 0140 similar_range).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.drive_quotes_all(
  p_distance_km  NUMERIC,
  p_pickup_lat   DOUBLE PRECISION DEFAULT NULL,
  p_pickup_lng   DOUBLE PRECISION DEFAULT NULL,
  p_duration_min NUMERIC DEFAULT NULL
) RETURNS TABLE(
  gamme    TEXT,
  floor_da INTEGER,
  mini_da  INTEGER,
  reco_da  INTEGER,
  fast_da  INTEGER,
  low_da   INTEGER,
  high_da  INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT g.gamme, q.floor_da, q.mini_da, q.reco_da, q.fast_da, r.low_da, r.high_da
    FROM (VALUES ('classic'), ('confort'), ('moto')) AS g(gamme)
    CROSS JOIN LATERAL public.drive_smart_quote(
      p_distance_km, g.gamme, p_pickup_lat, p_pickup_lng, now(), false, p_duration_min
    ) q
    CROSS JOIN LATERAL public.drive_similar_range(p_distance_km, g.gamme) r;
$$;

-- Mêmes rôles que drive_smart_quote (anon compris — parité d'accès).
GRANT EXECUTE ON FUNCTION public.drive_quotes_all(NUMERIC, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC)
  TO authenticated, anon;
