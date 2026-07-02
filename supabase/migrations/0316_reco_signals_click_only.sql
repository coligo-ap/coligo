-- =============================================================================
-- 0316 — Reco : `clicks_7d` ne compte QUE les clics (kind='click').
-- La 0315 comptait tous les reco_events ; avec l'événement « vue de vitrine »
-- ajouté côté client, les vues auraient gonflé le signal clic. Les vues
-- restent stockées (matière CTR future : clics/vues) mais hors du boost.
-- =============================================================================

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
      AND e.kind = 'click'
      AND e.created_at >= now() - interval '7 days'
  ) c7 ON true
  WHERE m.is_active = true;
$$;

GRANT EXECUTE ON FUNCTION public.merchant_reco_signals() TO anon, authenticated;
