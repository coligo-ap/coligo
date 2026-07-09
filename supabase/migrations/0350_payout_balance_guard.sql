-- =============================================================================
-- 0350 — Garde de solde sur le versement commerçant (anti-fraude montant)
-- =============================================================================
-- FAILLE (audit 2026-07-09, domaine Coligo Pay & partenaires) : le versement
-- commerçant `admin_process_payout(..., 'pay')` débitait le grand livre de
-- `-r.amount_da` — le montant de la DEMANDE — SANS vérifier le solde réel. Or
-- la policy `payout_requests_insert_own` autorise un commerçant à INSÉRER une
-- demande pour lui-même (status='pending') sans contrainte de montant : un
-- commerçant pouvait donc, via un INSERT PostgREST direct (en contournant
-- l'action serveur qui, elle, plafonne au solde disponible), créer une demande
-- à montant arbitraire. Si un admin la « payait », le grand livre était débité
-- du montant forgé → sur-versement possible (seul garde-fou : l'humain).
--
-- Le versement PARTENAIRE/opérateur (`admin_operator_payout`) était déjà protégé
-- par une garde de solde ; on aligne le versement commerçant sur ce standard.
--
-- CORRECTIF : la branche 'pay' refuse désormais tout versement dont le montant
-- dépasse le solde réel du commerçant (somme de `wallet_entries`). Un versement
-- ne peut donc JAMAIS rendre le grand livre négatif, quel que soit le montant
-- (même forgé) de la demande. Idempotent, aucun changement de comportement pour
-- les demandes légitimes (toujours ≤ solde disponible ≤ solde total).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_process_payout(p_payout_id uuid, p_action text)
RETURNS payout_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin UUID := auth.uid();
  v_email TEXT;
  v_bal   INTEGER;
  r       public.payout_requests%ROWTYPE;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Réservé au super-admin' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO r FROM public.payout_requests WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demande introuvable' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_admin;

  IF p_action = 'approve' THEN
    IF r.status <> 'pending' THEN
      RAISE EXCEPTION 'Seule une demande en attente peut être approuvée (statut: %)', r.status
        USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.payout_requests SET status = 'approved' WHERE id = p_payout_id;
    RETURN 'approved';

  ELSIF p_action = 'reject' THEN
    IF r.status NOT IN ('pending', 'approved') THEN
      RAISE EXCEPTION 'Demande déjà finalisée (statut: %)', r.status
        USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.payout_requests
      SET status = 'rejected', processed_at = now()
      WHERE id = p_payout_id;
    RETURN 'rejected';

  ELSIF p_action = 'pay' THEN
    IF r.status NOT IN ('pending', 'approved') THEN
      RAISE EXCEPTION 'Demande déjà payée ou refusée (statut: %)', r.status
        USING ERRCODE = 'check_violation';
    END IF;

    -- GARDE DE SOLDE (anti-fraude) : jamais verser plus que le solde réel du
    -- commerçant. Neutralise toute demande à montant forgé (insert direct).
    SELECT COALESCE(SUM(amount_da), 0) INTO v_bal
      FROM public.wallet_entries
     WHERE merchant_id = r.merchant_id;
    IF v_bal < r.amount_da THEN
      RAISE EXCEPTION 'Solde insuffisant : % < % (versement refusé)', v_bal, r.amount_da
        USING ERRCODE = 'check_violation';
    END IF;

    -- Débit du grand livre commerçant. Le trigger miroir (0203) répercute
    -- automatiquement dans la Coligo Pay opérateur.
    INSERT INTO public.wallet_entries (merchant_id, type, amount_da, note)
    VALUES (
      r.merchant_id, 'payout', -r.amount_da,
      'Versement ' || COALESCE(r.method, '?')
        || COALESCE(' · ' || NULLIF(btrim(r.details), ''), '')
        || ' [admin:' || COALESCE(v_email, '?') || ']'
    );
    UPDATE public.payout_requests
      SET status = 'paid', processed_at = now()
      WHERE id = p_payout_id;
    RETURN 'paid';

  ELSE
    RAISE EXCEPTION 'Action invalide: %', p_action USING ERRCODE = 'check_violation';
  END IF;
END;
$function$;
