-- =============================================================================
-- 0455 — FIDÉLITÉ : invariants d'intégrité (SUM=0 par commerçant, soldes
--         porteurs, bons, machine à états des cartes)
-- =============================================================================
-- Règle maison : integrity_violations() est recréée depuis sa définition LIVE
-- (pg_get_functiondef, 16/08/2026) + blocs fidélité ajoutés en queue. Les
-- GRANTs existants sont préservés par CREATE OR REPLACE.
-- Consommée par le cron /api/cron/integrity et scripts/audit-integrity.mjs.
-- =============================================================================

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
         'commande delivery livrée sans delivery_driver_id (hors validation admin)'
    FROM public.orders o
   WHERE o.fulfillment_type='delivery' AND o.delivery_delivered_at IS NOT NULL
     AND o.delivery_driver_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.admin_audit_log l
        WHERE l.target_id = o.id AND l.action = 'validate_delivery'
     )
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
                      WHERE status = 'revoked' AND credited_at IS NOT NULL), 0)
  UNION ALL
  -- ── FIDÉLITÉ (mig 0453/0454) ────────────────────────────────────────────
  -- Double-entrée : le grand livre fidélité somme à 0 PAR COMMERÇANT.
  SELECT 'loyalty_merchant_unbalanced', 'critical', count(*)::int,
         'grand livre fidélité non équilibré (SUM<>0 pour un commerçant)'
    FROM (
      SELECT merchant_id FROM public.loyalty_entries
       GROUP BY 1 HAVING SUM(amount_da) <> 0
    ) t
  HAVING count(*) > 0

  UNION ALL
  -- Aucun compte porteur (client/carte) ne peut être négatif.
  SELECT 'loyalty_holder_negative', 'critical', count(*)::int,
         'compte fidélité porteur avec solde négatif'
    FROM (
      SELECT a.id FROM public.loyalty_accounts a
      JOIN public.loyalty_entries e ON e.account_id = a.id
      WHERE a.owner_kind <> 'program'
      GROUP BY a.id HAVING SUM(e.amount_da) < 0
    ) t
  HAVING count(*) > 0

  UNION ALL
  -- La valeur des bons ACTIFS d'un compte est couverte par son solde.
  SELECT 'loyalty_voucher_uncovered', 'critical', count(*)::int,
         'bons fidélité actifs non couverts par le solde du compte'
    FROM (
      SELECT v.account_id FROM public.loyalty_vouchers v
      WHERE v.status = 'granted'
      GROUP BY v.account_id
      HAVING SUM(v.amount_da) > COALESCE((SELECT SUM(e.amount_da)
               FROM public.loyalty_entries e WHERE e.account_id = v.account_id), 0)
    ) t
  HAVING count(*) > 0

  UNION ALL
  -- Chaque bon porte des écritures PORTEUR cohérentes avec son statut :
  -- granted → +montant net ; redeemed/expired/revoked → 0 net. (Les écritures
  -- côté compte programme équilibrent toujours — on ne compte que le porteur :
  -- compte actuel + compte d'origine, robuste aux transferts de carte.)
  SELECT 'loyalty_voucher_ledger_mismatch', 'critical', count(*)::int,
         'bon fidélité : écritures liées incohérentes avec le statut'
    FROM public.loyalty_vouchers v
   WHERE COALESCE((SELECT SUM(e.amount_da) FROM public.loyalty_entries e
                    WHERE e.voucher_id = v.id
                      AND e.account_id IN (v.account_id, v.granted_account_id)), 0)
         <> CASE WHEN v.status = 'granted' THEN v.amount_da ELSE 0 END
  HAVING count(*) > 0

  UNION ALL
  -- Machine à états des cartes : liée ⇒ client ; client ⇒ liée ou bloquée.
  SELECT 'loyalty_card_state_mismatch', 'critical', count(*)::int,
         'carte fidélité : statut incohérent avec la liaison'
    FROM public.loyalty_cards
   WHERE (status = 'linked' AND customer_id IS NULL)
      OR (customer_id IS NOT NULL AND status NOT IN ('linked', 'blocked'))
  HAVING count(*) > 0;

$function$
