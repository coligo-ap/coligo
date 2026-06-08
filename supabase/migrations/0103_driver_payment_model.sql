-- =============================================================================
-- 0103 — Modèle financier complet du LIVREUR (prompt LIV-paiement, esprit Yassir)
-- =============================================================================
-- Contexte : Coligo = click-and-collect + livraison COD (Algérie). Le wallet
-- commerçant partie-double (SUM=0), les snapshots immuables dans `orders`,
-- `platform_ledger`, `order_events`, `resolve_rate()` et `delivery_ledger`
-- (0042) existent déjà. CETTE migration ÉTEND `delivery_ledger` au modèle
-- complet et NE réinvente rien.
--
-- Décisions fondateur (figées ici, mais TOUTES configurables — aucun % en dur
-- côté code applicatif) :
--   1. driver_fee_rate = 8 % sur la LIVRAISON D uniquement (plancher 10 DA,
--      plafond 10 %). Très compétitif vs Yassir (~20-25 %).
--   2. service_fee S → 100 % PLATEFORME.
--   3. Réconciliation COD : sur une commande CASH LIVRÉE, le LIVREUR est le
--      SEUL custodian du cash. Il avance (P − commission) au commerçant au
--      retrait, encaisse le client, garde (D − driver_fee) et reverse
--      (commission + S + driver_fee) à la plateforme. => le trigger commerçant
--      n'émet AUCUNE écriture pour ces commandes (sinon la plateforme
--      réclamerait sa commission deux fois). App pas encore lancée → modèle
--      propre dès le départ, zéro reprise de données.
--
-- Flux COD de référence (P=2000, comm 5 %=100, S=50, D=200,
--   driver_fee=max(10,min(200×8%,200×10%))=16, cashback=0) :
--   • avance commerçant      = P − commission            = 1900
--   • cash encaissé client   = P + S + D − cashback       = 2250
--   • le livreur garde        = D − driver_fee            =  184
--   • le livreur reverse      = commission + S + driver_fee = 166
--   • vérif 184 + 166 = 350 = commission + S + D = cash − avance  ✅
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Paramètres configurables (platform_settings — ligne unique).
--    Le driver_fee est un accord LIVREUR↔PLATEFORME : pas de surcharge par
--    commerçant (contrairement à commission/cashback). settlement_cycle global.
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS driver_fee_rate       NUMERIC(5, 4) NOT NULL DEFAULT 0.08,   -- % sur D
  ADD COLUMN IF NOT EXISTS driver_fee_cap_rate   NUMERIC(5, 4) NOT NULL DEFAULT 0.10,   -- plafond % sur D
  ADD COLUMN IF NOT EXISTS driver_fee_min_da     INTEGER       NOT NULL DEFAULT 10,     -- plancher / course
  ADD COLUMN IF NOT EXISTS driver_float_cap_da   INTEGER       NOT NULL DEFAULT 8000,   -- encours cash max
  ADD COLUMN IF NOT EXISTS driver_settlement_cycle TEXT        NOT NULL DEFAULT 'weekly'
    CHECK (driver_settlement_cycle IN ('weekly', 'monthly'));

-- ---------------------------------------------------------------------------
-- 2. Profil livreur : véhicule + coordonnées de versement (écran « Compte »).
-- ---------------------------------------------------------------------------
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS vehicle_label   TEXT,                 -- « Yamaha NMAX »
  ADD COLUMN IF NOT EXISTS vehicle_plate   TEXT,                 -- « 12345-114-16 »
  ADD COLUMN IF NOT EXISTS payout_method   TEXT,                 -- 'ccp' | 'baridimob' | 'bank'
  ADD COLUMN IF NOT EXISTS payout_details  TEXT,                 -- RIB/CCP libre
  ADD COLUMN IF NOT EXISTS joined_year     INTEGER;              -- ancienneté affichée

-- ---------------------------------------------------------------------------
-- 3. Snapshots financiers LIVREUR figés sur la commande (immuables).
--    Un changement de tarif ne doit JAMAIS affecter une commande déjà passée.
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS driver_fee_rate_applied   NUMERIC(5, 4),  -- taux figé
  ADD COLUMN IF NOT EXISTS driver_fee_da             INTEGER,        -- part Coligo sur D
  ADD COLUMN IF NOT EXISTS driver_net_da             INTEGER,        -- D − driver_fee (gain livreur)
  ADD COLUMN IF NOT EXISTS driver_owes_platform_da   INTEGER,        -- cash : à reverser
  ADD COLUMN IF NOT EXISTS driver_owes_merchant_da   INTEGER,        -- cash : avance commerçant
  ADD COLUMN IF NOT EXISTS driver_cash_collected_da  INTEGER;        -- cash : encaissé client

-- ---------------------------------------------------------------------------
-- 4. delivery_ledger : marquage des écritures réglées (rattachées à un relevé).
--    Permet de calculer l'encours (float) = écritures NON encore réglées.
-- ---------------------------------------------------------------------------
ALTER TABLE public.delivery_ledger
  ADD COLUMN IF NOT EXISTS statement_id UUID,
  ADD COLUMN IF NOT EXISTS settled_at   TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 5. driver_statements : relevés de règlement immuables (hebdo/mensuel).
--    Sens du solde : net_da > 0 → la plateforme doit au livreur (prépayé) ;
--    net_da < 0 → le livreur doit reverser (COD). Mirroir des payout_requests
--    commerçant.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.driver_statements (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id                UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  period_start             DATE NOT NULL,
  period_end               DATE NOT NULL,
  deliveries_count         INTEGER NOT NULL DEFAULT 0,
  gross_driver_da          INTEGER NOT NULL DEFAULT 0,   -- Σ driver_net (gains bruts livreur)
  commission_da            INTEGER NOT NULL DEFAULT 0,   -- Σ commissions commerçants (cash)
  service_fee_da           INTEGER NOT NULL DEFAULT 0,   -- Σ frais de service (cash)
  driver_fee_da            INTEGER NOT NULL DEFAULT 0,   -- Σ part Coligo livraison (cash)
  cashback_provisioned_da  INTEGER NOT NULL DEFAULT 0,   -- Σ cashback provisionné
  to_reverse_da            INTEGER NOT NULL DEFAULT 0,   -- Σ owes_platform (cash)
  to_receive_da            INTEGER NOT NULL DEFAULT 0,   -- Σ driver_net (prépayé)
  net_da                   INTEGER NOT NULL DEFAULT 0,   -- to_receive − to_reverse
  direction                TEXT NOT NULL DEFAULT 'settled'
    CHECK (direction IN ('reverse', 'receive', 'settled')),
  status                   TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'due', 'paid')),
  method                   TEXT,                          -- ccp | baridimob | bank
  details                  TEXT,
  due_at                   TIMESTAMPTZ,
  settled_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT driver_statements_period_unique UNIQUE (driver_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_driver_statements_driver
  ON public.driver_statements (driver_id, period_end DESC);

ALTER TABLE public.delivery_ledger
  DROP CONSTRAINT IF EXISTS delivery_ledger_statement_fk;
ALTER TABLE public.delivery_ledger
  ADD CONSTRAINT delivery_ledger_statement_fk
  FOREIGN KEY (statement_id) REFERENCES public.driver_statements(id) ON DELETE SET NULL;

ALTER TABLE public.driver_statements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "driver_statements_driver_select" ON public.driver_statements;
CREATE POLICY "driver_statements_driver_select"
  ON public.driver_statements FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.drivers d
            WHERE d.id = driver_statements.driver_id AND d.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "driver_statements_admin_all" ON public.driver_statements;
CREATE POLICY "driver_statements_admin_all"
  ON public.driver_statements FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 6. Génération des écritures LIVREUR à la complétion — MODÈLE COMPLET.
--    Remplace la version simplifiée de 0042 (qui attribuait 100 % de D au
--    livreur et owes_platform = 0).
--    Idempotency : UNIQUE (order_id, type) — rejouer ne re-crée rien.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_delivery_ledger_on_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s               public.platform_settings%ROWTYPE;
  v_products_da     INTEGER;   -- P (net produits après promo)
  v_comm_rate       NUMERIC(5, 4);
  v_cashback_rate   NUMERIC(5, 4);
  v_commission      INTEGER;
  v_service_fee     INTEGER;   -- S
  v_delivery_fee    INTEGER;   -- D
  v_driver_fee      INTEGER;
  v_driver_net      INTEGER;   -- D − driver_fee
  v_cashback        INTEGER;
  v_owes_merchant   INTEGER;   -- P − commission
  v_owes_platform   INTEGER;   -- commission + S + driver_fee − cashback
BEGIN
  IF NOT (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed'
          AND NEW.fulfillment_type = 'delivery'
          AND NEW.delivery_driver_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_s FROM public.platform_settings WHERE id = true;

  -- Bases (mêmes conventions que le trigger commerçant 0077).
  v_products_da  := GREATEST(0, COALESCE(NEW.net_total_da, NEW.subtotal_da - NEW.discount_da));
  v_service_fee  := COALESCE(NEW.service_fee_da, 0);
  v_delivery_fee := COALESCE(NEW.delivery_fee_da, 0);

  IF NEW.payment_method = 'cash' THEN
    v_comm_rate     := public.resolve_rate(NEW.merchant_id, 'commission_cash');
    v_cashback_rate := public.resolve_rate(NEW.merchant_id, 'cashback_cash');
  ELSE
    v_comm_rate     := public.resolve_rate(NEW.merchant_id, 'commission_online');
    v_cashback_rate := public.resolve_rate(NEW.merchant_id, 'cashback_online');
  END IF;

  v_commission := round(v_products_da * v_comm_rate)::INTEGER;

  -- driver_fee = max(min, min(D×rate, D×cap)), borné par D ; 0 si D = 0.
  IF v_delivery_fee <= 0 THEN
    v_driver_fee := 0;
  ELSE
    v_driver_fee := LEAST(
      v_delivery_fee,
      GREATEST(
        v_s.driver_fee_min_da,
        LEAST(round(v_delivery_fee * v_s.driver_fee_rate)::INTEGER,
              round(v_delivery_fee * v_s.driver_fee_cap_rate)::INTEGER)
      )
    );
  END IF;
  v_driver_net := v_delivery_fee - v_driver_fee;

  -- Snapshots immuables sur la commande (figés au tarif du jour).
  UPDATE public.orders
     SET driver_fee_rate_applied   = v_s.driver_fee_rate,
         driver_fee_da             = v_driver_fee,
         driver_net_da             = v_driver_net,
         commission_rate_applied   = COALESCE(commission_rate_applied, v_comm_rate),
         commission_da             = COALESCE(commission_da, v_commission)
   WHERE id = NEW.id;

  -- Écriture commune : la part livreur (ce qu'il gagne sur la course).
  INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
  VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_payout', v_driver_net, NULL)
  ON CONFLICT (order_id, type) DO NOTHING;

  IF NEW.payment_method = 'cash' THEN
    -- cashback sur COD : 0 par défaut (cashback_cash) + garde-fou (cf. §3 prompt).
    v_cashback := round(v_products_da * v_cashback_rate)::INTEGER;
    v_cashback := LEAST(v_cashback,
                        (v_products_da / 2),                       -- ≤ 50 % de P
                        GREATEST(v_commission + v_service_fee + v_delivery_fee, 0));

    v_owes_merchant := GREATEST(v_products_da - v_commission, 0);
    v_owes_platform := GREATEST(v_commission + v_service_fee + v_driver_fee - v_cashback, 0);

    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_cash_collected', NEW.total_da, NULL)
    ON CONFLICT (order_id, type) DO NOTHING;

    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_owes_merchant', v_owes_merchant, NULL)
    ON CONFLICT (order_id, type) DO NOTHING;

    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_owes_platform', v_owes_platform, NULL)
    ON CONFLICT (order_id, type) DO NOTHING;

    UPDATE public.orders
       SET driver_owes_platform_da  = v_owes_platform,
           driver_owes_merchant_da  = v_owes_merchant,
           driver_cash_collected_da = NEW.total_da,
           cashback_rate_applied    = COALESCE(cashback_rate_applied, v_cashback_rate)
     WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- Le trigger lui-même (generate_delivery_ledger_trg) existe déjà depuis 0042
-- et pointe sur cette fonction → rien à recréer.

-- ---------------------------------------------------------------------------
-- 7. Réconciliation : sur une commande CASH LIVRÉE, le LIVREUR porte la
--    commission + S vers la plateforme. Le trigger commerçant NE DOIT PAS
--    émettre ses écritures (sinon double comptage). On l'ajuste pour SKIPPER
--    ce cas précis. (cash pickup, online pickup, online delivery → inchangés.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_wallet_entries_on_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_generate    BOOLEAN := false;
  v_comm_rate   NUMERIC(5, 4);
  v_cash_rate   NUMERIC(5, 4);
  v_fee_rate    NUMERIC(5, 4);
  v_products_da INTEGER;
  v_service_fee INTEGER;
  v_commission  INTEGER;
  v_cashback    INTEGER;
  v_chargily    INTEGER;
BEGIN
  IF NEW.payment_method = 'cash' THEN
    v_generate := (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed');
  ELSE
    v_generate := (NEW.payment_status = 'paid' AND OLD.payment_status IS DISTINCT FROM 'paid');
  END IF;

  IF NOT v_generate THEN
    RETURN NEW;
  END IF;

  -- RÉCONCILIATION LIVRAISON COD : le livreur est le seul custodian du cash.
  -- Il reverse commission + S à la plateforme via `delivery_ledger`. On ne
  -- crée donc AUCUNE écriture commerçant/plateforme ici (le commerçant a été
  -- payé en espèces P − commission au retrait par le livreur).
  IF NEW.payment_method = 'cash'
     AND NEW.fulfillment_type = 'delivery'
     AND NEW.delivery_driver_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_method = 'cash' THEN
    v_comm_rate := public.resolve_rate(NEW.merchant_id, 'commission_cash');
    v_cash_rate := public.resolve_rate(NEW.merchant_id, 'cashback_cash');
    v_fee_rate  := 0;
  ELSE
    v_comm_rate := public.resolve_rate(NEW.merchant_id, 'commission_online');
    v_cash_rate := public.resolve_rate(NEW.merchant_id, 'cashback_online');
    v_fee_rate  := public.resolve_rate(NEW.merchant_id, 'chargily_fee');
  END IF;

  v_products_da := GREATEST(0, COALESCE(NEW.net_total_da, NEW.subtotal_da - NEW.discount_da));
  v_service_fee := COALESCE(NEW.service_fee_da, 0);
  v_commission  := round(v_products_da * v_comm_rate)::INTEGER;
  v_cashback    := round(v_products_da * v_cash_rate)::INTEGER;
  v_chargily    := round(NEW.total_da * v_fee_rate)::INTEGER;

  UPDATE public.orders
  SET commission_rate_applied   = v_comm_rate,
      cashback_rate_applied     = v_cash_rate,
      chargily_fee_rate_applied = v_fee_rate,
      commission_da             = v_commission
  WHERE id = NEW.id;

  IF NEW.payment_method = 'online' THEN
    INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da)
    VALUES (NEW.merchant_id, NEW.id, 'sale', v_products_da)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da, commission_rate)
  VALUES (NEW.merchant_id, NEW.id, 'commission', -v_commission, v_comm_rate)
  ON CONFLICT (order_id, type) DO NOTHING;

  IF NEW.payment_method = 'cash' AND v_service_fee > 0 THEN
    INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.merchant_id, NEW.id, 'service_fee', -v_service_fee,
            'Frais de service encaissés en espèces — à reverser à Coligo.')
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  INSERT INTO public.platform_ledger (order_id, type, amount_da)
  VALUES (NEW.id, 'commission_income', v_commission)
  ON CONFLICT (order_id, type) DO NOTHING;

  IF v_service_fee > 0 THEN
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NEW.id, 'service_fee_income', v_service_fee)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  IF NEW.payment_method = 'online' THEN
    IF v_chargily > 0 THEN
      INSERT INTO public.platform_ledger (order_id, type, amount_da)
      VALUES (NEW.id, 'chargily_fee', -v_chargily)
      ON CONFLICT (order_id, type) DO NOTHING;
    END IF;
    IF v_cashback > 0 THEN
      INSERT INTO public.platform_ledger (order_id, type, amount_da)
      VALUES (NEW.id, 'cashback_expense', -v_cashback)
      ON CONFLICT (order_id, type) DO NOTHING;
      INSERT INTO public.cashback_grants (order_id, customer_phone, customer_id, amount_da)
      VALUES (NEW.id, NEW.customer_phone, NEW.customer_id, v_cashback)
      ON CONFLICT (order_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Encours cash (float) du livreur = écritures NON encore réglées.
--    = Σ owes_platform (cash dû) − Σ driver_payout des commandes PRÉPAYÉES
--      (que la plateforme doit au livreur). On borne à >= 0.
--    Utilisé par le garde-fou d'acceptation (driver_can_accept).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_outstanding(p_driver_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(0, COALESCE(
    SUM(CASE WHEN dl.type = 'driver_owes_platform' THEN dl.amount_da
             WHEN dl.type = 'driver_payout' AND o.payment_method = 'online' THEN -dl.amount_da
             ELSE 0 END), 0))::INTEGER
  FROM public.delivery_ledger dl
  LEFT JOIN public.orders o ON o.id = dl.order_id
  WHERE dl.driver_id = p_driver_id
    AND dl.settled_at IS NULL;
$$;

-- Garde-fou : un livreur peut accepter une course si NON gelé ET encours < plafond.
CREATE OR REPLACE FUNCTION public.driver_can_accept(p_driver_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_frozen BOOLEAN;
  v_cap    INTEGER;
BEGIN
  SELECT is_frozen INTO v_frozen FROM public.drivers WHERE id = p_driver_id;
  IF v_frozen THEN RETURN false; END IF;
  SELECT driver_float_cap_da INTO v_cap FROM public.platform_settings WHERE id = true;
  RETURN public.driver_outstanding(p_driver_id) < COALESCE(v_cap, 8000);
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_outstanding(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_can_accept(UUID)  TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. driver-settlement-run : génère les relevés immuables d'une période.
--    Idempotent : UNIQUE (driver_id, period_start, period_end) + on ne traite
--    que les écritures NON réglées (settled_at IS NULL). Appelée par le cron
--    `/api/cron/driver-payouts` selon driver_settlement_cycle.
--    Renvoie le nombre de relevés créés.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_driver_statements(
  p_period_start DATE,
  p_period_end   DATE
)
RETURNS TABLE (statements_created INTEGER, drivers_total INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_created INTEGER := 0;
  v_total   INTEGER := 0;
  r         RECORD;
  v_stmt_id UUID;
  v_due     TIMESTAMPTZ;
BEGIN
  -- Échéance = fin de période + 2 jours (J+2) à 23:59.
  v_due := (p_period_end + INTERVAL '2 day')::date + TIME '23:59';

  FOR r IN
    SELECT
      dl.driver_id                                                            AS driver_id,
      COUNT(DISTINCT dl.order_id)                                             AS deliveries_count,
      COALESCE(SUM(CASE WHEN dl.type = 'driver_payout'
                        THEN dl.amount_da ELSE 0 END), 0)                     AS gross_driver_da,
      COALESCE(SUM(CASE WHEN dl.type = 'driver_payout' AND o.payment_method = 'online'
                        THEN dl.amount_da ELSE 0 END), 0)                     AS to_receive_da,
      COALESCE(SUM(CASE WHEN dl.type = 'driver_owes_platform'
                        THEN dl.amount_da ELSE 0 END), 0)                     AS to_reverse_da,
      COALESCE(SUM(CASE WHEN dl.type = 'driver_owes_platform'
                        THEN COALESCE(o.commission_da, 0) ELSE 0 END), 0)     AS commission_da,
      COALESCE(SUM(CASE WHEN dl.type = 'driver_owes_platform'
                        THEN COALESCE(o.service_fee_da, 0) ELSE 0 END), 0)    AS service_fee_da,
      COALESCE(SUM(CASE WHEN dl.type = 'driver_owes_platform'
                        THEN COALESCE(o.driver_fee_da, 0) ELSE 0 END), 0)     AS driver_fee_da
    FROM public.delivery_ledger dl
    LEFT JOIN public.orders o ON o.id = dl.order_id
    WHERE dl.settled_at IS NULL
      AND dl.created_at >= p_period_start
      AND dl.created_at <  (p_period_end + INTERVAL '1 day')
    GROUP BY dl.driver_id
  LOOP
    v_total := v_total + 1;

    INSERT INTO public.driver_statements (
      driver_id, period_start, period_end, deliveries_count,
      gross_driver_da, commission_da, service_fee_da, driver_fee_da,
      to_reverse_da, to_receive_da, net_da, direction, status, due_at,
      method, details
    )
    SELECT
      r.driver_id, p_period_start, p_period_end, r.deliveries_count,
      r.gross_driver_da, r.commission_da, r.service_fee_da, r.driver_fee_da,
      r.to_reverse_da, r.to_receive_da,
      (r.to_receive_da - r.to_reverse_da),
      CASE WHEN (r.to_receive_da - r.to_reverse_da) > 0 THEN 'receive'
           WHEN (r.to_receive_da - r.to_reverse_da) < 0 THEN 'reverse'
           ELSE 'settled' END,
      CASE WHEN (r.to_receive_da - r.to_reverse_da) = 0 THEN 'paid' ELSE 'due' END,
      v_due,
      d.payout_method, d.payout_details
    FROM public.drivers d
    WHERE d.id = r.driver_id
    ON CONFLICT (driver_id, period_start, period_end) DO NOTHING
    RETURNING id INTO v_stmt_id;

    IF v_stmt_id IS NOT NULL THEN
      v_created := v_created + 1;
      -- Rattacher + régler les écritures de la période.
      UPDATE public.delivery_ledger
         SET statement_id = v_stmt_id, settled_at = now()
       WHERE driver_id = r.driver_id
         AND settled_at IS NULL
         AND created_at >= p_period_start
         AND created_at <  (p_period_end + INTERVAL '1 day');
    END IF;
    v_stmt_id := NULL;
  END LOOP;

  RETURN QUERY SELECT v_created, v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_driver_statements(DATE, DATE) TO service_role;
