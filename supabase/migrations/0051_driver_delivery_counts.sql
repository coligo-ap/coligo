-- =============================================================================
-- 0051 — Compteurs de courses par commerçant pour le tableau de bord livreur
-- =============================================================================
-- La RLS livreur (0044) ne laisse lire QUE les commandes déjà attribuées au
-- livreur. Le dashboard a besoin de compter les courses DISPONIBLES (express
-- non attribuées + commandes en tournée en attente) chez chacun de ses
-- commerçants → on passe par un RPC SECURITY DEFINER qui calcule ces
-- compteurs et les renvoie déjà triés (commerçant le plus chargé d'abord,
-- pour livrer au plus vite).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.driver_delivery_counts()
RETURNS TABLE(
  merchant_driver_id UUID,
  merchant_id        UUID,
  merchant_name      TEXT,
  express_enabled    BOOLEAN,
  tours_enabled      BOOLEAN,
  express_available  INTEGER,
  tour_pending       INTEGER
) AS $$
DECLARE
  v_driver_id UUID;
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    md.id,
    m.id,
    m.name,
    m.express_enabled,
    m.tours_enabled,
    COALESCE(ex.cnt, 0)::int,
    COALESCE(tr.cnt, 0)::int
  FROM public.merchant_drivers md
  JOIN public.merchants m ON m.id = md.merchant_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS cnt
    FROM public.orders o
    WHERE o.merchant_id = m.id
      AND o.fulfillment_type = 'delivery'
      AND o.delivery_mode = 'express'
      AND o.delivery_driver_id IS NULL
      AND o.status IN ('preparing', 'ready')
  ) ex ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS cnt
    FROM public.orders o
    WHERE o.merchant_id = m.id
      AND o.fulfillment_type = 'delivery'
      AND o.delivery_mode = 'tour'
      AND o.status NOT IN ('completed', 'cancelled')
  ) tr ON true
  WHERE md.driver_id = v_driver_id
    AND md.status = 'active'
  ORDER BY (COALESCE(ex.cnt, 0) + COALESCE(tr.cnt, 0)) DESC, m.name ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.driver_delivery_counts() TO authenticated;
