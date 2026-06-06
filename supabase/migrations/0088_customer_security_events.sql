-- =============================================================================
-- Coligo v3 - Migration 0088 : Journal d'actions sensibles (traçabilité)
-- =============================================================================
-- « Actioning enregistré » : on trace les actions sensibles NON-monétaires
-- (les mouvements d'argent sont déjà tracés par les ledgers + coligo_pay_*).
--   - pin_set / pin_changed   : création / changement du PIN Coligo Pay
--   - email_changed           : email confirmé/changé
--   - phone_changed           : téléphone modifié
--
-- ⚠️ Robustesse identité : le wallet (solde, PIN, pay_handle, paiements,
-- transferts, cashback) est TOUJOURS indexé par customers.id (UUID immuable),
-- jamais par email/téléphone. Changer l'email ou le téléphone ne fait donc
-- RIEN perdre — ces événements sont consignés ici pour audit, pas pour clé.
--
-- Append-only, lecture seule côté client (ses propres événements). L'admin lit
-- tout via la fonction DEFINER gardée par is_super_admin().
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.customer_security_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  event       TEXT NOT NULL CHECK (event IN (
                'pin_set', 'pin_changed', 'email_changed', 'phone_changed'
              )),
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cse_customer
  ON public.customer_security_events(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cse_created
  ON public.customer_security_events(created_at DESC);

ALTER TABLE public.customer_security_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cse_select_own" ON public.customer_security_events;
CREATE POLICY "cse_select_own" ON public.customer_security_events
  FOR SELECT USING (
    customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );
-- Pas d'INSERT direct : passe par la fonction DEFINER ci-dessous.

-- ============================================================================
-- Logger un événement de sécurité pour le client courant (best-effort).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.coligo_log_security_event(
  p_event TEXT,
  p_detail JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer UUID;
BEGIN
  SELECT id INTO v_customer FROM public.customers WHERE user_id = auth.uid();
  IF v_customer IS NULL THEN
    RETURN; -- pas un client : on n'enregistre rien (no-op silencieux)
  END IF;
  IF p_event NOT IN ('pin_set', 'pin_changed', 'email_changed', 'phone_changed')
  THEN
    RETURN;
  END IF;
  INSERT INTO public.customer_security_events (customer_id, event, detail)
  VALUES (v_customer, p_event, p_detail);
END;
$$;

REVOKE ALL ON FUNCTION public.coligo_log_security_event(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.coligo_log_security_event(TEXT, JSONB)
  TO authenticated;

-- ============================================================================
-- Lecture admin du journal d'actions sensibles (gardée is_super_admin).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_security_events(p_limit INTEGER DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v JSONB;
  v_lim INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Accès refusé.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.created_at DESC), '[]'::jsonb)
  INTO v
  FROM (
    SELECT e.created_at, e.event,
           (SELECT full_name FROM public.customers WHERE id = e.customer_id) AS who
    FROM public.customer_security_events e
    ORDER BY e.created_at DESC
    LIMIT v_lim
  ) s;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_security_events(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_security_events(INTEGER) TO authenticated;
