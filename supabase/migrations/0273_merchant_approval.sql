-- =============================================================================
-- 0273 — Validation des inscriptions commerçant (workflow super-admin)
-- =============================================================================
-- Jusqu'ici un commerçant qui s'inscrit était créé `is_active = true` : en ligne
-- et visible des clients IMMÉDIATEMENT, sans revue admin. On ajoute un workflow
-- d'approbation façon Uber : tout nouveau commerçant est EN ATTENTE.
--
-- ENFORCEMENT (bulletproof, sans nouvelle logique) : on réutilise `is_active`
-- comme verrou. Il est DÉJÀ filtré partout :
--   • merchants_public  → WHERE is_active = true   (invisible des clients)
--   • RLS placement commande (mig 0016) → merchant_id IN (… WHERE is_active=true)
-- Un commerçant en attente (is_active=false) est donc caché ET ne peut pas
-- recevoir de commande. `approval_status` pilote l'UI admin + l'écran « en
-- attente » côté commerçant + le motif de refus.
--
-- Synchro : pending/rejected ⇒ is_active=false ; approved ⇒ is_active=true.
-- =============================================================================

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approved_at     timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_reason text,
  ADD COLUMN IF NOT EXISTS submitted_at    timestamptz NOT NULL DEFAULT now();

-- Backfill : tous les commerçants EXISTANTS (antérieurs au workflow) sont
-- considérés approuvés — on ne veut surtout pas masquer des boutiques déjà en
-- ligne. Les nouvelles lignes prendront le défaut 'pending'.
UPDATE public.merchants
   SET approval_status = 'approved',
       approved_at     = COALESCE(approved_at, created_at);

CREATE INDEX IF NOT EXISTS idx_merchants_approval_status
  ON public.merchants(approval_status);

-- -----------------------------------------------------------------------------
-- Annuaire admin : expose approval_status + submitted_at pour la file de
-- validation. (Changement de signature → DROP puis recréation.)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_merchants_directory();

CREATE FUNCTION public.admin_merchants_directory()
RETURNS TABLE (
  id                uuid,
  name              text,
  slug              text,
  city              text,
  category          text,
  phone             text,
  email             text,
  is_active         boolean,
  is_frozen         boolean,
  approval_status   text,
  submitted_at      timestamptz,
  rejected_reason   text,
  commission_cash   numeric,
  commission_online numeric,
  cashback_online   numeric,
  cashback_cash     numeric,
  balance_da        bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Accès réservé aux super-administrateurs.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.name,
    m.slug,
    m.city,
    m.category,
    m.phone_public                                   AS phone,
    u.email::text                                    AS email,
    m.is_active,
    m.is_frozen,
    m.approval_status,
    m.submitted_at,
    m.rejected_reason,
    m.commission_cash,
    m.commission_online,
    m.cashback_online,
    m.cashback_cash,
    COALESCE((SELECT SUM(w.amount_da)
                FROM public.wallet_entries w
               WHERE w.merchant_id = m.id), 0)::bigint AS balance_da
  FROM public.merchants m
  LEFT JOIN auth.users u ON u.id = m.user_id
  -- Demandes en attente d'abord (les plus anciennes en haut), puis le reste.
  ORDER BY
    CASE WHEN m.approval_status = 'pending' THEN 0 ELSE 1 END,
    m.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_merchants_directory() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_merchants_directory() TO authenticated;
