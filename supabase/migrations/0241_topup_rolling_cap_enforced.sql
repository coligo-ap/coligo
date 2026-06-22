-- =============================================================================
-- 0241 — Plafond de recharge glissant RÉELLEMENT appliqué (anti-concurrence)
-- =============================================================================
-- FAILLE (audit 2026-06-22, finding A-F9, MAJEUR) :
--   Le plafond glissant 30 j (`max_topup_da_per_30d`) n'était vérifié QUE dans
--   la Server Action `createTopup` AVANT de créer le checkout Chargily, en
--   lisant `customer_topup_credited_last_30d`. Le CRÉDIT réel est posé bien plus
--   tard par le webhook, qui ne re-vérifiait RIEN. Un client peut lancer N
--   checkouts en parallèle : chacun lit le même `credited_30d` (aucun n'est
--   encore crédité), tous passent, tous sont payés, tous crédités → dépassement
--   du plafond (contournement AML).
--
-- CORRECTIF :
--   Sérialiser la création de checkout via une RÉSERVATION de quota atomique.
--   `reserve_topup_quota` prend un verrou advisory par client, compte
--   credited_30d + réservations PENDING non expirées, et n'accorde la
--   réservation que si cap non dépassé. Deux checkouts concurrents se voient
--   donc mutuellement (le 2ᵉ attend le verrou puis lit la réservation du 1ᵉ).
--   Le webhook consomme la réservation au crédit ; une réservation abandonnée
--   expire (TTL 1 h) et libère le quota. Table inaccessible au client (RLS
--   deny-all ; seuls les RPC DEFINER / service_role y touchent).
-- =============================================================================

-- 1) Aligner le plafond par défaut sur la valeur produit (20 000 DA). On ne
--    touche QUE la ligne encore au défaut historique 50 000 (jamais customisée).
ALTER TABLE public.platform_settings
  ALTER COLUMN max_topup_da_per_30d SET DEFAULT 20000;
UPDATE public.platform_settings
  SET max_topup_da_per_30d = 20000
  WHERE id = true AND max_topup_da_per_30d = 50000;

-- 2) Table des réservations de quota (append + maj de statut par DEFINER).
CREATE TABLE IF NOT EXISTS public.topup_reservations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  amount_da    INTEGER NOT NULL CHECK (amount_da > 0),
  checkout_id  TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'consumed', 'released', 'expired')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_topup_resv_active
  ON public.topup_reservations (customer_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_topup_resv_checkout
  ON public.topup_reservations (checkout_id);

ALTER TABLE public.topup_reservations ENABLE ROW LEVEL SECURITY;
-- Aucune policy → deny-all pour anon/authenticated. service_role + DEFINER
-- (current_user='postgres') bypassent. Le client ne lit/écrit JAMAIS en direct.

-- 3) reserve_topup_quota — accorde (ou refuse) une réservation, atomiquement.
CREATE OR REPLACE FUNCTION public.reserve_topup_quota(p_amount_da INTEGER)
RETURNS TABLE(ok BOOLEAN, reason TEXT, reservation_id UUID, remaining INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cust      UUID;
  v_cap       INTEGER;
  v_credited  INTEGER;
  v_reserved  INTEGER;
  v_id        UUID;
BEGIN
  SELECT id INTO v_cust FROM public.customers WHERE user_id = auth.uid();
  IF v_cust IS NULL THEN
    ok := false; reason := 'no_customer'; reservation_id := NULL; remaining := 0;
    RETURN NEXT; RETURN;
  END IF;
  IF p_amount_da IS NULL OR p_amount_da <= 0 THEN
    ok := false; reason := 'bad_amount'; reservation_id := NULL; remaining := 0;
    RETURN NEXT; RETURN;
  END IF;

  -- Sérialise toutes les réservations concurrentes du MÊME client.
  PERFORM pg_advisory_xact_lock(hashtext('topup_quota:' || v_cust::text));

  SELECT COALESCE(max_topup_da_per_30d, 20000) INTO v_cap
    FROM public.platform_settings WHERE id = true;
  v_cap := COALESCE(v_cap, 20000);

  v_credited := public.customer_topup_credited_last_30d(v_cust);
  SELECT COALESCE(SUM(amount_da), 0) INTO v_reserved
    FROM public.topup_reservations
    WHERE customer_id = v_cust AND status = 'pending' AND expires_at > now();

  IF v_credited + v_reserved + p_amount_da > v_cap THEN
    ok := false; reason := 'limit_reached'; reservation_id := NULL;
    remaining := GREATEST(0, v_cap - v_credited - v_reserved);
    RETURN NEXT; RETURN;
  END IF;

  INSERT INTO public.topup_reservations (customer_id, amount_da, expires_at)
    VALUES (v_cust, p_amount_da, now() + INTERVAL '1 hour')
    RETURNING id INTO v_id;

  ok := true; reason := NULL; reservation_id := v_id;
  remaining := GREATEST(0, v_cap - v_credited - v_reserved - p_amount_da);
  RETURN NEXT;
END;
$$;

-- 4) release / consume — gestion du cycle de vie (identifiée par reservation_id,
--    porté dans la metadata Chargily → relue par le webhook).
CREATE OR REPLACE FUNCTION public.release_topup_reservation(p_reservation_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.topup_reservations r
    SET status = 'released'
    WHERE r.id = p_reservation_id
      AND r.status = 'pending'
      AND r.customer_id = (SELECT id FROM public.customers WHERE user_id = auth.uid());
END;
$$;

-- Appelée par le webhook (service_role) au crédit confirmé : marque la
-- réservation consommée pour qu'elle ne double-compte plus dans le quota.
CREATE OR REPLACE FUNCTION public.consume_topup_reservation(
  p_reservation_id UUID, p_checkout_id TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.topup_reservations
    SET status = 'consumed', checkout_id = COALESCE(p_checkout_id, checkout_id)
    WHERE id = p_reservation_id AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_topup_quota(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_topup_reservation(UUID) TO authenticated;
-- consume_topup_reservation : NON accordée à authenticated (webhook/service_role
-- uniquement → bypass RLS, current_user=service_role).
