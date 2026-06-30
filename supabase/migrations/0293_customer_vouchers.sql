-- =============================================================================
-- 0293 — Bons d'achat plateforme → crédit Coligo Pay (portefeuille topup)
-- =============================================================================
-- Un « bon » est une valeur OFFERTE par la plateforme à un client (cadeau,
-- fidélité, dédommagement, campagne). Décision produit : le bon CRÉDITE le
-- portefeuille Coligo Pay (source 'topup') du client. Le client paie ensuite
-- normalement avec son solde.
--
-- ⚠️ ARGENT RÉEL — invariant grand livre SUM=0 :
--   +X  customer_wallet_entries (topup_credit)   ← le client gagne X
--   −X  platform_ledger        (voucher_expense) ← la plateforme dépense X
--
-- Idempotence : le crédit wallet est rattaché au `voucher_id` (index unique).
-- Le trigger AFTER INSERT (SECURITY DEFINER) écrit le ledger — calque de
-- `grant_customer_cashback_on_completion` (mig 0017).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ENUMS
-- ---------------------------------------------------------------------------
-- Type d'écriture dédié au bon : compte dans le SOLDE topup (source='topup')
-- MAIS reste hors du plafond de recharge glissant (qui filtre 'topup_credit')
-- → un cadeau plateforme ne réduit pas le droit de recharge du client.
ALTER TYPE public.customer_wallet_entry_type ADD VALUE IF NOT EXISTS 'voucher_credit';

DO $$ BEGIN
  CREATE TYPE public.voucher_reason AS ENUM
    ('gift', 'loyalty', 'compensation', 'campaign');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.voucher_status AS ENUM ('granted', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2. Rattachement idempotent du crédit wallet à un bon.
--    Index UNIQUE NON partiel : Postgres autorise plusieurs NULL (toutes les
--    autres écritures : cashback, achats…) et impose l'unicité sur les non-NULL.
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_wallet_entries
  ADD COLUMN IF NOT EXISTS voucher_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cwe_voucher
  ON public.customer_wallet_entries (voucher_id);

-- ---------------------------------------------------------------------------
-- 3. TABLE: customer_vouchers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_vouchers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  amount_da   INTEGER NOT NULL CHECK (amount_da > 0),
  label_fr    TEXT,
  label_ar    TEXT,
  reason      public.voucher_reason NOT NULL DEFAULT 'gift',
  status      public.voucher_status NOT NULL DEFAULT 'granted',
  -- Regroupe les bons d'une même campagne (diffusion à tous / segment).
  batch_id    UUID,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_vouchers_customer
  ON public.customer_vouchers (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_vouchers_batch
  ON public.customer_vouchers (batch_id);

ALTER TABLE public.customer_vouchers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_vouchers_select_own" ON public.customer_vouchers;
CREATE POLICY "customer_vouchers_select_own" ON public.customer_vouchers
  FOR SELECT USING (
    customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "customer_vouchers_admin_all" ON public.customer_vouchers;
CREATE POLICY "customer_vouchers_admin_all" ON public.customer_vouchers
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
-- Aucune policy INSERT côté client → seul l'admin (service_role / RPC) émet.

-- ---------------------------------------------------------------------------
-- 4. TRIGGER: crédit Coligo Pay + compta plateforme à l'émission du bon.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_voucher_on_grant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_credited integer := 0;
BEGIN
  IF NEW.status = 'granted' AND NEW.amount_da > 0 THEN
    -- +X sur le portefeuille topup du client (idempotent via voucher_id).
    INSERT INTO public.customer_wallet_entries
      (customer_id, order_id, type, source, amount_da, note, voucher_id)
    VALUES
      (NEW.customer_id, NULL, 'voucher_credit', 'topup', NEW.amount_da,
       COALESCE(NULLIF(btrim(NEW.label_fr), ''), 'Bon d''achat Coligo'),
       NEW.id)
    ON CONFLICT (voucher_id) DO NOTHING;
    GET DIAGNOSTICS v_credited = ROW_COUNT;

    -- −X dépense plateforme UNIQUEMENT si le crédit a réellement été inséré
    -- (équilibre le grand livre, SUM=0, sans double dépense). Pas d'order_id →
    -- chaque bon a sa propre écriture (NULL = distinct dans la contrainte unique).
    IF v_credited > 0 THEN
      INSERT INTO public.platform_ledger (order_id, type, amount_da)
      VALUES (NULL, 'voucher_expense', -NEW.amount_da);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_credit_voucher ON public.customer_vouchers;
CREATE TRIGGER trigger_credit_voucher
  AFTER INSERT ON public.customer_vouchers
  FOR EACH ROW
  EXECUTE FUNCTION public.credit_voucher_on_grant();

-- ---------------------------------------------------------------------------
-- 5. RPC admin_grant_voucher — émettre un bon (1 client, plusieurs, ou TOUS).
--    p_customer_ids = NULL → tous les clients (même batch_id). Renvoie le nombre.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_grant_voucher(
  p_customer_ids uuid[],
  p_amount_da    integer,
  p_label_fr     text,
  p_label_ar     text,
  p_reason       public.voucher_reason DEFAULT 'gift'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch uuid := gen_random_uuid();
  v_count integer := 0;
  v_admin uuid := auth.uid();
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_amount_da IS NULL OR p_amount_da <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.customer_vouchers
    (customer_id, amount_da, label_fr, label_ar, reason, batch_id, created_by)
  SELECT c.id, p_amount_da, p_label_fr, p_label_ar, p_reason, v_batch, v_admin
  FROM public.customers c
  WHERE p_customer_ids IS NULL OR c.id = ANY (p_customer_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_voucher(uuid[], integer, text, text, public.voucher_reason) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_voucher(uuid[], integer, text, text, public.voucher_reason) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. RPC admin_revoke_voucher — annule un bon NON encore dépensé.
--    Contre-passation (jamais de DELETE sur un ledger append-only).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revoke_voucher(p_voucher_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v public.customer_vouchers%ROWTYPE;
  v_balance integer;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v FROM public.customer_vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF v.status = 'revoked' THEN RETURN jsonb_build_object('ok', false, 'reason', 'already_revoked'); END IF;

  -- On ne peut révoquer que si le solde topup couvre encore le bon (non dépensé).
  SELECT public.customer_topup_balance(v.customer_id) INTO v_balance;
  IF v_balance < v.amount_da THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_spent');
  END IF;

  UPDATE public.customer_vouchers SET status = 'revoked' WHERE id = v.id;

  -- −X sur le wallet client (reprise) + +X retour compta plateforme.
  INSERT INTO public.customer_wallet_entries
    (customer_id, order_id, type, source, amount_da, note)
  VALUES
    (v.customer_id, NULL, 'adjustment', 'topup', -v.amount_da,
     'Annulation bon d''achat (révocation admin).');

  INSERT INTO public.platform_ledger (order_id, type, amount_da)
  VALUES (NULL, 'voucher_expense', v.amount_da);

  RETURN jsonb_build_object('ok', true, 'reason', 'revoked');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revoke_voucher(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_voucher(uuid) TO authenticated;
