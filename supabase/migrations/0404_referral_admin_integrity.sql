-- =============================================================================
-- 0404 — Parrainage : alerte super-admin, invariants d'intégrité, expiration,
--        liste admin filtrable.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Alerte domaine CONFIANCE : parrainages `held` en attente de revue.
--    (Reprend le corps 0374 §10 + 1 bloc UNION — même règle que d'habitude.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._admin_alert_rules_confiance()
RETURNS TABLE(code text, domain text, severity text, prio integer, count integer,
              since timestamp with time zone, label text, href text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT 'delivery_reports_open', 'confiance',
         CASE WHEN MIN(dr.created_at) < now() - interval '48 hours'
              THEN 'critical' ELSE 'warning' END,
         CASE WHEN MIN(dr.created_at) < now() - interval '48 hours' THEN 3 ELSE 2 END,
         COUNT(*)::int, MIN(dr.created_at),
         'Signalements livraison non résolus', '/admin/reports'
    FROM public.delivery_reports dr
   WHERE dr.status IN ('open','reviewing')
  HAVING COUNT(*) > 0

  UNION ALL
  SELECT 'ride_reports_open', 'confiance',
         CASE WHEN MIN(rr.created_at) < now() - interval '48 hours'
              THEN 'critical' ELSE 'warning' END,
         CASE WHEN MIN(rr.created_at) < now() - interval '48 hours' THEN 3 ELSE 2 END,
         COUNT(*)::int, MIN(rr.created_at),
         'Signalements course non résolus', '/admin/reports'
    FROM public.ride_reports rr
   WHERE rr.status = 'open'
  HAVING COUNT(*) > 0

  UNION ALL
  SELECT 'shared_ip_devices', 'confiance', 'info', 1,
         COUNT(*)::int, NULL::timestamptz,
         'Adresses IP partagées par plusieurs comptes', '/admin/devices'
    FROM (
      SELECT udl.ip
        FROM public.user_device_log udl
       WHERE udl.last_seen_at > now() - interval '7 days'
       GROUP BY udl.ip
      HAVING COUNT(DISTINCT udl.user_id) >= 4
    ) s
  HAVING COUNT(*) > 0

  UNION ALL
  -- Anomalie d'intégrité → écran dédié /admin/integrity (détail actionnable).
  SELECT 'integrity_violation', 'confiance', 'critical', 3,
         COUNT(*)::int, MIN(al.created_at),
         'Anomalie d''intégrité détectée — vérifier', '/admin/integrity'
    FROM public.admin_audit_log al
   WHERE al.action = 'integrity_violation'
     AND al.created_at > now() - interval '2 days'
  HAVING COUNT(*) > 0

  UNION ALL
  -- Alertes ANTI-FRAUDE hautes/critiques à examiner → Centre Anti-Fraude.
  SELECT 'fraud_alerts_open', 'confiance',
         CASE WHEN COUNT(*) FILTER (WHERE fa.severity = 'critical') > 0
              THEN 'critical' ELSE 'warning' END,
         CASE WHEN COUNT(*) FILTER (WHERE fa.severity = 'critical') > 0 THEN 3 ELSE 2 END,
         COUNT(*)::int, MIN(fa.first_seen_at),
         'Alertes anti-fraude à examiner', '/admin/anti-fraude/alertes'
    FROM public.fraud_alerts fa
   WHERE fa.status IN ('open','investigating') AND fa.severity IN ('high','critical')
  HAVING COUNT(*) > 0

  UNION ALL
  -- Parrainages retenus par l'anti-fraude (même appareil, plafond) → revue
  -- humaine dans Marketing → Parrainage (mig 0403/0404).
  SELECT 'referral_held_review', 'confiance', 'warning', 2,
         COUNT(*)::int, MIN(r.created_at),
         'Parrainages retenus — revue à faire', '/admin/marketing/parrainage'
    FROM public.customer_referrals r
   WHERE r.status = 'held'
  HAVING COUNT(*) > 0;
$function$;

REVOKE ALL ON FUNCTION public._admin_alert_rules_confiance() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. integrity_violations() : même corps qu'en 0371 + 4 invariants parrainage.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.integrity_violations()
 RETURNS TABLE(code text, severity text, cnt integer, detail text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- GATING 0068 : online payé/remboursé DOIT avoir un numéro
  SELECT 'gating_paid_no_number', 'critical', count(*)::int,
         'commande online payée sans order_number'
    FROM public.orders
   WHERE payment_method='online' AND payment_status IN ('paid','refunded')
     AND (order_number IS NULL OR order_number='')
  HAVING count(*) > 0

  UNION ALL
  -- GATING 0068 : online NON payé ne DOIT PAS avoir de numéro (fuite commerçant)
  SELECT 'gating_unpaid_has_number', 'critical', count(*)::int,
         'commande online non payée avec order_number (visible commerçant)'
    FROM public.orders
   WHERE payment_method='online' AND payment_status NOT IN ('paid','refunded')
     AND order_number IS NOT NULL AND order_number<>''
  HAVING count(*) > 0

  UNION ALL
  -- Commande online complétée mais non payée
  SELECT 'online_completed_unpaid', 'critical', count(*)::int,
         'commande online completed mais non payée'
    FROM public.orders
   WHERE payment_method='online' AND status='completed'
     AND payment_status NOT IN ('paid','refunded')
  HAVING count(*) > 0

  UNION ALL
  -- Solde Coligo Pay (topup) négatif
  SELECT 'topup_balance_negative', 'critical', count(*)::int,
         'client avec solde Coligo Pay négatif'
    FROM public.customers cu
   WHERE public.customer_topup_balance(cu.id) < 0
  HAVING count(*) > 0

  UNION ALL
  -- Solde cashback négatif
  SELECT 'cashback_balance_negative', 'critical', count(*)::int,
         'client avec solde cashback négatif'
    FROM public.customers cu
   WHERE public.customer_cashback_balance(cu.id) < 0
  HAVING count(*) > 0

  UNION ALL
  -- Dérive : SUM(grand livre topup) != solde renvoyé par la RPC
  SELECT 'topup_ledger_drift', 'critical', count(*)::int,
         'écart entre SUM(ledger topup) et customer_topup_balance()'
    FROM public.customers cu
   WHERE COALESCE((SELECT SUM(amount_da) FROM public.customer_wallet_entries e
                    WHERE e.customer_id=cu.id AND e.source='topup'),0)
         <> public.customer_topup_balance(cu.id)
  HAVING count(*) > 0

  UNION ALL
  -- P2P Coligo Pay : chaque transfert doit sommer à 0
  SELECT 'p2p_transfer_unbalanced', 'critical', count(*)::int,
         'transfert P2P Coligo Pay non équilibré (SUM<>0)'
    FROM (
      SELECT coligo_pay_transfer_id
        FROM public.customer_wallet_entries
       WHERE coligo_pay_transfer_id IS NOT NULL
       GROUP BY 1 HAVING SUM(amount_da) <> 0
    ) t
  HAVING count(*) > 0

  UNION ALL
  -- Paiement marchand Coligo Pay : débit client = -montant du paiement
  SELECT 'coligo_pay_payment_mismatch', 'critical', count(*)::int,
         'paiement marchand Coligo Pay : débit client != -montant'
    FROM (
      SELECT p.id
        FROM public.coligo_pay_payments p
        LEFT JOIN public.customer_wallet_entries e ON e.coligo_pay_payment_id=p.id
       GROUP BY p.id, p.amount_da
      HAVING COALESCE(SUM(e.amount_da),0) <> -p.amount_da
    ) t
  HAVING count(*) > 0

  UNION ALL
  -- Transfert opérateur inter-portefeuilles : SUM = 0
  SELECT 'operator_transfer_unbalanced', 'critical', count(*)::int,
         'transfert opérateur inter-portefeuilles non équilibré (SUM<>0)'
    FROM (
      SELECT client_operation_id
        FROM public.operator_wallet_entries
       WHERE counterparty_wallet_id IS NOT NULL
       GROUP BY 1 HAVING SUM(amount_da) <> 0
    ) t
  HAVING count(*) > 0

  UNION ALL
  -- Cohérence : commande livrée sans livreur attribué
  SELECT 'delivered_without_driver', 'warning', count(*)::int,
         'commande delivery livrée sans delivery_driver_id'
    FROM public.orders
   WHERE fulfillment_type='delivery' AND delivery_delivered_at IS NOT NULL
     AND delivery_driver_id IS NULL
  HAVING count(*) > 0

  UNION ALL
  -- ── IDV (vérification d'identité, mig 0367+) ────────────────────────────
  -- Un dossier APPROUVÉ sans comparaison de visage réussie : une identité ne
  -- peut pas être « vérifiée » sans que les visages aient été comparés.
  SELECT 'idv_approved_without_face_match', 'critical', count(*)::int,
         'dossier IDV approuvé sans check face_match réussi'
    FROM public.idv_verifications v
   WHERE v.status = 'approved'
     -- REPLI MANUEL (mig 0371) : dossier décidé par un HUMAIN sur pièces, après
     -- un refus automatique. Il n'a par construction aucun score de comparaison
     -- des visages — l'invariant ne le concerne pas. Il reste entier pour TOUTES
     -- les décisions automatiques.
     AND NOT v.manual_fallback
     AND NOT EXISTS (
       SELECT 1 FROM public.idv_checks c
        WHERE c.verification_id = v.id
          AND c.check_key = 'face_match'
          AND c.status = 'passed'
     )
  HAVING count(*) > 0

  UNION ALL
  -- Décision posée sans horodatage (ou l'inverse) : une décision se date.
  SELECT 'idv_decision_without_timestamp', 'critical', count(*)::int,
         'dossier IDV avec decision mais sans decided_at (ou l''inverse)'
    FROM public.idv_verifications
   WHERE (decision IS NOT NULL AND decided_at IS NULL)
      OR (decision IS NULL AND decided_at IS NOT NULL)
  HAVING count(*) > 0

  UNION ALL
  -- Dossier tranché (approuvé/refusé) mais SANS décision enregistrée.
  SELECT 'idv_closed_without_decision', 'critical', count(*)::int,
         'dossier IDV approved/rejected sans colonne decision'
    FROM public.idv_verifications
   WHERE status IN ('approved', 'rejected') AND decision IS NULL
  HAVING count(*) > 0

  UNION ALL
  -- Toute décision doit laisser une trace au journal d'audit (append-only).
  SELECT 'idv_decision_without_audit', 'critical', count(*)::int,
         'décision IDV sans entrée correspondante dans idv_audit_log'
    FROM public.idv_verifications v
   WHERE v.decision IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.idv_audit_log a
        WHERE a.verification_id = v.id
          AND a.action IN ('auto_approved', 'auto_rejected',
                           'manual_approved', 'manual_rejected')
     )
  HAVING count(*) > 0

  UNION ALL
  -- Décision MANUELLE sans administrateur identifié : la traçabilité RH est
  -- le cœur de la revue humaine.
  SELECT 'idv_manual_decision_without_admin', 'warning', count(*)::int,
         'décision manuelle IDV sans decided_by'
    FROM public.idv_verifications
   WHERE decision IN ('manual_approved', 'manual_rejected')
     AND decided_by IS NULL
  HAVING count(*) > 0

  UNION ALL
  -- Deux dossiers VIVANTS pour le même (utilisateur, profil) : l'index unique
  -- partiel l'interdit — si ça sort ici, c'est que l'index a sauté.
  SELECT 'idv_multiple_active_cases', 'critical', count(*)::int,
         'plusieurs dossiers IDV actifs pour un même (user, profil)'
    FROM (
      SELECT user_id, profile
        FROM public.idv_verifications
       WHERE status NOT IN ('approved','rejected','canceled','expired')
       GROUP BY user_id, profile
      HAVING count(*) > 1
    ) t
  HAVING count(*) > 0

  UNION ALL
  -- Dossier approuvé alors que le document est EXPIRÉ : contradiction directe.
  SELECT 'idv_approved_expired_document', 'critical', count(*)::int,
         'dossier IDV approuvé avec un document expiré'
    FROM public.idv_verifications
   WHERE status = 'approved'
     AND document_expires_at IS NOT NULL
     AND document_expires_at < current_date
  HAVING count(*) > 0

  UNION ALL
  -- ── PARRAINAGE (mig 0403/0404) ──────────────────────────────────────────
  -- Un parrainage crédité doit porter EXACTEMENT ses deux écritures taguées
  -- (la révocation contre-passe en `adjustment` NON tagué : les crédits
  -- d'origine restent — l'invariant vaut donc aussi pour `revoked`).
  SELECT 'referral_credit_mismatch', 'critical', count(*)::int,
         'parrainage crédité : SUM(écritures taguées) != récompenses promises'
    FROM public.customer_referrals r
   WHERE r.credited_at IS NOT NULL
     AND COALESCE((SELECT SUM(e.amount_da) FROM public.customer_wallet_entries e
                    WHERE e.referral_id = r.id), 0)
         <> (r.reward_referrer_da + r.reward_referee_da)
  HAVING count(*) > 0

  UNION ALL
  -- `rewarded` sans crédit posé (T2 aurait échoué en silence).
  SELECT 'referral_rewarded_uncredited', 'critical', count(*)::int,
         'parrainage rewarded sans credited_at (crédit wallet manquant)'
    FROM public.customer_referrals
   WHERE status = 'rewarded' AND credited_at IS NULL
     AND decided_at < now() - interval '10 minutes'
  HAVING count(*) > 0

  UNION ALL
  -- Doublon d'écriture par (parrainage, client) : l'index unique l'interdit —
  -- si ça sort ici, c'est que l'index a sauté.
  SELECT 'referral_duplicate_credit', 'critical', count(*)::int,
         'écritures wallet dupliquées pour un même (parrainage, client)'
    FROM (
      SELECT referral_id, customer_id
        FROM public.customer_wallet_entries
       WHERE referral_id IS NOT NULL
       GROUP BY 1, 2 HAVING count(*) > 1
    ) t
  HAVING count(*) > 0

  UNION ALL
  -- Grand livre : la dépense plateforme parrainage doit valoir
  -- −(crédits tagués) + (récompenses des parrainages révoqués, contre-passées).
  SELECT 'referral_ledger_drift', 'critical', 1,
         'écart entre platform_ledger(referral_expense) et les crédits parrainage'
   WHERE COALESCE((SELECT SUM(amount_da) FROM public.platform_ledger
                    WHERE type = 'referral_expense'), 0)
      <> -(COALESCE((SELECT SUM(amount_da) FROM public.customer_wallet_entries
                      WHERE type = 'referral_credit'), 0))
         + COALESCE((SELECT SUM(reward_referrer_da + reward_referee_da)
                       FROM public.customer_referrals
                      WHERE status = 'revoked' AND credited_at IS NOT NULL), 0);

$function$;

REVOKE ALL ON FUNCTION public.integrity_violations() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. expire_referrals() — attributions `pending` périmées → `expired`.
--    Idempotente, appelée par le cron quotidien (route expire-orders).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_referrals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.customer_referrals
     SET status = 'expired', decided_at = now()
   WHERE status = 'pending' AND expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_referrals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_referrals() TO service_role;

-- ---------------------------------------------------------------------------
-- 4. admin_referral_list(status, q, limit, offset) — liste filtrable de la
--    page Marketing → Parrainage. Garde admin_can('marketing'), appelée avec
--    la SESSION admin (jamais service_role : le JWT porte l'email RBAC).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_referral_list(
  p_status text DEFAULT NULL,
  p_q      text DEFAULT NULL,
  p_limit  integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
BEGIN
  IF NOT public.admin_can('marketing') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_j ORDER BY created_at DESC)
    FROM (
      SELECT r.created_at,
             jsonb_build_object(
               'id', r.id,
               'status', r.status,
               'code', r.code,
               'created_at', r.created_at,
               'decided_at', r.decided_at,
               'credited_at', r.credited_at,
               'expires_at', r.expires_at,
               'fraud_note', r.fraud_note,
               'reward_referrer_da', r.reward_referrer_da,
               'reward_referee_da', r.reward_referee_da,
               'qualifying_order', (
                 SELECT jsonb_build_object('id', o.id, 'order_number', o.order_number,
                                           'total_da', o.total_da)
                   FROM public.orders o WHERE o.id = r.qualifying_order_id
               ),
               'referrer', jsonb_build_object('id', cr.id, 'name', cr.full_name,
                                              'phone', cr.phone),
               'referee',  jsonb_build_object('id', ce.id, 'name', ce.full_name,
                                              'phone', ce.phone)
             ) AS row_j
        FROM public.customer_referrals r
        JOIN public.customers cr ON cr.id = r.referrer_customer_id
        JOIN public.customers ce ON ce.id = r.referee_customer_id
       WHERE (p_status IS NULL OR r.status::text = p_status)
         AND (v_q IS NULL
              OR r.code ILIKE '%' || v_q || '%'
              OR cr.full_name ILIKE '%' || v_q || '%'
              OR ce.full_name ILIKE '%' || v_q || '%'
              OR cr.phone ILIKE '%' || v_q || '%'
              OR ce.phone ILIKE '%' || v_q || '%')
       ORDER BY r.created_at DESC
       LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
      OFFSET GREATEST(COALESCE(p_offset, 0), 0)
    ) rows
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_referral_list(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_referral_list(text, text, integer, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Réglages : RPC d'écriture admin (la table n'a AUCUNE policy d'écriture).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_referral_settings(
  p_enabled                 boolean,
  p_reward_referrer_da      integer,
  p_reward_referee_da       integer,
  p_min_order_da            integer,
  p_max_referrals_month     integer,
  p_attribution_expiry_days integer
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.admin_can('marketing') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_reward_referrer_da < 0 OR p_reward_referee_da < 0
     OR p_min_order_da < 0 OR p_max_referrals_month < 1
     OR p_attribution_expiry_days < 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_values');
  END IF;

  UPDATE public.referral_settings
     SET enabled                 = p_enabled,
         reward_referrer_da      = p_reward_referrer_da,
         reward_referee_da       = p_reward_referee_da,
         min_order_da            = p_min_order_da,
         max_referrals_month     = p_max_referrals_month,
         attribution_expiry_days = p_attribution_expiry_days,
         updated_by              = auth.uid(),
         updated_at              = now()
   WHERE id = 1;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_referral_settings(boolean, integer, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_referral_settings(boolean, integer, integer, integer, integer, integer) TO authenticated;

-- =============================================================================
-- VÉRIFICATION :
--   SELECT * FROM integrity_violations();          -- (service) 0 ligne parrainage
--   SELECT public.expire_referrals();              -- (service) 0
-- =============================================================================
