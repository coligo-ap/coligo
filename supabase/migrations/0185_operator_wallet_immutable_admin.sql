-- =============================================================================
-- 0185 — Grand livre INVIOLABLE + recharge super-admin tracée (LOT 1bis)
-- =============================================================================
-- Exigence : traçabilité & transparence totales (interne + externe), aucune
-- altération possible des flux → comptabilité fiable et « ultra safe ».
--
--   • Le grand livre `operator_wallet_entries` devient APPEND-ONLY :
--     toute tentative d'UPDATE/DELETE est REJETÉE (même service_role direct).
--     Une correction = une NOUVELLE écriture `adjustment` (double-entrée).
--   • RPC `admin_operator_credit` : le super-admin crédite/débite un
--     portefeuille en laissant une PISTE D'AUDIT complète (qui, quand, combien,
--     pourquoi), idempotente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. IMMUTABILITÉ — le grand livre ne se modifie ni ne s'efface JAMAIS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_operator_entries_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'operator_wallet_entries est append-only : % interdit. Corrigez par une écriture adjustment.',
    TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_operator_entries_no_update ON public.operator_wallet_entries;
DROP TRIGGER IF EXISTS trg_operator_entries_no_delete ON public.operator_wallet_entries;
CREATE TRIGGER trg_operator_entries_no_update
  BEFORE UPDATE ON public.operator_wallet_entries
  FOR EACH ROW EXECUTE FUNCTION public.trg_operator_entries_immutable();
CREATE TRIGGER trg_operator_entries_no_delete
  BEFORE DELETE ON public.operator_wallet_entries
  FOR EACH ROW EXECUTE FUNCTION public.trg_operator_entries_immutable();

-- Le portefeuille lui-même ne peut plus être supprimé (on désactive via status)
-- => garantit que l'historique financier reste rattaché.
ALTER TABLE public.operator_wallet_entries
  DROP CONSTRAINT IF EXISTS operator_wallet_entries_wallet_id_fkey;
ALTER TABLE public.operator_wallet_entries
  ADD CONSTRAINT operator_wallet_entries_wallet_id_fkey
  FOREIGN KEY (wallet_id) REFERENCES public.operator_wallets(id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- 2. RECHARGE / AJUSTEMENT PAR LE SUPER-ADMIN (piste d'audit complète)
--    p_amount_da signé : +crédit (recharge) / −débit (correction).
--    p_type ∈ {topup_manual, bonus, adjustment} — borné aux gestes admin.
--    Idempotent via client_operation_id. created_by = admin (auth.uid()).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_operator_credit(
  p_wallet_id    UUID,
  p_amount_da    INTEGER,
  p_type         TEXT,
  p_note         TEXT,
  p_op_id        TEXT
)
RETURNS TABLE (entry_id UUID, new_balance_da INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin   UUID := auth.uid();
  v_email   TEXT;
  v_entry   UUID;
BEGIN
  -- garde-fou : réservé aux super-admins (table platform_admins)
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_admin;
  IF v_admin IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.platform_admins a WHERE a.email = v_email) THEN
    RAISE EXCEPTION 'Réservé au super-admin' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_type NOT IN ('topup_manual','bonus','adjustment') THEN
    RAISE EXCEPTION 'Type admin invalide: %', p_type USING ERRCODE = 'check_violation';
  END IF;
  IF p_amount_da = 0 THEN
    RAISE EXCEPTION 'Montant nul' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.operator_wallets WHERE id = p_wallet_id) THEN
    RAISE EXCEPTION 'Portefeuille introuvable' USING ERRCODE = 'no_data_found';
  END IF;

  -- idempotence : si l'op_id existe déjà, on renvoie l'écriture existante
  SELECT id INTO v_entry FROM public.operator_wallet_entries
    WHERE wallet_id = p_wallet_id AND client_operation_id = p_op_id;
  IF v_entry IS NULL THEN
    INSERT INTO public.operator_wallet_entries
      (wallet_id, type, amount_da, note, created_by, client_operation_id)
    VALUES (p_wallet_id, p_type, p_amount_da,
            COALESCE(p_note, '') || ' [admin:' || COALESCE(v_email,'?') || ']',
            v_admin, p_op_id)
    RETURNING id INTO v_entry;
  END IF;

  RETURN QUERY
    SELECT v_entry, public.operator_balance(p_wallet_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_operator_credit(UUID,INTEGER,TEXT,TEXT,TEXT) FROM public, anon, authenticated;
