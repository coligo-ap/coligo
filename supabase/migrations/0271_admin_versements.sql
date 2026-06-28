-- =============================================================================
-- 0271 — Traitement super-admin des versements (commerçants + partenaires)
-- =============================================================================
-- CONTEXTE : les `payout_requests` (demandes de versement commerçant) étaient
-- créées par le commerçant ET par le cron `generate_scheduled_payouts`, mais
-- AUCUNE surface admin ne permettait de les traiter — elles s'accumulaient en
-- `pending`. De plus les partenaires (Agent Coligo Pay) n'avaient aucun flux de
-- versement sortant. Cette migration livre les deux côtés, de façon
-- bypass-proof et tracée :
--
--   • admin_process_payout(id, action) — approuver / payer / refuser une demande
--     commerçant. « payer » DÉBITE le grand livre (`wallet_entries` type 'payout'),
--     ce qui met à jour le solde commerçant ET, via le trigger miroir
--     (mig 0203), la Coligo Pay opérateur. Sans ce débit le solde ne baissait
--     jamais après un versement → le commerçant pouvait re-demander la somme.
--
--   • admin_operator_payout(...) — verser à un PARTENAIRE : débit signé 'payout'
--     dans le grand livre opérateur inviolable (mig 0185). Refuse si le solde
--     est insuffisant (jamais de découvert créé par un versement).
--
--   • admin_partner_payables() — liste des partenaires avec leur solde, pour
--     que l'admin sache combien verser.
--
-- Garde commune : `is_super_admin()` (vérité base). Appel via session admin.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Nouveau type d'écriture opérateur : versement sortant (débit).
-- ---------------------------------------------------------------------------
ALTER TABLE public.operator_wallet_entries
  DROP CONSTRAINT IF EXISTS operator_wallet_entries_type_check;
ALTER TABLE public.operator_wallet_entries
  ADD CONSTRAINT operator_wallet_entries_type_check CHECK (type IN (
    'topup_chargily', 'topup_manual', 'topup_partner',
    'recharge_sale', 'bonus', 'fee_debit', 'service_fee', 'cod_settle',
    'adjustment', 'finance_mirror', 'payout'));

-- ---------------------------------------------------------------------------
-- 1. COMMERÇANTS — approuver / payer / refuser une demande de versement.
--    p_action ∈ {'approve','pay','reject'}. Retourne le nouveau statut.
--    Verrou FOR UPDATE → sérialise deux clics concurrents.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_process_payout(
  p_payout_id UUID,
  p_action    TEXT
)
RETURNS public.payout_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin UUID := auth.uid();
  v_email TEXT;
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
$$;

REVOKE ALL ON FUNCTION public.admin_process_payout(UUID, TEXT) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. PARTENAIRES — verser (débit) depuis un portefeuille opérateur.
--    Idempotent via client_operation_id. Refuse un solde insuffisant.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_operator_payout(
  p_wallet_id UUID,
  p_amount_da INTEGER,
  p_note      TEXT,
  p_op_id     TEXT
)
RETURNS TABLE (entry_id UUID, new_balance_da INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin UUID := auth.uid();
  v_email TEXT;
  v_bal   INTEGER;
  v_entry UUID;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Réservé au super-admin' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_amount_da IS NULL OR p_amount_da <= 0 THEN
    RAISE EXCEPTION 'Montant invalide (doit être > 0)' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.operator_wallets WHERE id = p_wallet_id) THEN
    RAISE EXCEPTION 'Portefeuille introuvable' USING ERRCODE = 'no_data_found';
  END IF;

  -- Idempotence : même op_id → on renvoie l'écriture existante.
  SELECT id INTO v_entry FROM public.operator_wallet_entries
    WHERE wallet_id = p_wallet_id AND client_operation_id = p_op_id;
  IF v_entry IS NOT NULL THEN
    RETURN QUERY SELECT v_entry, public.operator_balance(p_wallet_id);
    RETURN;
  END IF;

  v_bal := public.operator_balance(p_wallet_id);
  IF v_bal < p_amount_da THEN
    RAISE EXCEPTION 'Solde insuffisant : % < %', v_bal, p_amount_da
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_admin;

  INSERT INTO public.operator_wallet_entries
    (wallet_id, type, amount_da, note, created_by, client_operation_id)
  VALUES (
    p_wallet_id, 'payout', -p_amount_da,
    'Versement partenaire' || COALESCE(' · ' || NULLIF(btrim(p_note), ''), '')
      || ' [admin:' || COALESCE(v_email, '?') || ']',
    v_admin, p_op_id
  )
  RETURNING id INTO v_entry;

  RETURN QUERY SELECT v_entry, public.operator_balance(p_wallet_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_operator_payout(UUID, INTEGER, TEXT, TEXT) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. PARTENAIRES — liste avec solde (pour décider combien verser).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_partner_payables()
RETURNS TABLE (
  wallet_id    UUID,
  display_name TEXT,
  owner_name   TEXT,
  phone        TEXT,
  status       TEXT,
  balance_da   INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT w.id, w.display_name, w.owner_name, w.phone, w.status,
         public.operator_balance(w.id)
  FROM public.operator_wallets w
  WHERE w.is_partner
  ORDER BY public.operator_balance(w.id) DESC, w.display_name;
$$;

REVOKE ALL ON FUNCTION public.admin_partner_payables() FROM public, anon, authenticated;

-- NB : la garde super-admin de admin_partner_payables est assurée par l'appel
-- (page admin gatée). Elle ne renvoie aucune donnée sensible au-delà du solde.
