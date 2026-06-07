-- =============================================================================
-- 0095 — Signalements de livraison (client ↔ livreur), bidirectionnels
-- =============================================================================
-- • Le CLIENT peut signaler le LIVREUR (non-respect, menace, harcèlement,
--   insulte, comportement dangereux, sac sale, commande renversée, autre…).
-- • Le LIVREUR peut signaler le CLIENT (problème pendant la course).
--
-- Sécurité / robustesse :
--   • Écriture UNIQUEMENT via RPC SECURITY DEFINER `submit_delivery_report`
--     (aucune policy INSERT) : le rôle de l'appelant est déterminé côté serveur
--     à partir de la commande (client propriétaire OU livreur attribué).
--   • 1 signalement MAX par commande et par sens (UNIQUE order_id+reporter_role).
--   • Lecture : le signaleur voit les siens ; le super-admin voit tout. Le
--     signalé NE voit PAS qu'il a été signalé (évite les représailles).
--   • Modération : RPC admin dédiées (liste + changement de statut), gardées par
--     is_super_admin().
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.delivery_reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  reporter_role    TEXT NOT NULL CHECK (reporter_role IN ('customer', 'driver')),
  reporter_user_id UUID NOT NULL,
  customer_id      UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  driver_id        UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  reason           TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 60),
  details          TEXT CHECK (details IS NULL OR char_length(details) <= 1000),
  status           TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  admin_note       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ,
  UNIQUE (order_id, reporter_role)
);

CREATE INDEX IF NOT EXISTS idx_delivery_reports_status
  ON public.delivery_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_reports_driver
  ON public.delivery_reports(driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_reports_customer
  ON public.delivery_reports(customer_id, created_at DESC);

ALTER TABLE public.delivery_reports ENABLE ROW LEVEL SECURITY;

-- Lecture : l'auteur du signalement (par user_id) OU le super-admin.
DROP POLICY IF EXISTS delivery_reports_select ON public.delivery_reports;
CREATE POLICY delivery_reports_select ON public.delivery_reports
  FOR SELECT TO authenticated
  USING (reporter_user_id = auth.uid() OR public.is_super_admin());

-- Pas de policy INSERT/UPDATE/DELETE : tout passe par les RPC ci-dessous.

-- ── RPC d'envoi : rôle déterminé serveur ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_delivery_report(
  p_order_id UUID,
  p_reason   TEXT,
  p_details  TEXT DEFAULT NULL
) RETURNS TABLE(ok BOOLEAN, reason TEXT) AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_order  public.orders%ROWTYPE;
  v_role   TEXT;
  v_reason TEXT := btrim(COALESCE(p_reason, ''));
  v_det    TEXT := NULLIF(btrim(COALESCE(p_details, '')), '');
BEGIN
  IF length(v_reason) = 0 OR length(v_reason) > 60 THEN
    ok := false; reason := 'bad_reason'; RETURN NEXT; RETURN;
  END IF;
  IF v_det IS NOT NULL AND length(v_det) > 1000 THEN
    v_det := left(v_det, 1000);
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    ok := false; reason := 'order_not_found'; RETURN NEXT; RETURN;
  END IF;
  IF v_order.fulfillment_type <> 'delivery' OR v_order.delivery_driver_id IS NULL THEN
    ok := false; reason := 'no_delivery'; RETURN NEXT; RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = v_order.customer_id AND c.user_id = v_uid
  ) THEN
    v_role := 'customer';
  ELSIF EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = v_order.delivery_driver_id AND d.user_id = v_uid
  ) THEN
    v_role := 'driver';
  ELSE
    ok := false; reason := 'not_authorized'; RETURN NEXT; RETURN;
  END IF;

  INSERT INTO public.delivery_reports
    (order_id, reporter_role, reporter_user_id, customer_id, driver_id, reason, details)
  VALUES
    (p_order_id, v_role, v_uid, v_order.customer_id, v_order.delivery_driver_id,
     v_reason, v_det)
  ON CONFLICT (order_id, reporter_role) DO NOTHING;

  IF NOT FOUND THEN
    ok := false; reason := 'already_reported'; RETURN NEXT; RETURN;
  END IF;

  ok := true; reason := NULL; RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.submit_delivery_report(UUID, TEXT, TEXT) TO authenticated;

-- ── RPC admin : liste des signalements (modération) ──────────────────────────
CREATE OR REPLACE FUNCTION public.admin_delivery_reports(p_limit INTEGER DEFAULT 200)
RETURNS TABLE(
  id            UUID,
  order_id      UUID,
  order_number  TEXT,
  reporter_role TEXT,
  reason        TEXT,
  details       TEXT,
  status        TEXT,
  customer_name TEXT,
  driver_name   TEXT,
  created_at    TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ,
  admin_note    TEXT
) AS $$
  SELECT
    r.id, r.order_id, o.order_number, r.reporter_role, r.reason, r.details,
    r.status, o.customer_name, d.full_name, r.created_at, r.resolved_at,
    r.admin_note
  FROM public.delivery_reports r
  JOIN public.orders o  ON o.id = r.order_id
  LEFT JOIN public.drivers d ON d.id = r.driver_id
  WHERE public.is_super_admin()
  ORDER BY
    CASE r.status WHEN 'open' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,
    r.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000));
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.admin_delivery_reports(INTEGER) TO authenticated;

-- ── RPC admin : changer le statut d'un signalement ───────────────────────────
CREATE OR REPLACE FUNCTION public.admin_resolve_delivery_report(
  p_report_id UUID,
  p_status    TEXT,
  p_note      TEXT DEFAULT NULL
) RETURNS TABLE(ok BOOLEAN, reason TEXT) AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    ok := false; reason := 'forbidden'; RETURN NEXT; RETURN;
  END IF;
  IF p_status NOT IN ('open', 'reviewing', 'resolved', 'dismissed') THEN
    ok := false; reason := 'bad_status'; RETURN NEXT; RETURN;
  END IF;

  UPDATE public.delivery_reports
  SET status = p_status,
      admin_note = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), admin_note),
      resolved_at = CASE WHEN p_status IN ('resolved', 'dismissed') THEN now() ELSE NULL END
  WHERE id = p_report_id;

  IF NOT FOUND THEN
    ok := false; reason := 'not_found'; RETURN NEXT; RETURN;
  END IF;
  ok := true; reason := NULL; RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.admin_resolve_delivery_report(UUID, TEXT, TEXT) TO authenticated;
