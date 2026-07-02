-- =============================================================================
-- 0315 — PHASE 5 : MOTEUR DE RECOMMANDATION heuristique (zéro API payante).
--
-- 1. reco_events : événements légers (clic sur une vitrine dans le
--    marketplace, vue) — la matière d'APPRENTISSAGE future (pondérations par
--    CTR). Écriture ouverte (best-effort, anon compris, customer_id auto =
--    auth.uid), LECTURE service_role uniquement (vie privée).
-- 2. merchant_reco_signals() : agrégats PUBLICS et transparents par commerce
--    actif — commandes 7 j (popularité récente), MES commandes (réachat,
--    auth.uid), clics 7 j. Le classement final (proximité dominante ×
--    popularité × réachat × note) est calculé côté serveur applicatif.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.reco_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id UUID DEFAULT auth.uid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('view', 'click')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reco_events_merchant_time_idx
  ON public.reco_events (merchant_id, created_at DESC);

ALTER TABLE public.reco_events ENABLE ROW LEVEL SECURITY;

-- Écriture best-effort par n'importe quel visiteur ; aucune lecture client.
DROP POLICY IF EXISTS reco_events_insert ON public.reco_events;
CREATE POLICY reco_events_insert ON public.reco_events
  FOR INSERT TO anon, authenticated WITH CHECK (true);
REVOKE SELECT, UPDATE, DELETE ON public.reco_events FROM anon, authenticated;

-- Signaux agrégés par commerce ACTIF (aucune donnée individuelle exposée).
CREATE OR REPLACE FUNCTION public.merchant_reco_signals()
RETURNS TABLE (
  merchant_id UUID,
  orders_7d   INTEGER,
  my_orders   INTEGER,
  clicks_7d   INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    m.id AS merchant_id,
    COALESCE(o7.n, 0)::int  AS orders_7d,
    COALESCE(mine.n, 0)::int AS my_orders,
    COALESCE(c7.n, 0)::int  AS clicks_7d
  FROM public.merchants m
  LEFT JOIN LATERAL (
    SELECT count(*) AS n FROM public.orders o
    WHERE o.merchant_id = m.id
      AND o.status NOT IN ('cancelled')
      AND o.created_at >= now() - interval '7 days'
  ) o7 ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS n FROM public.orders o
    WHERE o.merchant_id = m.id
      AND o.customer_id = auth.uid()
      AND o.status = 'completed'
  ) mine ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS n FROM public.reco_events e
    WHERE e.merchant_id = m.id
      AND e.created_at >= now() - interval '7 days'
  ) c7 ON true
  WHERE m.is_active = true;
$$;

GRANT EXECUTE ON FUNCTION public.merchant_reco_signals() TO anon, authenticated;
