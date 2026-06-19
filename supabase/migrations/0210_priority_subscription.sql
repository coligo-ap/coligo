-- =============================================================================
-- 0210 — Abonnement PRIORITAIRE (ch.7) : commun livreur + chauffeur
-- =============================================================================
-- Un seul abo optionnel, identique livreur (drivers) et chauffeur (chauffeurs).
-- Il achète la VISIBILITÉ, jamais une réduction de commission (aucune colonne de
-- taux ici). Deux avantages livrés : priorité dispatch + badge. (« Zones/heures à
-- forte demande » différé tant qu'on n'a pas de données de demande réelles.)
--
-- Garde-fou crucial : la priorité ACCÉLÈRE mais ne BLOQUE jamais. Pendant les
-- premières `dispatch_priority_delay_sec` (config, 8–12 s) après création de la
-- course/commande, l'offre est réservée aux Prioritaires ; passé le délai, elle
-- s'ouvre à TOUS. Fenêtre déterministe (now − created_at), sans timer ni cron.
--
-- Prix lus du registre (mig 0209) : sub_priority_first_month_da au 1er abo,
-- sub_priority_monthly_da ensuite. Paiement : wallet (float, instantané) /
-- ccp / card (pending → priority_sub_mark_paid, webhook/admin = source de vérité).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.priority_subscriptions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type   TEXT NOT NULL CHECK (subject_type IN ('driver','chauffeur')),
  subject_id     UUID NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','active','expired','cancelled')),
  period_start   TIMESTAMPTZ,
  period_end     TIMESTAMPTZ,
  amount_da      INTEGER NOT NULL,
  is_first_month BOOLEAN NOT NULL DEFAULT false,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('wallet','ccp','card')),
  payment_ref    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un seul abo actif/pending par acteur.
CREATE UNIQUE INDEX IF NOT EXISTS priority_sub_one_open
  ON public.priority_subscriptions (subject_type, subject_id)
  WHERE status IN ('pending','active');

CREATE INDEX IF NOT EXISTS priority_sub_active_lookup
  ON public.priority_subscriptions (subject_type, subject_id, status, period_end);

ALTER TABLE public.priority_subscriptions ENABLE ROW LEVEL SECURITY;

-- Lecture : son propre abo, ou super-admin. Écriture : via RPC SECURITY DEFINER.
DROP POLICY IF EXISTS priority_sub_owner_read ON public.priority_subscriptions;
CREATE POLICY priority_sub_owner_read ON public.priority_subscriptions
  FOR SELECT TO authenticated
  USING (
    (subject_type = 'chauffeur' AND subject_id IN (SELECT id FROM public.chauffeurs WHERE user_id = auth.uid()))
    OR (subject_type = 'driver' AND subject_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid()))
    OR public.is_super_admin()
  );

-- ----------------------------------------------------------------------------
-- 2. Résolveur de priorité + fenêtre de garde-fou
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_priority(p_subject_type text, p_subject_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.priority_subscriptions
    WHERE subject_type = p_subject_type AND subject_id = p_subject_id
      AND status = 'active' AND period_end >= now()
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_priority(text, uuid) TO authenticated;

-- TRUE = l'offre est encore réservée aux Prioritaires pour cet acteur non-abonné.
CREATE OR REPLACE FUNCTION public.priority_window_blocks(
  p_subject_type text, p_subject_id uuid, p_created_at timestamptz)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT (now() - p_created_at)
           < make_interval(secs => (SELECT GREATEST(0, dispatch_priority_delay_sec)
                                    FROM public.platform_settings WHERE id = true))
     AND NOT public.is_priority(p_subject_type, p_subject_id);
$$;
GRANT EXECUTE ON FUNCTION public.priority_window_blocks(text, uuid, timestamptz) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. RPC : souscrire (résout l'acteur depuis la session)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.priority_subscribe(p_payment_method text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_type     TEXT;
  v_subject  UUID;
  v_amount   INTEGER;
  v_first    BOOLEAN;
  v_wallet   UUID;
  v_sub      UUID;
  v_monthly  INTEGER;
  v_promo    INTEGER;
BEGIN
  IF p_payment_method NOT IN ('wallet','ccp','card') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_method');
  END IF;

  -- Résolution de l'acteur (livreur ou chauffeur) depuis auth.uid().
  SELECT id INTO v_subject FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_subject IS NOT NULL THEN v_type := 'chauffeur';
  ELSE
    SELECT id INTO v_subject FROM public.drivers WHERE user_id = auth.uid();
    IF v_subject IS NOT NULL THEN v_type := 'driver'; END IF;
  END IF;
  IF v_subject IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_partner'); END IF;

  -- Déjà un abo actif/pending ?
  IF EXISTS (SELECT 1 FROM public.priority_subscriptions
             WHERE subject_type = v_type AND subject_id = v_subject
               AND status IN ('pending','active')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_subscribed');
  END IF;

  SELECT sub_priority_monthly_da, sub_priority_first_month_da
    INTO v_monthly, v_promo FROM public.platform_settings WHERE id = true;

  -- 1er mois promo si l'acteur n'a JAMAIS eu d'abo.
  v_first  := NOT EXISTS (SELECT 1 FROM public.priority_subscriptions
                          WHERE subject_type = v_type AND subject_id = v_subject);
  v_amount := CASE WHEN v_first THEN v_promo ELSE v_monthly END;

  IF p_payment_method = 'wallet' THEN
    -- Paiement immédiat depuis le float opérateur.
    SELECT id INTO v_wallet FROM public.operator_wallets
      WHERE owner_type = v_type AND owner_id = v_subject;
    IF v_wallet IS NULL THEN
      PERFORM public.ensure_operator_wallet(v_type, v_subject, now());
      SELECT id INTO v_wallet FROM public.operator_wallets
        WHERE owner_type = v_type AND owner_id = v_subject;
    END IF;
    IF public.operator_effective_balance(v_wallet) < v_amount THEN
      RETURN jsonb_build_object('ok', false, 'error', 'insufficient_wallet');
    END IF;

    INSERT INTO public.priority_subscriptions
      (subject_type, subject_id, status, period_start, period_end, amount_da, is_first_month, payment_method)
    VALUES (v_type, v_subject, 'active', now(), now() + interval '30 days', v_amount, v_first, 'wallet')
    RETURNING id INTO v_sub;

    INSERT INTO public.operator_wallet_entries (wallet_id, type, amount_da, note, client_operation_id)
    VALUES (v_wallet, 'fee_debit', -v_amount, 'Abonnement Prioritaire', 'prio_sub:' || v_sub::text);

    RETURN jsonb_build_object('ok', true, 'status', 'active', 'sub_id', v_sub,
                              'amount_da', v_amount, 'is_first_month', v_first);
  ELSE
    -- CCP / carte : créé en attente, activé par priority_sub_mark_paid (webhook/admin).
    INSERT INTO public.priority_subscriptions
      (subject_type, subject_id, status, amount_da, is_first_month, payment_method)
    VALUES (v_type, v_subject, 'pending', v_amount, v_first, p_payment_method)
    RETURNING id INTO v_sub;

    RETURN jsonb_build_object('ok', true, 'status', 'pending', 'sub_id', v_sub,
                              'amount_da', v_amount, 'is_first_month', v_first);
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.priority_subscribe(text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. RPC : valider un paiement (webhook/admin) — refuse si pas pending.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.priority_sub_mark_paid(p_sub_id uuid, p_ref text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_n INTEGER;
BEGIN
  UPDATE public.priority_subscriptions
     SET status = 'active', period_start = now(),
         period_end = now() + interval '30 days',
         payment_ref = COALESCE(p_ref, payment_ref), updated_at = now()
   WHERE id = p_sub_id AND status = 'pending';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'not_pending'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.priority_sub_mark_paid(uuid, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. RPC : annuler (pending ou active) — pas de remboursement automatique.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.priority_sub_cancel()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_type TEXT; v_subject UUID; v_n INTEGER;
BEGIN
  SELECT id INTO v_subject FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_subject IS NOT NULL THEN v_type := 'chauffeur';
  ELSE
    SELECT id INTO v_subject FROM public.drivers WHERE user_id = auth.uid();
    IF v_subject IS NOT NULL THEN v_type := 'driver'; END IF;
  END IF;
  IF v_subject IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_partner'); END IF;

  UPDATE public.priority_subscriptions
     SET status = 'cancelled', updated_at = now()
   WHERE subject_type = v_type AND subject_id = v_subject
     AND status IN ('pending','active');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_n > 0);
END;
$$;
GRANT EXECUTE ON FUNCTION public.priority_sub_cancel() TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. RPC : état de l'abo de l'acteur connecté (pour l'UI).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_priority_state()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_type TEXT; v_subject UUID; v_sub public.priority_subscriptions%ROWTYPE;
  v_monthly INTEGER; v_promo INTEGER; v_ever BOOLEAN;
BEGIN
  SELECT id INTO v_subject FROM public.chauffeurs WHERE user_id = auth.uid();
  IF v_subject IS NOT NULL THEN v_type := 'chauffeur';
  ELSE
    SELECT id INTO v_subject FROM public.drivers WHERE user_id = auth.uid();
    IF v_subject IS NOT NULL THEN v_type := 'driver'; END IF;
  END IF;
  IF v_subject IS NULL THEN RETURN jsonb_build_object('partner', false); END IF;

  SELECT sub_priority_monthly_da, sub_priority_first_month_da
    INTO v_monthly, v_promo FROM public.platform_settings WHERE id = true;

  SELECT * INTO v_sub FROM public.priority_subscriptions
   WHERE subject_type = v_type AND subject_id = v_subject
     AND status IN ('pending','active')
   ORDER BY created_at DESC LIMIT 1;

  v_ever := EXISTS (SELECT 1 FROM public.priority_subscriptions
                    WHERE subject_type = v_type AND subject_id = v_subject);

  RETURN jsonb_build_object(
    'partner', true,
    'subject_type', v_type,
    'is_priority', public.is_priority(v_type, v_subject),
    'status', COALESCE(v_sub.status, 'none'),
    'period_end', v_sub.period_end,
    'price_da', CASE WHEN v_ever THEN v_monthly ELSE v_promo END,
    'monthly_da', v_monthly,
    'first_month_da', v_promo,
    'eligible_first_month', NOT v_ever
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.my_priority_state() TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. Garde priorité — OFFRE CHAUFFEUR (Drive). Reprend 0149 + ajoute le garde.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chauffeur_offer_ride(p_ride_id uuid, p_price integer)
RETURNS TABLE(ok boolean, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  s public.platform_settings%ROWTYPE;
  v_ch public.chauffeurs%ROWTYPE; v_ride public.rides%ROWTYPE; v_floor INTEGER;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT * INTO v_ch FROM public.chauffeurs
    WHERE user_id = auth.uid() AND is_verified AND NOT is_frozen AND NOT is_blocked;
  IF v_ch.id IS NULL THEN ok:=false; reason:='not_a_verified_chauffeur'; RETURN NEXT; RETURN; END IF;
  IF p_price IS NULL OR p_price <= 0 THEN ok:=false; reason:='bad_price'; RETURN NEXT; RETURN; END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN ok:=false; reason:='ride_not_found'; RETURN NEXT; RETURN; END IF;
  IF v_ride.status <> 'searching'
     OR (v_ride.expires_at IS NOT NULL AND v_ride.expires_at < now())
     OR (v_ride.payment_method = 'card' AND v_ride.online_paid_at IS NULL) THEN
    ok:=false; reason:='ride_not_open'; RETURN NEXT; RETURN;
  END IF;

  -- PRIORITÉ DISPATCH (abo) : pendant la fenêtre, réservé aux Prioritaires.
  -- Passé le délai, ouvert à tous → personne ne reste sans course.
  IF public.priority_window_blocks('chauffeur', v_ch.id, v_ride.created_at) THEN
    ok:=false; reason:='priority_window'; RETURN NEXT; RETURN;
  END IF;

  -- Carte prépayée : montant déjà encaissé → prix fixe, pas de contre-offre.
  IF v_ride.payment_method = 'card'
     AND p_price <> v_ride.proposed_price_da + v_ride.boost_amount_da THEN
    ok:=false; reason:='prepaid_fixed_price'; RETURN NEXT; RETURN;
  END IF;

  v_floor := public.drive_price_floor(v_ride.distance_km, v_ride.gamme);
  IF p_price < v_floor THEN ok:=false; reason:='below_floor'; RETURN NEXT; RETURN; END IF;

  IF NOT (CASE v_ch.gamme
            WHEN 'confort' THEN v_ride.gamme IN ('classic','confort')
            WHEN 'classic' THEN v_ride.gamme = 'classic'
            ELSE v_ride.gamme = 'moto'
          END) THEN
    ok:=false; reason:='gamme_mismatch'; RETURN NEXT; RETURN;
  END IF;

  IF v_ride.female_only AND NOT v_ch.is_female_verified AND public.drive_female_online() THEN
    ok:=false; reason:='female_only'; RETURN NEXT; RETURN;
  END IF;

  INSERT INTO public.ride_offers (ride_id, chauffeur_id, price_da, status, expires_at)
  VALUES (p_ride_id, v_ch.id, p_price, 'offered', now() + make_interval(mins => s.drive_offer_ttl_min))
  ON CONFLICT (ride_id, chauffeur_id) DO UPDATE
    SET price_da = EXCLUDED.price_da, status = 'offered', created_at = now(),
        expires_at = EXCLUDED.expires_at;
  ok:=true; reason:=NULL; RETURN NEXT;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 8. Garde priorité — ASSIGNATION LIVREUR (express seulement). Reprend 0186.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_gate_driver_assign()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.delivery_driver_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.delivery_driver_id IS DISTINCT FROM OLD.delivery_driver_id) THEN
    -- Float (0186).
    IF NOT public.operator_can_operate_owner('driver', NEW.delivery_driver_id) THEN
      RAISE EXCEPTION 'Solde insuffisant : rechargez votre portefeuille pour accepter des livraisons.'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Priorité dispatch (express uniquement ; la tournée est la flotte du
    -- commerçant, hors dispatch Coligo). Fenêtre déterministe depuis created_at.
    IF NEW.delivery_mode = 'express'
       AND public.priority_window_blocks('driver', NEW.delivery_driver_id, NEW.created_at) THEN
      RAISE EXCEPTION 'Course réservée aux livreurs Prioritaires quelques secondes — réessayez.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
