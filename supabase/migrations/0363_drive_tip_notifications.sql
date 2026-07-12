-- =============================================================================
-- 0363 — Refonte parcours Drive : POURBOIRE + CENTRE DE NOTIFICATIONS unifié
--        + accusés de lecture du chat livraison
-- =============================================================================
-- 1) POURBOIRE (tip) — inexistant jusqu'ici (ni colonne, ni RPC, ni UI).
--    • rides.tip_da : montant du pourboire (une seule fois, après completion).
--    • Payé via Coligo Pay UNIQUEMENT (solde vérifié serveur, débit wallet
--      client → crédit ride_ledger chauffeur type 'chauffeur_tip').
--    • Le pourboire s'ajoute aux gains nets du chauffeur (drive_my_finances).
-- 2) NOTIFICATIONS user_notifications — centre persistant pour CLIENT et
--    CHAUFFEUR (le livreur garde driver_notifications, mig 0352). Realtime
--    activé → badge cloche instantané sans rechargement.
-- 3) CHAT LIVRAISON — delivered_at + RPC mark_order_messages_read (même patron
--    que le chat Drive, mig 0175) : « Envoyé / Reçu / Lu » aussi pour la
--    messagerie client ↔ livreur.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. POURBOIRE
-- ---------------------------------------------------------------------------
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS tip_da INTEGER NOT NULL DEFAULT 0 CHECK (tip_da >= 0);

-- Nouveau type de ledger : le pourboire est distinct du payout (les agrégats
-- existants ne filtrent que 'chauffeur_owes_platform' → aucun impact).
ALTER TYPE public.ride_ledger_type ADD VALUE IF NOT EXISTS 'chauffeur_tip';

-- Pourboire Coligo Pay : serveur autoritaire, idempotent (tip_da = 0 requis),
-- borné, fenêtre 24 h après la fin de course.
CREATE OR REPLACE FUNCTION public.drive_tip_ride(
  p_ride_id   UUID,
  p_amount_da INTEGER
) RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer UUID; v_ride public.rides%ROWTYPE; v_bal INTEGER; v_tip INTEGER;
BEGIN
  SELECT cu.id INTO v_customer FROM public.customers cu WHERE cu.user_id = auth.uid();
  IF v_customer IS NULL THEN ok:=false; reason:='not_a_customer'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL OR v_ride.customer_id <> v_customer THEN
    ok:=false; reason:='not_your_ride'; RETURN NEXT; RETURN;
  END IF;
  IF v_ride.status <> 'completed' THEN ok:=false; reason:='not_completed'; RETURN NEXT; RETURN; END IF;
  IF v_ride.tip_da > 0 THEN ok:=false; reason:='already_tipped'; RETURN NEXT; RETURN; END IF;
  IF v_ride.chauffeur_id IS NULL THEN ok:=false; reason:='no_chauffeur'; RETURN NEXT; RETURN; END IF;
  IF v_ride.completed_at IS NULL OR v_ride.completed_at < now() - interval '24 hours' THEN
    ok:=false; reason:='too_late'; RETURN NEXT; RETURN;
  END IF;

  -- Montant borné et arrondi au pas de 10 DA (20 → 2000).
  v_tip := (round(COALESCE(p_amount_da, 0)::NUMERIC / 10) * 10)::INTEGER;
  IF v_tip < 20 OR v_tip > 2000 THEN ok:=false; reason:='bad_amount'; RETURN NEXT; RETURN; END IF;

  SELECT public.customer_topup_balance(v_customer) INTO v_bal;
  IF COALESCE(v_bal, 0) < v_tip THEN ok:=false; reason:='insufficient_balance'; RETURN NEXT; RETURN; END IF;

  UPDATE public.rides SET tip_da = v_tip WHERE id = p_ride_id;

  INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
  VALUES (v_customer, NULL, 'topup_spent', 'topup', -v_tip, 'Pourboire course Drive');

  INSERT INTO public.ride_ledger (chauffeur_id, ride_id, type, amount_da, note)
  VALUES (v_ride.chauffeur_id, p_ride_id, 'chauffeur_tip', v_tip, 'Pourboire client (Coligo Pay)')
  ON CONFLICT (ride_id, type) DO NOTHING;

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (p_ride_id, 'completed', 'completed', 'Pourboire client · ' || v_tip || ' DA (Coligo Pay)');

  ok:=true; reason:=NULL; RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.drive_tip_ride(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.drive_tip_ride(UUID, INTEGER) TO authenticated;

-- drive_my_finances v3 : les POURBOIRES s'ajoutent aux gains nets (jour + mois).
-- Signature INCHANGÉE (aucune retouche du caller TS).
CREATE OR REPLACE FUNCTION public.drive_my_finances()
RETURNS TABLE(
  today_net_da BIGINT, today_rides BIGINT, today_online_minutes INTEGER,
  month_gross_da BIGINT, month_rides BIGINT, month_commission_da BIGINT,
  month_net_da BIGINT, month_sub_fee_da INTEGER,
  due_unsettled_da BIGINT,
  plan TEXT, plan_rate NUMERIC, plan_period_end TIMESTAMPTZ,
  rating NUMERIC, rides_total BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ch UUID; v_tz_today DATE; v_month_start TIMESTAMPTZ; rp RECORD;
BEGIN
  SELECT id INTO v_ch FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_ch IS NULL THEN RETURN; END IF;
  v_tz_today := (now() AT TIME ZONE 'Africa/Algiers')::DATE;
  v_month_start := date_trunc('month', now() AT TIME ZONE 'Africa/Algiers') AT TIME ZONE 'Africa/Algiers';
  SELECT * INTO rp FROM public.resolve_drive_plan(v_ch);

  SELECT
    COALESCE(sum(r.chauffeur_net_da + r.tip_da) FILTER (WHERE (r.completed_at AT TIME ZONE 'Africa/Algiers')::DATE = v_tz_today), 0),
    COALESCE(count(*) FILTER (WHERE (r.completed_at AT TIME ZONE 'Africa/Algiers')::DATE = v_tz_today), 0),
    COALESCE(sum(r.agreed_price_da) FILTER (WHERE r.completed_at >= v_month_start), 0),
    COALESCE(count(*) FILTER (WHERE r.completed_at >= v_month_start), 0),
    COALESCE(sum(r.commission_da) FILTER (WHERE r.completed_at >= v_month_start), 0),
    COALESCE(sum(r.chauffeur_net_da + r.tip_da) FILTER (WHERE r.completed_at >= v_month_start), 0)
  INTO today_net_da, today_rides, month_gross_da, month_rides, month_commission_da, month_net_da
  FROM public.rides r
  WHERE r.chauffeur_id = v_ch AND r.status = 'completed';

  SELECT COALESCE(p.online_minutes, 0) INTO today_online_minutes
  FROM public.chauffeur_presence p
  WHERE p.chauffeur_id = v_ch AND p.online_minutes_date = v_tz_today;
  today_online_minutes := COALESCE(today_online_minutes, 0);

  SELECT COALESCE(sum(l.amount_da), 0) INTO due_unsettled_da
  FROM public.ride_ledger l
  WHERE l.chauffeur_id = v_ch AND l.type = 'chauffeur_owes_platform' AND l.settled_at IS NULL;

  SELECT round(avg(r2.chauffeur_rating)::NUMERIC, 1),
         count(*) FILTER (WHERE r2.status = 'completed')
    INTO rating, rides_total
  FROM public.rides r2 WHERE r2.chauffeur_id = v_ch;

  plan := rp.plan; plan_rate := rp.rate; plan_period_end := rp.period_end;
  month_sub_fee_da := CASE WHEN rp.plan = 'free' THEN 0 ELSE rp.fee_da END;
  RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_my_finances() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. CENTRE DE NOTIFICATIONS unifié (client + chauffeur)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,                          -- auth.users.id (cible)
  audience   TEXT NOT NULL CHECK (audience IN ('customer','chauffeur','driver','merchant','agent')),
  kind       TEXT NOT NULL DEFAULT 'info',           -- ride_accepted / ride_arrived / tip / order_status…
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  route      TEXT,                                   -- deep-link in-app (ex. /drive)
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user
  ON public.user_notifications (user_id, audience, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_notifications_unread
  ON public.user_notifications (user_id, audience) WHERE read_at IS NULL;

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

-- Lecture : ses propres notifications uniquement. Écriture : service_role seul
-- (aucune policy INSERT/UPDATE/DELETE) ; le marquage lu passe par le RPC dédié.
DROP POLICY IF EXISTS user_notifications_select ON public.user_notifications;
CREATE POLICY user_notifications_select ON public.user_notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.mark_user_notifications_read(
  p_audience TEXT DEFAULT NULL,
  p_ids UUID[] DEFAULT NULL
) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  UPDATE public.user_notifications
     SET read_at = now()
   WHERE user_id = auth.uid()
     AND read_at IS NULL
     AND (p_audience IS NULL OR audience = p_audience)
     AND (p_ids IS NULL OR id = ANY(p_ids));
$$;
REVOKE ALL ON FUNCTION public.mark_user_notifications_read(TEXT, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_user_notifications_read(TEXT, UUID[]) TO authenticated;

-- Realtime : INSERT poussé instantanément (badge cloche sans rechargement).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'user_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. CHAT LIVRAISON — accusés « Envoyé / Reçu / Lu » (patron mig 0175)
-- ---------------------------------------------------------------------------
ALTER TABLE public.order_messages
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.mark_order_messages_read(
  p_order_id UUID,
  p_read BOOLEAN DEFAULT TRUE
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_customer BOOLEAN;
  v_is_courier  BOOLEAN;
  v_other TEXT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.customers cu ON cu.id = o.customer_id
    WHERE o.id = p_order_id AND cu.user_id = auth.uid()
  ) INTO v_is_customer;

  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.drivers d ON d.id = o.driver_id
    WHERE o.id = p_order_id AND d.user_id = auth.uid()
  ) INTO v_is_courier;

  IF NOT v_is_customer AND NOT v_is_courier THEN RETURN; END IF;

  v_other := CASE WHEN v_is_customer THEN 'courier' ELSE 'customer' END;

  UPDATE public.order_messages
     SET delivered_at = COALESCE(delivered_at, now()),
         read_at = CASE WHEN p_read THEN COALESCE(read_at, now()) ELSE read_at END
   WHERE order_id = p_order_id
     AND sender_role = v_other
     AND (delivered_at IS NULL OR (p_read AND read_at IS NULL));
END;
$$;
REVOKE ALL ON FUNCTION public.mark_order_messages_read(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_order_messages_read(UUID, BOOLEAN) TO authenticated;
