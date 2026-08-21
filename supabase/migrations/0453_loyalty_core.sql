-- =============================================================================
-- 0453 — FIDÉLITÉ (socle) : cartes physiques + grand livre cloisonné par
--         commerçant + programmes + bons + journal (SPEC-FIDELITE, Phase 1)
-- =============================================================================
-- Décisions validées par le propriétaire (16/08/2026) :
--   • GRAND LIVRE DÉDIÉ en double-entrée : chaque mouvement est une PAIRE
--     porteur ↔ compte « programme » du commerçant → SUM(par commerçant) = 0.
--     La valeur fidélité est financée par le COMMERÇANT (réduction en magasin) :
--     elle ne touche JAMAIS customer_wallet_entries / wallet_entries /
--     platform_ledger (elle fausserait le solde de règlement Coligo↔commerçant).
--     Mêmes patrons que l'existant : append-only (0243), client_operation_id,
--     verrous advisory, integrity_violations() (0455), test:loyalty.
--   • CLOISONNEMENT PAR CONTRAINTE SQL : loyalty_accounts porte UNIQUE (id,
--     merchant_id) ; loyalty_entries référence (account_id, merchant_id) ET
--     (counterparty_account_id, merchant_id) par FK COMPOSITE → une écriture ne
--     peut STRUCTURELLEMENT pas apparier deux commerçants différents. Un crédit
--     gagné chez A est inconsommable chez B, quel que soit le code appelant.
--   • La carte n'est qu'un IDENTIFIANT (code 16 car. Crockford ≈ 80 bits,
--     non séquentiel). Le solde vit en base, par compte (porteur, commerçant).
--   • Lot imprimé = cartes pré-enregistrées `printed`, SANS valeur tant
--     qu'elles ne sont pas activées au premier crédit en caisse.
--   • À la LIAISON client, les soldes des comptes-carte sont TRANSFÉRÉS vers
--     les comptes-client (même commerçant) ; la carte devient un simple alias.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ENUMS
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.loyalty_card_status AS ENUM
    ('printed', 'activated', 'linked', 'blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.loyalty_account_owner AS ENUM ('customer', 'card', 'program');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.loyalty_entry_type AS ENUM
    ('credit',          -- cashback gagné sur un achat (porteur +X / programme −X)
     'link_bonus',      -- bonus de liaison de carte
     'voucher_grant',   -- bon débloqué à un palier (+valeur du bon)
     'voucher_redeem',  -- bon utilisé en caisse (−valeur)
     'voucher_expire',  -- bon expiré (−valeur, reprise programme)
     'redeem',          -- déduction cashback en caisse
     'transfer_out',    -- transfert sortant (liaison / carte de remplacement)
     'transfer_in',     -- transfert entrant
     'adjustment');     -- correction manuelle (note obligatoire)
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.loyalty_voucher_status AS ENUM
    ('granted', 'redeemed', 'expired', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2. Bornes plateforme (singleton super-admin) — une config commerçant hors
--    bornes est IMPOSSIBLE (trigger §7, pas seulement l'UI).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.loyalty_platform_settings (
  id                        SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  min_earn_rate_pct         NUMERIC(5,2) NOT NULL DEFAULT 0    CHECK (min_earn_rate_pct >= 0),
  max_earn_rate_pct         NUMERIC(5,2) NOT NULL DEFAULT 20   CHECK (max_earn_rate_pct >= 0 AND max_earn_rate_pct <= 100),
  min_tier_threshold_da     INTEGER NOT NULL DEFAULT 500       CHECK (min_tier_threshold_da > 0),
  max_tier_reward_da        INTEGER NOT NULL DEFAULT 2000      CHECK (max_tier_reward_da > 0),
  max_daily_credit_cap_da   INTEGER NOT NULL DEFAULT 5000      CHECK (max_daily_credit_cap_da > 0),
  max_link_bonus_da         INTEGER NOT NULL DEFAULT 500       CHECK (max_link_bonus_da >= 0),
  min_voucher_validity_days INTEGER NOT NULL DEFAULT 7         CHECK (min_voucher_validity_days > 0),
  max_voucher_validity_days INTEGER NOT NULL DEFAULT 365       CHECK (max_voucher_validity_days > 0),
  max_purchase_per_credit_da INTEGER NOT NULL DEFAULT 100000   CHECK (max_purchase_per_credit_da > 0),
  max_batch_quantity        INTEGER NOT NULL DEFAULT 1000      CHECK (max_batch_quantity > 0),
  updated_by                UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (min_earn_rate_pct <= max_earn_rate_pct),
  CHECK (min_voucher_validity_days <= max_voucher_validity_days)
);

INSERT INTO public.loyalty_platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.loyalty_platform_settings ENABLE ROW LEVEL SECURITY;

-- Lecture pour les partenaires connectés (le formulaire commerçant affiche les
-- bornes). Écriture : RPC admin uniquement.
DROP POLICY IF EXISTS loyalty_settings_select ON public.loyalty_platform_settings;
CREATE POLICY loyalty_settings_select ON public.loyalty_platform_settings
  FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- 3. Programme par commerçant (1 ligne max) — le commerçant règle SON
--    programme dans les bornes ; snapshot appliqué à chaque opération.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.loyalty_programs (
  merchant_id           UUID PRIMARY KEY REFERENCES public.merchants(id) ON DELETE CASCADE,
  enabled               BOOLEAN NOT NULL DEFAULT FALSE,
  -- Cashback : % du montant d'achat crédité au client (0 = pas de cashback).
  earn_rate_pct         NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (earn_rate_pct >= 0),
  -- Palier répétable : « tous les X DA dépensés → bon de Y DA » (NULL = pas de palier).
  tier_threshold_da     INTEGER CHECK (tier_threshold_da IS NULL OR tier_threshold_da > 0),
  tier_reward_da        INTEGER CHECK (tier_reward_da IS NULL OR tier_reward_da > 0),
  voucher_validity_days INTEGER NOT NULL DEFAULT 90 CHECK (voucher_validity_days > 0),
  -- Plafond anti-fraude : valeur créditable par compte porteur / 24 h.
  daily_credit_cap_da   INTEGER NOT NULL DEFAULT 1000 CHECK (daily_credit_cap_da > 0),
  -- Bonus offert quand un client LIE une carte de CE commerçant à son compte.
  link_bonus_da         INTEGER NOT NULL DEFAULT 0 CHECK (link_bonus_da >= 0),
  updated_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((tier_threshold_da IS NULL) = (tier_reward_da IS NULL))
);

ALTER TABLE public.loyalty_programs ENABLE ROW LEVEL SECURITY;

-- Le commerçant lit SON programme ; le client passe par les RPC (jamais en direct).
DROP POLICY IF EXISTS loyalty_programs_select_own ON public.loyalty_programs;
CREATE POLICY loyalty_programs_select_own ON public.loyalty_programs
  FOR SELECT USING (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS loyalty_programs_admin_all ON public.loyalty_programs;
CREATE POLICY loyalty_programs_admin_all ON public.loyalty_programs
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 4. Lots d'impression + cartes physiques
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.loyalty_card_batches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id  UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL DEFAULT 'classic',
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  note         TEXT,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_batches_merchant
  ON public.loyalty_card_batches (merchant_id, created_at DESC);

ALTER TABLE public.loyalty_card_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS loyalty_batches_admin_all ON public.loyalty_card_batches;
CREATE POLICY loyalty_batches_admin_all ON public.loyalty_card_batches
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- Carte physique. `card_code` : 16 caractères Crockford (sans O/I/0/1),
-- ≈ 80 bits d'entropie, imprimé en QR (URL /c/<code>) ET en clair (saisie
-- manuelle). `merchant_id` = branding/attribution du lot (« Chez X ») — la
-- carte reste un identifiant valable chez TOUS les commerçants.
CREATE TABLE IF NOT EXISTS public.loyalty_cards (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_code      TEXT NOT NULL UNIQUE CHECK (card_code ~ '^[A-HJ-NP-Z2-9]{16}$'),
  batch_id       UUID REFERENCES public.loyalty_card_batches(id) ON DELETE SET NULL,
  merchant_id    UUID REFERENCES public.merchants(id) ON DELETE SET NULL,
  status         public.loyalty_card_status NOT NULL DEFAULT 'printed',
  -- Posé à la liaison — une carte ne se lie qu'à UN seul compte, à vie.
  customer_id    UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  activated_at   TIMESTAMPTZ,
  linked_at      TIMESTAMPTZ,
  blocked_at     TIMESTAMPTZ,
  blocked_by     TEXT CHECK (blocked_by IS NULL OR blocked_by IN ('customer', 'admin')),
  blocked_reason TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Cohérence statut ↔ liaison (une carte bloquée garde son éventuel client).
  CHECK (
    (status = 'linked'  AND customer_id IS NOT NULL) OR
    (status IN ('printed', 'activated') AND customer_id IS NULL) OR
    (status = 'blocked')
  )
);

CREATE INDEX IF NOT EXISTS idx_loyalty_cards_batch    ON public.loyalty_cards (batch_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_cards_customer ON public.loyalty_cards (customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_cards_merchant ON public.loyalty_cards (merchant_id);

ALTER TABLE public.loyalty_cards ENABLE ROW LEVEL SECURITY;

-- Le client voit SES cartes liées ; toute écriture passe par les RPC DEFINER.
DROP POLICY IF EXISTS loyalty_cards_select_own ON public.loyalty_cards;
CREATE POLICY loyalty_cards_select_own ON public.loyalty_cards
  FOR SELECT USING (
    customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS loyalty_cards_admin_all ON public.loyalty_cards;
CREATE POLICY loyalty_cards_admin_all ON public.loyalty_cards
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 5. Comptes fidélité — LE CŒUR DU CLOISONNEMENT.
--    Un compte = (porteur, commerçant). Le compte `program` est la contrepartie
--    du commerçant : chaque paire d'écritures somme à 0 par commerçant.
--    UNIQUE (id, merchant_id) sert de support aux FK COMPOSITES du ledger.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.loyalty_accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  owner_kind  public.loyalty_account_owner NOT NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE,
  card_id     UUID REFERENCES public.loyalty_cards(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (owner_kind = 'customer' AND customer_id IS NOT NULL AND card_id IS NULL) OR
    (owner_kind = 'card'     AND card_id IS NOT NULL AND customer_id IS NULL) OR
    (owner_kind = 'program'  AND customer_id IS NULL AND card_id IS NULL)
  ),
  UNIQUE (id, merchant_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_account_customer
  ON public.loyalty_accounts (merchant_id, customer_id) WHERE owner_kind = 'customer';
CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_account_card
  ON public.loyalty_accounts (merchant_id, card_id) WHERE owner_kind = 'card';
CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_account_program
  ON public.loyalty_accounts (merchant_id) WHERE owner_kind = 'program';
CREATE INDEX IF NOT EXISTS idx_loyalty_accounts_customer
  ON public.loyalty_accounts (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loyalty_accounts_card
  ON public.loyalty_accounts (card_id) WHERE card_id IS NOT NULL;

ALTER TABLE public.loyalty_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS loyalty_accounts_select_own ON public.loyalty_accounts;
CREATE POLICY loyalty_accounts_select_own ON public.loyalty_accounts
  FOR SELECT USING (
    customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS loyalty_accounts_select_merchant ON public.loyalty_accounts;
CREATE POLICY loyalty_accounts_select_merchant ON public.loyalty_accounts
  FOR SELECT USING (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS loyalty_accounts_admin_all ON public.loyalty_accounts;
CREATE POLICY loyalty_accounts_admin_all ON public.loyalty_accounts
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 6. GRAND LIVRE fidélité (append-only) + BONS + JOURNAL des cartes
-- ---------------------------------------------------------------------------
-- Toute écriture appartient à un compte ET désigne sa contrepartie. Les DEUX
-- FK composites partagent la colonne merchant_id → l'inconsommabilité croisée
-- est une contrainte de SCHÉMA, pas une convention applicative.
CREATE TABLE IF NOT EXISTS public.loyalty_entries (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              UUID NOT NULL,
  merchant_id             UUID NOT NULL,
  counterparty_account_id UUID NOT NULL,
  type                    public.loyalty_entry_type NOT NULL,
  amount_da               INTEGER NOT NULL,
  -- Montant d'achat déclaré (crédits) ou progression importée (transfer_in) :
  -- alimente la progression vers le palier.
  purchase_amount_da      INTEGER CHECK (purchase_amount_da IS NULL OR purchase_amount_da >= 0),
  voucher_id              UUID,
  order_id                UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  client_operation_id     TEXT,
  note                    TEXT,
  created_by              UUID,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (account_id, merchant_id)
    REFERENCES public.loyalty_accounts (id, merchant_id),
  FOREIGN KEY (counterparty_account_id, merchant_id)
    REFERENCES public.loyalty_accounts (id, merchant_id),
  CONSTRAINT loyalty_entries_adjustment_note_chk
    CHECK (type <> 'adjustment' OR (note IS NOT NULL AND btrim(note) <> ''))
);

-- Idempotence : rejouer une opération (double scan, resync hors-ligne) est un
-- no-op — même patron que operator_wallet_entries (0184).
CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_entries_op
  ON public.loyalty_entries (account_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;
-- Cas combiné commande+fidélité : UNE commande Coligo ne crédite qu'UNE fois.
CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_entries_order
  ON public.loyalty_entries (order_id, account_id)
  WHERE order_id IS NOT NULL AND type = 'credit';
-- Pré-lecture d'idempotence à l'échelle du COMMERÇANT (le rejeu d'un crédit
-- doit être reconnu même si la carte a été liée entre-temps — le compte
-- porteur a alors changé).
CREATE INDEX IF NOT EXISTS idx_loyalty_entries_opid
  ON public.loyalty_entries (client_operation_id)
  WHERE client_operation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loyalty_entries_account
  ON public.loyalty_entries (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_entries_merchant
  ON public.loyalty_entries (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_entries_voucher
  ON public.loyalty_entries (voucher_id) WHERE voucher_id IS NOT NULL;

ALTER TABLE public.loyalty_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS loyalty_entries_select_own ON public.loyalty_entries;
CREATE POLICY loyalty_entries_select_own ON public.loyalty_entries
  FOR SELECT USING (
    account_id IN (
      SELECT a.id FROM public.loyalty_accounts a
      WHERE a.customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
    )
  );
DROP POLICY IF EXISTS loyalty_entries_select_merchant ON public.loyalty_entries;
CREATE POLICY loyalty_entries_select_merchant ON public.loyalty_entries
  FOR SELECT USING (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS loyalty_entries_admin_all ON public.loyalty_entries;
CREATE POLICY loyalty_entries_admin_all ON public.loyalty_entries
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
-- Aucune policy INSERT « métier » : seules les RPC SECURITY DEFINER écrivent.

-- Bons d'achat débloqués aux paliers. Objets DISCRETS (ils expirent), mais leur
-- valeur vit dans le grand livre : chaque transition est adossée 1:1 à une
-- écriture (voucher_grant / voucher_redeem / voucher_expire) — le solde reste
-- 100 % dérivé du ledger. `granted_account_id` est IMMUABLE (comptabilité de
-- progression) ; `account_id` suit le porteur (liaison / remplacement).
CREATE TABLE IF NOT EXISTS public.loyalty_vouchers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL,
  merchant_id         UUID NOT NULL,
  granted_account_id  UUID NOT NULL,
  amount_da           INTEGER NOT NULL CHECK (amount_da > 0),
  status              public.loyalty_voucher_status NOT NULL DEFAULT 'granted',
  source              TEXT NOT NULL DEFAULT 'tier' CHECK (source IN ('tier', 'manual')),
  -- Progression « consommée » par ce palier (snapshot du seuil au déblocage).
  progress_consumed_da INTEGER CHECK (progress_consumed_da IS NULL OR progress_consumed_da > 0),
  granted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  redeemed_at         TIMESTAMPTZ,
  FOREIGN KEY (account_id, merchant_id)
    REFERENCES public.loyalty_accounts (id, merchant_id),
  FOREIGN KEY (granted_account_id, merchant_id)
    REFERENCES public.loyalty_accounts (id, merchant_id)
);

CREATE INDEX IF NOT EXISTS idx_loyalty_vouchers_account
  ON public.loyalty_vouchers (account_id, status);
CREATE INDEX IF NOT EXISTS idx_loyalty_vouchers_granted
  ON public.loyalty_vouchers (granted_account_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_vouchers_expiry
  ON public.loyalty_vouchers (expires_at) WHERE status = 'granted';

-- Un événement de bon = UNE paire (porteur + programme) : chaque type ne peut
-- exister qu'une fois par (bon, compte) — double grant/redeem impossible.
CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_entries_voucher_type
  ON public.loyalty_entries (voucher_id, type, account_id) WHERE voucher_id IS NOT NULL;

ALTER TABLE public.loyalty_entries
  DROP CONSTRAINT IF EXISTS loyalty_entries_voucher_fk;
ALTER TABLE public.loyalty_entries
  ADD CONSTRAINT loyalty_entries_voucher_fk
  FOREIGN KEY (voucher_id) REFERENCES public.loyalty_vouchers(id);

ALTER TABLE public.loyalty_vouchers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS loyalty_vouchers_select_own ON public.loyalty_vouchers;
CREATE POLICY loyalty_vouchers_select_own ON public.loyalty_vouchers
  FOR SELECT USING (
    account_id IN (
      SELECT a.id FROM public.loyalty_accounts a
      WHERE a.customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
    )
  );
DROP POLICY IF EXISTS loyalty_vouchers_select_merchant ON public.loyalty_vouchers;
CREATE POLICY loyalty_vouchers_select_merchant ON public.loyalty_vouchers
  FOR SELECT USING (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS loyalty_vouchers_admin_all ON public.loyalty_vouchers;
CREATE POLICY loyalty_vouchers_admin_all ON public.loyalty_vouchers
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- Journal append-only du cycle de vie des cartes (calque d'order_events).
CREATE TABLE IF NOT EXISTS public.loyalty_card_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id             UUID NOT NULL REFERENCES public.loyalty_cards(id) ON DELETE CASCADE,
  from_status         public.loyalty_card_status,
  to_status           public.loyalty_card_status NOT NULL,
  actor               TEXT NOT NULL CHECK (actor IN ('merchant', 'customer', 'admin', 'system')),
  actor_id            UUID,
  client_operation_id TEXT UNIQUE,
  note                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_card_events_card
  ON public.loyalty_card_events (card_id, created_at);

ALTER TABLE public.loyalty_card_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS loyalty_card_events_admin_all ON public.loyalty_card_events;
CREATE POLICY loyalty_card_events_admin_all ON public.loyalty_card_events
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 7. TRIGGERS de garde
-- ---------------------------------------------------------------------------
-- (a) Kill-switch bypass-proof : drapeau `loyalty` autre que « active » = plus
--     AUCUN mouvement de valeur (patron 0182 : trigger non-definer + helper
--     definer feature_blocked, cf. reference_trigger_security_definer).
CREATE OR REPLACE FUNCTION public.trg_loyalty_entries_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.feature_blocked('loyalty') THEN
    RAISE EXCEPTION 'feature_disabled:loyalty' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS loyalty_entries_feature_guard ON public.loyalty_entries;
CREATE TRIGGER loyalty_entries_feature_guard
  BEFORE INSERT ON public.loyalty_entries
  FOR EACH ROW EXECUTE FUNCTION public.trg_loyalty_entries_guard();

-- (b) Append-only (0243) : le grand livre et le journal des cartes sont
--     inviolables, même en service_role / SECURITY DEFINER.
DROP TRIGGER IF EXISTS le_no_update ON public.loyalty_entries;
DROP TRIGGER IF EXISTS le_no_delete ON public.loyalty_entries;
CREATE TRIGGER le_no_update BEFORE UPDATE ON public.loyalty_entries
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_append_only();
CREATE TRIGGER le_no_delete BEFORE DELETE ON public.loyalty_entries
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_append_only();

DROP TRIGGER IF EXISTS lce_no_update ON public.loyalty_card_events;
DROP TRIGGER IF EXISTS lce_no_delete ON public.loyalty_card_events;
CREATE TRIGGER lce_no_update BEFORE UPDATE ON public.loyalty_card_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_append_only();
CREATE TRIGGER lce_no_delete BEFORE DELETE ON public.loyalty_card_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_append_only();

-- (c) Bons : seuls le statut, le porteur et les horodatages de vie bougent —
--     la VALEUR et la comptabilité de progression sont immuables.
CREATE OR REPLACE FUNCTION public.trg_loyalty_voucher_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.amount_da            IS DISTINCT FROM OLD.amount_da
     OR NEW.merchant_id       IS DISTINCT FROM OLD.merchant_id
     OR NEW.granted_account_id IS DISTINCT FROM OLD.granted_account_id
     OR NEW.progress_consumed_da IS DISTINCT FROM OLD.progress_consumed_da
     OR NEW.granted_at        IS DISTINCT FROM OLD.granted_at
     OR NEW.source            IS DISTINCT FROM OLD.source THEN
    RAISE EXCEPTION 'loyalty_vouchers : valeur et origine immuables'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS loyalty_voucher_guard ON public.loyalty_vouchers;
CREATE TRIGGER loyalty_voucher_guard
  BEFORE UPDATE ON public.loyalty_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.trg_loyalty_voucher_guard();

-- (d) Bornes plateforme : une config programme hors bornes est IMPOSSIBLE,
--     même par écriture directe (bypass-proof, pas seulement l'UI).
CREATE OR REPLACE FUNCTION public.trg_loyalty_program_bounds()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.loyalty_platform_settings%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.loyalty_platform_settings WHERE id = 1;
  IF s.id IS NULL THEN RETURN NEW; END IF;

  IF NEW.earn_rate_pct < s.min_earn_rate_pct OR NEW.earn_rate_pct > s.max_earn_rate_pct THEN
    RAISE EXCEPTION 'loyalty_bounds:earn_rate' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.tier_threshold_da IS NOT NULL AND NEW.tier_threshold_da < s.min_tier_threshold_da THEN
    RAISE EXCEPTION 'loyalty_bounds:tier_threshold' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.tier_reward_da IS NOT NULL AND NEW.tier_reward_da > s.max_tier_reward_da THEN
    RAISE EXCEPTION 'loyalty_bounds:tier_reward' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.daily_credit_cap_da > s.max_daily_credit_cap_da THEN
    RAISE EXCEPTION 'loyalty_bounds:daily_cap' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.link_bonus_da > s.max_link_bonus_da THEN
    RAISE EXCEPTION 'loyalty_bounds:link_bonus' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.voucher_validity_days < s.min_voucher_validity_days
     OR NEW.voucher_validity_days > s.max_voucher_validity_days THEN
    RAISE EXCEPTION 'loyalty_bounds:validity' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS loyalty_program_bounds ON public.loyalty_programs;
CREATE TRIGGER loyalty_program_bounds
  BEFORE INSERT OR UPDATE ON public.loyalty_programs
  FOR EACH ROW EXECUTE FUNCTION public.trg_loyalty_program_bounds();

-- ---------------------------------------------------------------------------
-- 8. Overlay RESTRICTIVE par domaine admin (calque 0302) : le staff scopé
--    hors « Commerçants »/« Finances » ne voit pas la fidélité.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rec  record;
  d    text;
  expr text;
  pol  text;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('loyalty_programs',          ARRAY['commercants','pilotage']),
      ('loyalty_card_batches',      ARRAY['commercants','pilotage']),
      ('loyalty_cards',             ARRAY['commercants','pilotage']),
      ('loyalty_card_events',       ARRAY['commercants','pilotage']),
      ('loyalty_accounts',          ARRAY['commercants','finances','pilotage']),
      ('loyalty_entries',           ARRAY['commercants','finances','pilotage']),
      ('loyalty_vouchers',          ARRAY['commercants','finances','pilotage'])
    ) AS t(tbl, doms)
  LOOP
    IF to_regclass('public.' || rec.tbl) IS NULL THEN
      CONTINUE;
    END IF;
    expr := 'NOT public.is_super_admin()';
    FOREACH d IN ARRAY rec.doms LOOP
      expr := expr || format(' OR public.admin_can(%L)', d);
    END LOOP;
    pol := rec.tbl || '_admin_scope';
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, rec.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL '
      'USING (%s) WITH CHECK (%s)',
      pol, rec.tbl, expr, expr
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 9. Kill-switch : drapeau `loyalty`, créé CACHÉ (activation au lancement
--    depuis /admin/controle — tant qu'il n'est pas « active », le trigger §7a
--    refuse tout mouvement de valeur).
-- ---------------------------------------------------------------------------
INSERT INTO public.feature_flags (key, status, title_fr, title_ar, message_fr, message_ar)
VALUES (
  'loyalty', 'hidden',
  'Fidélité', 'برنامج الولاء',
  'Le programme de fidélité arrive bientôt.',
  'برنامج الولاء قادم قريباً.'
)
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- VÉRIFICATION :
--   SELECT status FROM feature_flags WHERE key = 'loyalty';       -- hidden
--   SELECT count(*) FROM loyalty_platform_settings;               -- 1
--   INSERT INTO loyalty_entries (...) hors paire même commerçant  -- FK error
-- =============================================================================
