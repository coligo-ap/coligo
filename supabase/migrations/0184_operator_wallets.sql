-- =============================================================================
-- 0184 — Portefeuille opérateur (LOT 1 : socle, additif, zéro enforcement)
-- =============================================================================
-- Portefeuille rechargeable POUR LES OPÉRATEURS (livreurs / chauffeurs /
-- commerçants / partenaires points de recharge). SÉPARÉ de Coligo Pay client
-- (`customer_wallet_entries`) : on ne touche pas au système money client testé
-- et audité ; on copie ses invariants prouvés (grand livre append-only,
-- double-entrée SUM=0, idempotence par client_operation_id).
--
-- LOT 1 = purement ADDITIF :
--   • crée les tables + fonctions de solde/seuil
--   • crée un portefeuille (solde 0) pour chaque opérateur existant
--   • AUCUN enforcement (le blocage sous-seuil arrive au LOT 2)
--   • AUCUNE init des soldes réels (outstanding/dette → LOT 2)
-- => zéro changement de comportement en prod.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. PORTEFEUILLES — un par opérateur (polymorphe : pas de FK multi-tables)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.operator_wallets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type   TEXT NOT NULL CHECK (owner_type IN ('driver','chauffeur','merchant','partner')),
  owner_id     UUID NOT NULL,
  is_partner   BOOLEAN NOT NULL DEFAULT false,        -- point de recharge (LOT 4)
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','suspended','disabled')),
  -- ancienneté : sert au seuil « compte neuf » (réf = date de création de l'opérateur)
  tenure_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- géoloc partenaire (NULL pour les non-partenaires) — exploité au LOT 5
  display_name TEXT,
  address      TEXT,
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  phone        TEXT,
  hours        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_type, owner_id)
);

CREATE INDEX IF NOT EXISTS idx_operator_wallets_partner
  ON public.operator_wallets (status) WHERE is_partner;
CREATE INDEX IF NOT EXISTS idx_operator_wallets_geo
  ON public.operator_wallets (lat, lng) WHERE is_partner AND lat IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. GRAND LIVRE — append-only, montant SIGNÉ (+crédit / −débit)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.operator_wallet_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id     UUID NOT NULL REFERENCES public.operator_wallets(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN (
                  'topup_chargily','topup_manual','topup_partner',  -- crédits recharge
                  'recharge_sale',                                  -- débit revente (partenaire)
                  'bonus',                                          -- crédit bonus admin
                  'fee_debit','service_fee','cod_settle',           -- débits métier
                  'adjustment')),                                   -- init / correction admin
  amount_da     INTEGER NOT NULL,                                   -- signé
  ref_id        UUID,                                               -- order/ride/transfer selon contexte
  counterparty_wallet_id UUID REFERENCES public.operator_wallets(id),  -- revente (SUM=0)
  client_operation_id TEXT,                                         -- idempotence
  note          TEXT,
  created_by    UUID,                                               -- admin si manuel/bonus
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- idempotence : une même opération client ne crédite/débite qu'une fois par portefeuille
CREATE UNIQUE INDEX IF NOT EXISTS uq_operator_entries_op
  ON public.operator_wallet_entries (wallet_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_operator_entries_wallet
  ON public.operator_wallet_entries (wallet_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. PARAMÈTRES — seuils négatifs par rôle + repère bonus partenaire
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS neg_threshold_driver_da    INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS neg_threshold_chauffeur_da INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS neg_threshold_merchant_da  INTEGER NOT NULL DEFAULT 2000,
  ADD COLUMN IF NOT EXISTS neg_threshold_new_days     INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS partner_recharge_rate      NUMERIC(5,4) NOT NULL DEFAULT 0.0100,
  ADD COLUMN IF NOT EXISTS operator_topup_max_da      INTEGER NOT NULL DEFAULT 100000;

-- ---------------------------------------------------------------------------
-- 4. SOLDE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operator_balance(p_wallet_id UUID)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(amount_da), 0)::INTEGER
  FROM public.operator_wallet_entries
  WHERE wallet_id = p_wallet_id;
$$;

-- ---------------------------------------------------------------------------
-- 5. SEUIL NÉGATIF AUTORISÉ (par rôle + compte neuf)
--    Point d'extension : montée auto selon ancienneté/activité (LOT futur).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operator_neg_threshold(p_wallet_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  w  public.operator_wallets%ROWTYPE;
  s  public.platform_settings%ROWTYPE;
BEGIN
  SELECT * INTO w FROM public.operator_wallets WHERE id = p_wallet_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  SELECT * INTO s FROM public.platform_settings WHERE id;

  -- compte neuf : aucun découvert pendant les N premiers jours
  IF now() - w.tenure_start < make_interval(days => s.neg_threshold_new_days) THEN
    RETURN 0;
  END IF;

  RETURN CASE w.owner_type
    WHEN 'driver'    THEN s.neg_threshold_driver_da
    WHEN 'chauffeur' THEN s.neg_threshold_chauffeur_da
    WHEN 'merchant'  THEN s.neg_threshold_merchant_da
    ELSE 0                                   -- partenaire : jamais à découvert
  END;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. PEUT-IL OPÉRER ? (consommé par l'enforcement au LOT 2)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operator_can_operate(p_wallet_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.operator_wallets w
    WHERE w.id = p_wallet_id
      AND w.status = 'active'
      AND public.operator_balance(w.id) >= -public.operator_neg_threshold(w.id)
  );
$$;

-- ---------------------------------------------------------------------------
-- 7. ÉTAT COMPLET (lecture app + tests) — résout le portefeuille par opérateur
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operator_wallet_state(
  p_owner_type TEXT, p_owner_id UUID
)
RETURNS TABLE (
  wallet_id UUID, status TEXT, balance_da INTEGER,
  neg_threshold_da INTEGER, can_operate BOOLEAN, is_partner BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT w.id, w.status,
         public.operator_balance(w.id),
         public.operator_neg_threshold(w.id),
         public.operator_can_operate(w.id),
         w.is_partner
  FROM public.operator_wallets w
  WHERE w.owner_type = p_owner_type AND w.owner_id = p_owner_id;
$$;

-- ---------------------------------------------------------------------------
-- 8. CRÉATION GARANTIE D'UN PORTEFEUILLE — helper + triggers auto
--    => tout opérateur a TOUJOURS un portefeuille (fiabilité).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_operator_wallet(
  p_owner_type TEXT, p_owner_id UUID, p_tenure_start TIMESTAMPTZ DEFAULT now()
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.operator_wallets (owner_type, owner_id, tenure_start)
  VALUES (p_owner_type, p_owner_id, COALESCE(p_tenure_start, now()))
  ON CONFLICT (owner_type, owner_id) DO NOTHING;
  SELECT id INTO v_id FROM public.operator_wallets
    WHERE owner_type = p_owner_type AND owner_id = p_owner_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_create_operator_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_type TEXT;
BEGIN
  v_type := CASE TG_TABLE_NAME
              WHEN 'drivers'    THEN 'driver'
              WHEN 'chauffeurs' THEN 'chauffeur'
              WHEN 'merchants'  THEN 'merchant'
            END;
  IF v_type IS NOT NULL THEN
    PERFORM public.ensure_operator_wallet(v_type, NEW.id, NEW.created_at);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_driver_wallet    ON public.drivers;
DROP TRIGGER IF EXISTS trg_chauffeur_wallet ON public.chauffeurs;
DROP TRIGGER IF EXISTS trg_merchant_wallet  ON public.merchants;
CREATE TRIGGER trg_driver_wallet    AFTER INSERT ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.trg_create_operator_wallet();
CREATE TRIGGER trg_chauffeur_wallet AFTER INSERT ON public.chauffeurs
  FOR EACH ROW EXECUTE FUNCTION public.trg_create_operator_wallet();
CREATE TRIGGER trg_merchant_wallet  AFTER INSERT ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION public.trg_create_operator_wallet();

-- ---------------------------------------------------------------------------
-- 9. BACKFILL — portefeuille (solde 0) pour chaque opérateur EXISTANT.
--    tenure_start = date de création réelle (=> les anciens ne sont PAS « neufs »).
-- ---------------------------------------------------------------------------
INSERT INTO public.operator_wallets (owner_type, owner_id, tenure_start)
SELECT 'driver', id, created_at FROM public.drivers
ON CONFLICT (owner_type, owner_id) DO NOTHING;

INSERT INTO public.operator_wallets (owner_type, owner_id, tenure_start)
SELECT 'chauffeur', id, created_at FROM public.chauffeurs
ON CONFLICT (owner_type, owner_id) DO NOTHING;

INSERT INTO public.operator_wallets (owner_type, owner_id, tenure_start)
SELECT 'merchant', id, created_at FROM public.merchants
ON CONFLICT (owner_type, owner_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 10. RLS — fermé par défaut. Accès uniquement via fonctions SECURITY DEFINER
--     et service_role (comme le wallet client). Lecture owner = RPC dédiée (LOT 3+).
-- ---------------------------------------------------------------------------
ALTER TABLE public.operator_wallets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_wallet_entries ENABLE ROW LEVEL SECURITY;
-- (aucune policy : deny-all pour les rôles non privilégiés)
