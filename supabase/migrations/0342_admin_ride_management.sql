-- =============================================================================
-- 0342 — Drive : courses BLOQUÉES → pouvoirs admin + alertes (parité livreur 0341).
-- =============================================================================
-- Une course Drive peut rester coincée sans qu'aucun outil ne permette de la
-- trancher : chauffeur accepté qui ne démarre jamais, course démarrée jamais
-- terminée (end_code perdu, litige), recherche payée par CARTE expirée (0250
-- refuse volontairement de l'auto-annuler : remboursement requis). Le support
-- n'avait AUCUNE action côté rides. On ajoute :
--
--  1. admin_cancel_ride    — annule à toute étape non terminale, rembourse le
--     séquestre (carte/Coligo Pay) via drive_refund_escrow, expire les offres,
--     trace ride_events. cancelled_by='admin'.
--  2. admin_complete_ride  — clôture COMME TERMINÉE une course attribuée
--     (chauffeur payé, commission/cashback par plan, séquestre libéré, cash dû
--     tracé). ⚠️ Cœur financier REPRIS VERBATIM de complete_ride (0304) — toute
--     évolution de complete_ride doit être répercutée ici (même règle que les
--     redéfinitions d'alertes).
--  3. Alertes domaine DRIVE (corps 0290 + 2 règles) :
--       • rides_stuck_active        — courses attribuées sans progression
--         depuis platform_settings.drive_stuck_ride_alert_min (défaut 120 min,
--         0 = désactivé ; critical à 2×). Jamais auto-annulées (argent/litige :
--         un humain tranche).
--       • rides_searching_card_expired — recherches payées CARTE expirées
--         (la seule classe que 0250 laisse volontairement ouverte) → l'admin
--         annule = remboursement Coligo Pay immédiat.
--
-- Gardes : admin_can('drive') (pattern 0303), GRANT authenticated (session
-- admin), REVOKE anon. Appels via la session (pas service_role) → audit JS.
-- =============================================================================

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS drive_stuck_ride_alert_min INTEGER NOT NULL DEFAULT 120;

-- ── 1. Annulation admin (remboursement intégral du séquestre) ─────────────
CREATE OR REPLACE FUNCTION public.admin_cancel_ride(
  p_ride_id UUID,
  p_reason  TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ride   public.rides%ROWTYPE;
  v_refund INTEGER;
  v_reason TEXT := COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Annulation plateforme');
BEGIN
  IF NOT public.admin_can('drive') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ride_not_found');
  END IF;
  IF v_ride.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_terminal');
  END IF;

  UPDATE public.rides
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'admin'
   WHERE id = p_ride_id;
  UPDATE public.ride_offers
     SET status = 'expired'
   WHERE ride_id = p_ride_id AND status = 'offered';

  -- Séquestre (réservation Coligo Pay / carte payée) → recrédit immédiat.
  v_refund := public.drive_refund_escrow(p_ride_id,
    CASE WHEN v_ride.payment_method = 'card'
         THEN 'Remboursement course Drive annulée par le support (carte → Coligo Pay)'
         ELSE 'Remboursement course Drive annulée par le support (réservation Coligo Pay)' END);

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (p_ride_id, v_ride.status::text, 'cancelled',
          'admin_cancel: ' || v_reason
          || CASE WHEN v_refund > 0
                  THEN ' · ' || v_refund || ' DA remboursés sur Coligo Pay'
                  ELSE '' END);

  RETURN jsonb_build_object(
    'ok', true,
    'from_status', v_ride.status,
    'refunded_da', COALESCE(v_refund, 0),
    'customer_id', v_ride.customer_id,
    'chauffeur_id', v_ride.chauffeur_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_cancel_ride(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_ride(UUID, TEXT) TO authenticated;

-- ── 2. Clôture admin « comme terminée » (cœur financier 0304 verbatim) ────
CREATE OR REPLACE FUNCTION public.admin_complete_ride(
  p_ride_id UUID,
  p_note    TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE;
  v_ch UUID; v_ride public.rides%ROWTYPE;
  v_rate NUMERIC(5,4); v_cbrate NUMERIC(5,4); v_F INTEGER; v_boost INTEGER; v_base INTEGER;
  v_c INTEGER; v_cb INTEGER; v_net INTEGER;
  v_E INTEGER; v_cash INTEGER; v_cov INTEGER;
BEGIN
  IF NOT public.admin_can('drive') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ride_not_found');
  END IF;
  IF v_ride.status = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already_completed');
  END IF;
  IF v_ride.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cancelled');
  END IF;
  IF v_ride.chauffeur_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_chauffeur');
  END IF;
  v_ch := v_ride.chauffeur_id;

  v_F     := GREATEST(0, COALESCE(v_ride.agreed_price_da, v_ride.proposed_price_da + v_ride.boost_amount_da, 0));
  v_boost := LEAST(GREATEST(0, v_ride.boost_amount_da), v_F);
  v_base  := v_F - v_boost;
  v_rate  := public.resolve_vtc_commission(v_ch);
  v_cbrate := public.drive_plan_cashback_rate(v_ch);
  v_c     := round(v_base * v_rate)::INTEGER;
  v_cb    := LEAST(round(v_F * v_cbrate)::INTEGER, v_c);
  v_net   := v_F - v_c;

  IF v_ride.payment_method = 'card' AND v_ride.escrow_da < v_F THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'escrow_missing');
  END IF;

  v_E    := CASE WHEN v_ride.payment_method = 'cash' THEN 0 ELSE LEAST(GREATEST(v_ride.escrow_da, 0), v_F) END;
  v_cash := v_F - v_E;
  v_cov  := LEAST(v_c, v_E);

  UPDATE public.rides
     SET status='completed', completed_at=now(),
         commission_rate_applied=v_rate, commission_da=v_c,
         chauffeur_net_da=v_net, cashback_da=v_cb, escrow_da=0,
         cash_due_da = v_cash
   WHERE id = p_ride_id;

  INSERT INTO public.ride_ledger (chauffeur_id, ride_id, type, amount_da)
  VALUES (v_ch, p_ride_id, 'chauffeur_payout', v_net)
  ON CONFLICT (ride_id, type) DO NOTHING;
  IF v_cash > 0 THEN
    INSERT INTO public.ride_ledger (chauffeur_id, ride_id, type, amount_da)
    VALUES (v_ch, p_ride_id, 'chauffeur_cash_collected', v_cash)
    ON CONFLICT (ride_id, type) DO NOTHING;
  END IF;
  IF v_c - v_cov > 0 THEN
    INSERT INTO public.ride_ledger (chauffeur_id, ride_id, type, amount_da)
    VALUES (v_ch, p_ride_id, 'chauffeur_owes_platform', v_c - v_cov)
    ON CONFLICT (ride_id, type) DO NOTHING;
  END IF;
  IF v_cov > 0 THEN
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NULL, 'vtc_commission_income', v_cov);
  END IF;
  IF v_cash > 0 AND v_E - v_c > 0 THEN
    INSERT INTO public.ride_ledger (chauffeur_id, ride_id, type, amount_da, note)
    VALUES (v_ch, p_ride_id, 'adjustment', v_E - v_c,
            'Part Coligo Pay à verser au chauffeur (course mixte espèces + séquestre)')
    ON CONFLICT (ride_id, type) DO NOTHING;
  END IF;

  IF v_cb > 0 THEN
    INSERT INTO public.customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
    VALUES (v_ride.customer_id, NULL, 'cashback_earned', 'cashback', v_cb, 'Cashback course Drive');
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NULL, 'cashback_expense', -v_cb);
  END IF;

  INSERT INTO public.ride_events (ride_id, from_status, to_status, note)
  VALUES (p_ride_id, v_ride.status::text, 'completed',
    'admin_complete: clôturée par la plateforme'
    || COALESCE(' — ' || NULLIF(btrim(COALESCE(p_note, '')), ''), '')
    || CASE WHEN v_E > 0 THEN ' · séquestre libéré (' || v_E || ' DA)' ELSE '' END
    || CASE WHEN v_cash > 0 THEN ' · ' || v_cash || ' DA dus en espèces' ELSE '' END);

  RETURN jsonb_build_object(
    'ok', true,
    'from_status', v_ride.status,
    'chauffeur_net_da', v_net,
    'customer_id', v_ride.customer_id,
    'chauffeur_id', v_ch
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_complete_ride(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_complete_ride(UUID, TEXT) TO authenticated;

-- ── 3. Alertes DRIVE (corps 0290 + courses bloquées) ──────────────────────
CREATE OR REPLACE FUNCTION public._admin_alert_rules_drive()
RETURNS TABLE (
  code text, domain text, severity text, prio int,
  count int, since timestamptz, label text, href text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 'chauffeur_pending_validation', 'drive',
         CASE WHEN MIN(ch.submitted_at) < now() - interval '24 hours'
              THEN 'warning' ELSE 'info' END,
         CASE WHEN MIN(ch.submitted_at) < now() - interval '24 hours'
              THEN 2 ELSE 1 END,
         COUNT(*)::int, MIN(ch.submitted_at),
         'Chauffeurs à valider', '/admin/chauffeurs/inscriptions'
    FROM public.chauffeurs ch
   WHERE ch.is_verified = false
     AND ch.is_blocked = false
     AND ch.submitted_at IS NOT NULL
  HAVING COUNT(*) > 0

  UNION ALL
  -- Courses ATTRIBUÉES sans progression depuis > seuil : chauffeur accepté qui
  -- ne démarre pas, course démarrée jamais terminée (end_code perdu, litige).
  -- Jamais auto-annulées (argent en jeu) : le support tranche (/admin/drive).
  SELECT 'rides_stuck_active', 'drive',
         CASE WHEN MIN(COALESCE(r.started_at, r.arrived_at, r.accepted_at, r.created_at))
                   < now() - make_interval(mins => 2 * COALESCE(ps.drive_stuck_ride_alert_min, 120))
              THEN 'critical' ELSE 'warning' END,
         CASE WHEN MIN(COALESCE(r.started_at, r.arrived_at, r.accepted_at, r.created_at))
                   < now() - make_interval(mins => 2 * COALESCE(ps.drive_stuck_ride_alert_min, 120))
              THEN 3 ELSE 2 END,
         COUNT(*)::int,
         MIN(COALESCE(r.started_at, r.arrived_at, r.accepted_at, r.created_at)),
         'Courses Drive bloquées (à trancher)', '/admin/drive'
    FROM public.rides r
   CROSS JOIN public.platform_settings ps
   WHERE ps.id = true
     AND COALESCE(ps.drive_stuck_ride_alert_min, 120) > 0
     AND r.status IN ('accepted', 'arriving', 'arrived', 'in_progress')
     AND COALESCE(r.started_at, r.arrived_at, r.accepted_at, r.created_at)
         < now() - make_interval(mins => COALESCE(ps.drive_stuck_ride_alert_min, 120))
  GROUP BY ps.drive_stuck_ride_alert_min
  HAVING COUNT(*) > 0

  UNION ALL
  -- Recherches payées par CARTE expirées : la seule classe que l'auto-expiry
  -- (0250) laisse volontairement ouverte (remboursement requis). L'annulation
  -- admin recrédite le Coligo Pay immédiatement.
  SELECT 'rides_searching_card_expired', 'drive', 'warning', 2,
         COUNT(*)::int, MIN(r.expires_at),
         'Recherches Drive payées carte expirées (à rembourser)', '/admin/drive'
    FROM public.rides r
   WHERE r.status = 'searching'
     AND r.payment_method = 'card'
     AND r.online_paid_at IS NOT NULL
     AND r.expires_at IS NOT NULL
     AND r.expires_at < now()
  HAVING COUNT(*) > 0;
$$;
REVOKE ALL ON FUNCTION public._admin_alert_rules_drive()
  FROM PUBLIC, authenticated, anon;

-- =============================================================================
-- VÉRIF (hors session admin → fail-closed) :
--   SELECT public.admin_cancel_ride(gen_random_uuid());   -- {ok:false, forbidden}
--   SELECT public.admin_complete_ride(gen_random_uuid()); -- {ok:false, forbidden}
-- =============================================================================
