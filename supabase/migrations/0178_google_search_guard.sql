-- =============================================================================
-- 0178 — Garde-fous Google Places : cache 30 j + quotas journaliers
-- =============================================================================
-- Google Places n'est appelé qu'en DERNIER RECOURS (sources gratuites d'abord).
-- Pour réduire la facturation au minimum : (1) cache 30 jours par requête (une
-- recherche payée ne l'est jamais deux fois — limite ToS Google = 30 j) ;
-- (2) plafonds journaliers global + par client (anti-dérapage hard).
-- Accès via fonctions SECURITY DEFINER (RLS deny-all sur les tables).
-- =============================================================================

-- Cache des résultats Google (clé = requête normalisée).
CREATE TABLE IF NOT EXISTS public.geo_google_cache (
  q          TEXT PRIMARY KEY,
  results    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.geo_google_cache ENABLE ROW LEVEL SECURITY;

-- Compteur d'usage journalier (par nom de quota).
CREATE TABLE IF NOT EXISTS public.api_usage_daily (
  day   DATE NOT NULL,
  name  TEXT NOT NULL,
  count INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (day, name)
);
ALTER TABLE public.api_usage_daily ENABLE ROW LEVEL SECURITY;

-- Lecture cache (frais < 30 j, sinon NULL → on rappellera Google).
CREATE OR REPLACE FUNCTION public.geo_google_cache_get(p_q TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT results FROM public.geo_google_cache
   WHERE q = p_q AND created_at > now() - interval '30 days';
$$;

-- Écriture cache (upsert + rafraîchit la date).
CREATE OR REPLACE FUNCTION public.geo_google_cache_put(p_q TEXT, p_results JSONB)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.geo_google_cache(q, results) VALUES (p_q, p_results)
  ON CONFLICT (q) DO UPDATE SET results = excluded.results, created_at = now();
$$;

-- Décrément de quota : true s'il reste du budget aujourd'hui (et consomme 1),
-- false si le plafond est atteint (ne consomme pas). Anti-dérapage hard.
CREATE OR REPLACE FUNCTION public.api_quota_take(p_name TEXT, p_cap INT)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v INT;
BEGIN
  SELECT count INTO v FROM public.api_usage_daily
   WHERE day = current_date AND name = p_name;
  IF coalesce(v, 0) >= p_cap THEN RETURN false; END IF;
  INSERT INTO public.api_usage_daily(day, name, count) VALUES (current_date, p_name, 1)
    ON CONFLICT (day, name) DO UPDATE SET count = public.api_usage_daily.count + 1;
  RETURN true;
END
$$;

GRANT EXECUTE ON FUNCTION public.geo_google_cache_get(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.geo_google_cache_put(TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.api_quota_take(TEXT, INT) TO authenticated;
