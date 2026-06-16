-- =============================================================================
-- 0194 — Correctif sécurité : garde de statut sur la validation de recharge
-- =============================================================================
-- FAILLE corrigée : approve_topup_request créditait une demande même si elle
-- avait été REFUSÉE (aucune garde de statut). On borne désormais :
--   • status='pending'  → on crédite (chemin normal)
--   • status='approved' → idempotent : renvoie l'écriture existante, pas de re-crédit
--   • status='rejected' (ou autre) → REFUS : on ne crédite jamais une demande refusée
-- Le crédit reste idempotent par client_operation_id = 'topup_req:'+id.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.approve_topup_request(p_request_id UUID)
RETURNS TABLE (entry_id UUID, new_balance_da INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r public.wallet_topup_requests%ROWTYPE;
  v_admin UUID := auth.uid();
  v_email TEXT;
  v_op TEXT;
  v_entry UUID;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Réservé au super-admin' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- verrou de la demande : sérialise validations concurrentes
  SELECT * INTO r FROM public.wallet_topup_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demande introuvable' USING ERRCODE = 'no_data_found';
  END IF;

  v_op := 'topup_req:' || p_request_id::text;

  -- déjà validée → idempotent (renvoie l'écriture existante, aucun re-crédit)
  IF r.status = 'approved' THEN
    SELECT id INTO v_entry FROM public.operator_wallet_entries
      WHERE wallet_id = r.wallet_id AND client_operation_id = v_op;
    RETURN QUERY SELECT v_entry, public.operator_balance(r.wallet_id);
    RETURN;
  END IF;

  -- toute demande non 'pending' (ex. refusée) ne peut JAMAIS être créditée
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'Demande non validable (statut: %)', r.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_admin;

  INSERT INTO public.operator_wallet_entries
    (wallet_id, type, amount_da, note, created_by, client_operation_id)
  VALUES (r.wallet_id, 'topup_manual', r.amount_da,
          'Recharge manuelle ' || r.method || ' validée [admin:' || COALESCE(v_email,'?') || ']',
          v_admin, v_op)
  RETURNING id INTO v_entry;

  UPDATE public.wallet_topup_requests
    SET status = 'approved', reviewed_by = v_admin, reviewed_at = now()
    WHERE id = p_request_id;

  RETURN QUERY SELECT v_entry, public.operator_balance(r.wallet_id);
END;
$$;
REVOKE ALL ON FUNCTION public.approve_topup_request(UUID) FROM public, anon, authenticated;
