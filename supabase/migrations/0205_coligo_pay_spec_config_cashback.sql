-- =============================================================================
-- 0205 — Conformité SPEC-COLIGO-PAY : config manquante + assiette cashback unifiée
-- =============================================================================
-- Référence : SPEC-COLIGO-PAY.md (chapitres 1, 4, 9.4, 7, 0.10).
--
-- 1) CONFIG (ch.1) — `platform_settings` EST la table de config unique du ch.1
--    (ligne unique, éditable super-admin). On ajoute les clés manquantes :
--      • tour_discount_rate            (ch.9.4 — réduction tournée vs express)
--      • cashback_consumption_estimate (ch.1 — reporting seulement)
--      • sub_priority_monthly_da       (ch.7 — abo Prioritaire chauffeur+livreur)
--      • sub_priority_first_month_da   (ch.7 — promo 1er mois)
--      • withdrawal_fee_tiers          (ch.6.2 — paliers retrait agent/Coligo)
--      • p2p_enabled                   (ch.0.10 — P2P désactivé au lancement)
--
-- 2) CASHBACK (ch.4) — assiette CENTRALISÉE dans compute_order_cashback_da() :
--      • ch.4.2 assiette = produits NETS + frais de LIVRAISON (jamais le frais
--        de service = marge pure Coligo).
--      • ch.4.1 anti-boucle (RÈGLE LA PLUS IMPORTANTE) : on retire la part déjà
--        réglée DEPUIS le solde cashback (le topup/Coligo Pay = argent neuf, reste
--        éligible). Le cashback dépensé ne régénère JAMAIS de cashback.
--      • Plafond COD inchangé (solvabilité plateforme) + tournée → commission outil.
--    Les TROIS sites de calcul (crédit client, charge plateforme online/tournée,
--    charge plateforme COD express) appellent désormais la MÊME fonction → plus
--    aucune dérive possible entre eux (corrige aussi un écart latent en TOURNÉE
--    COD où le plafond crédit ≠ plafond charge).
--
-- 3) TOURNÉE (ch.9.4) — défaut des bandes de prix tournée = ~40% sous le barème
--    express (tour_discount_rate), toujours clampé ≤ express par le trigger 0119.
--
-- SUM=0 préservé par construction : le cashban GAGNÉ est toujours symétrique
-- plateforme(−)/client(+) ; changer son montant ne déséquilibre aucun groupe.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Clés de config manquantes (ch.1)
-- ----------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS tour_discount_rate            NUMERIC(5, 4) NOT NULL DEFAULT 0.40,
  ADD COLUMN IF NOT EXISTS cashback_consumption_estimate NUMERIC(5, 4) NOT NULL DEFAULT 0.70,
  ADD COLUMN IF NOT EXISTS sub_priority_monthly_da       INTEGER       NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS sub_priority_first_month_da   INTEGER       NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS withdrawal_fee_tiers          JSONB         NOT NULL DEFAULT
    '[{"up_to": 5000, "fee_agent": 50, "fee_coligo": 0}, {"up_to": 20000, "fee_agent": 100, "fee_coligo": 20}, {"up_to": null, "fee_agent": 200, "fee_coligo": 50}]'::jsonb,
  ADD COLUMN IF NOT EXISTS p2p_enabled                   BOOLEAN       NOT NULL DEFAULT false;

-- ----------------------------------------------------------------------------
-- 2. Fonction canonique du cashback gagné (ch.4) — source unique de vérité.
--    Reçoit la ligne orders (NEW dans les triggers).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_order_cashback_da(o public.orders)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_products   INTEGER;
  v_delivery   INTEGER;
  v_service    INTEGER;
  v_cash_rate  NUMERIC(5, 4);
  v_comm_rate  NUMERIC(5, 4);
  v_commission INTEGER;
  v_eligible   INTEGER;
  v_base       INTEGER;
  v_amount     INTEGER;
  v_is_tour    BOOLEAN;
  v_tour_rate  NUMERIC(5, 4);
  v_tour_comm  INTEGER := 0;
BEGIN
  -- Kill-switch super-admin : aucun cashback si la feature est coupée.
  IF public.feature_blocked('cashback') THEN
    RETURN 0;
  END IF;

  v_products := GREATEST(0, COALESCE(o.net_total_da, o.subtotal_da - o.discount_da));
  v_delivery := COALESCE(o.delivery_fee_da, 0);
  v_service  := COALESCE(o.service_fee_da, 0);

  IF o.payment_method = 'cash' THEN
    v_cash_rate := public.resolve_rate(o.merchant_id, 'cashback_cash');
    v_comm_rate := public.resolve_rate(o.merchant_id, 'commission_cash');
  ELSE
    v_cash_rate := public.resolve_rate(o.merchant_id, 'cashback_online');
    v_comm_rate := public.resolve_rate(o.merchant_id, 'commission_online');
  END IF;

  -- ch.4.2 — Assiette = produits NETS (après promo) + frais de LIVRAISON.
  --          JAMAIS le frais de service (marge pure Coligo).
  -- ch.4.1 — Anti-boucle : on retire la part réglée DEPUIS le solde cashback.
  --          Le topup/Coligo Pay (argent neuf) reste éligible.
  v_eligible := v_products + v_delivery;
  v_base     := GREATEST(0, v_eligible - GREATEST(0, COALESCE(o.cashback_used_da, 0)));
  v_amount   := round(v_base * v_cash_rate)::INTEGER;

  v_is_tour := (o.fulfillment_type = 'delivery' AND o.delivery_mode = 'tour');
  IF v_is_tour AND v_delivery > 0 THEN
    SELECT tour_delivery_commission_rate INTO v_tour_rate
      FROM public.platform_settings WHERE id = true;
    v_tour_comm := round(v_delivery * COALESCE(v_tour_rate, 0))::INTEGER;
  END IF;

  -- ch.4.4 — En COD la plateforme ABSORBE le cashback (réduction de
  -- driver_owes_platform) : plafonner à ce que Coligo encaisse réellement, sinon
  -- elle accorde plus de cashback qu'elle ne perçoit. En TOURNÉE le commerçant
  -- garde D et ne reverse que la commission outil → c'est ELLE qui borne.
  IF o.payment_method = 'cash' THEN
    v_commission := round(v_products * v_comm_rate)::INTEGER;
    v_amount := LEAST(
      v_amount,
      (v_products / 2),
      GREATEST(v_commission + v_service +
               CASE WHEN v_is_tour THEN v_tour_comm ELSE v_delivery END, 0)
    );
  END IF;

  -- Échec de livraison → aucun cashback.
  IF o.delivery_failed_at IS NOT NULL THEN
    v_amount := 0;
  END IF;

  RETURN GREATEST(0, v_amount);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.compute_order_cashback_da(public.orders) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Crédit client (cashback gagné) → délègue l'assiette à la fonction canonique.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_customer_cashback_on_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_amount INTEGER;
BEGIN
  IF NOT (NEW.status = 'completed'
          AND OLD.status IS DISTINCT FROM 'completed'
          AND NEW.customer_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  -- ch.4 — assiette / anti-boucle / kill-switch centralisés.
  v_amount := public.compute_order_cashback_da(NEW);

  IF v_amount > 0 THEN
    INSERT INTO public.customer_wallet_entries
      (customer_id, order_id, type, source, amount_da)
    VALUES
      (NEW.customer_id, NEW.id, 'cashback_earned', 'cashback', v_amount)
    ON CONFLICT (order_id, type) DO NOTHING;

    -- Snapshot RÉEL versé (source de vérité pour la compta/affichage).
    UPDATE public.orders SET cashback_da = v_amount WHERE id = NEW.id;

    UPDATE public.cashback_grants
       SET status      = 'granted',
           customer_id = COALESCE(customer_id, NEW.customer_id)
     WHERE order_id = NEW.id
       AND status   = 'pending';
  END IF;

  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. Charge plateforme (online + tournée) → même assiette canonique.
--    Seul le calcul du cashback change ; tout le reste est identique à l'existant.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_wallet_entries_on_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_generate     BOOLEAN := false;
  v_comm_rate    NUMERIC(5, 4);
  v_cash_rate    NUMERIC(5, 4);
  v_fee_rate     NUMERIC(5, 4);
  v_products_da  INTEGER;
  v_service_fee  INTEGER;
  v_commission   INTEGER;
  v_cashback     INTEGER;
  v_chargily     INTEGER;
  v_is_tour      BOOLEAN;
  v_delivery_fee INTEGER;
  v_tour_rate    NUMERIC(5, 4);
  v_tour_comm    INTEGER := 0;
  v_redeemed     INTEGER;
BEGIN
  v_generate := (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed');

  IF NOT v_generate
     AND NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled'
     AND NEW.delivery_failed_at IS NOT NULL
     AND NEW.payment_method <> 'cash' THEN
    v_generate := true;
  END IF;

  IF v_generate AND NEW.payment_method <> 'cash'
     AND NEW.payment_status <> 'paid' THEN
    v_generate := false;
  END IF;

  IF NOT v_generate THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_method = 'cash'
     AND NEW.fulfillment_type = 'delivery'
     AND NEW.delivery_driver_id IS NOT NULL
     AND NEW.delivery_mode = 'express' THEN
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
  v_delivery_fee := COALESCE(NEW.delivery_fee_da, 0);
  v_commission  := round(v_products_da * v_comm_rate)::INTEGER;
  v_chargily    := round(NEW.total_da * v_fee_rate)::INTEGER;
  v_redeemed    := GREATEST(0, COALESCE(NEW.cashback_used_da, 0) + COALESCE(NEW.topup_used_da, 0));

  -- Commission tournée (utilisée par les écritures wallet/ledger plus bas).
  v_is_tour := (NEW.fulfillment_type = 'delivery' AND NEW.delivery_mode = 'tour');
  IF v_is_tour AND v_delivery_fee > 0 THEN
    SELECT tour_delivery_commission_rate INTO v_tour_rate FROM public.platform_settings WHERE id = true;
    v_tour_comm := round(v_delivery_fee * COALESCE(v_tour_rate, 0))::INTEGER;
  END IF;

  -- ch.4 — assiette / anti-boucle / plafond COD centralisés.
  v_cashback := public.compute_order_cashback_da(NEW);

  UPDATE public.orders
  SET commission_rate_applied              = v_comm_rate,
      cashback_rate_applied                = v_cash_rate,
      chargily_fee_rate_applied            = v_fee_rate,
      commission_da                        = v_commission,
      tour_delivery_commission_rate_applied= CASE WHEN v_is_tour THEN COALESCE(v_tour_rate, 0) ELSE tour_delivery_commission_rate_applied END,
      tour_delivery_commission_da          = CASE WHEN v_is_tour THEN v_tour_comm ELSE tour_delivery_commission_da END
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

  IF NEW.payment_method = 'cash' AND v_redeemed > 0 THEN
    INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.merchant_id, NEW.id, 'wallet_redemption', v_redeemed,
            'Cashback / Coligo Pay du client, reversé par Coligo.')
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  IF v_is_tour THEN
    IF NEW.payment_method = 'online' AND v_delivery_fee > 0 THEN
      INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da, note)
      VALUES (NEW.merchant_id, NEW.id, 'delivery_revenue', v_delivery_fee,
              'Frais de livraison tournée encaissés pour votre compte.')
      ON CONFLICT (order_id, type) DO NOTHING;
    END IF;
    IF v_tour_comm > 0 THEN
      INSERT INTO public.wallet_entries (merchant_id, order_id, type, amount_da, note)
      VALUES (NEW.merchant_id, NEW.id, 'tour_delivery_commission', -v_tour_comm,
              'Commission Coligo sur la livraison tournée.')
      ON CONFLICT (order_id, type) DO NOTHING;
    END IF;
  END IF;

  INSERT INTO public.platform_ledger (order_id, type, amount_da)
  VALUES (NEW.id, 'commission_income', v_commission)
  ON CONFLICT (order_id, type) DO NOTHING;

  IF v_service_fee > 0 THEN
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NEW.id, 'service_fee_income', v_service_fee)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  IF v_tour_comm > 0 THEN
    INSERT INTO public.platform_ledger (order_id, type, amount_da)
    VALUES (NEW.id, 'tour_delivery_commission_income', v_tour_comm)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;

  IF NEW.payment_method = 'online' AND v_chargily > 0 THEN
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

  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 5. Charge plateforme COD express (custodian) → même assiette canonique.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_delivery_ledger_on_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_s               public.platform_settings%ROWTYPE;
  v_products_da     INTEGER;
  v_comm_rate       NUMERIC(5, 4);
  v_cashback_rate   NUMERIC(5, 4);
  v_commission      INTEGER;
  v_service_fee     INTEGER;
  v_delivery_fee    INTEGER;
  v_driver_fee      INTEGER;
  v_driver_net      INTEGER;
  v_cashback        INTEGER;   -- cashback GAGNÉ (provisionné en charge)
  v_redeemed        INTEGER;   -- cashback + Coligo Pay DÉPENSÉS par le client
  v_owes_merchant   INTEGER;
  v_owes_platform   INTEGER;   -- SIGNÉ
BEGIN
  -- Custodian = EXPRESS uniquement (la tournée passe par le wallet commerçant).
  IF NOT (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed'
          AND NEW.fulfillment_type = 'delivery'
          AND NEW.delivery_driver_id IS NOT NULL
          AND NEW.delivery_mode = 'express') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_s FROM public.platform_settings WHERE id = true;

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

  UPDATE public.orders
     SET driver_fee_rate_applied = v_s.driver_fee_rate,
         driver_fee_da           = v_driver_fee,
         driver_net_da           = v_driver_net,
         commission_rate_applied = COALESCE(commission_rate_applied, v_comm_rate),
         commission_da           = COALESCE(commission_da, v_commission)
   WHERE id = NEW.id;

  INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
  VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_payout', v_driver_net, NULL)
  ON CONFLICT (order_id, type) DO NOTHING;

  IF NEW.payment_method = 'cash' THEN
    -- ch.4 — cashback GAGNÉ via la fonction canonique (même montant que le crédit
    -- client → réconciliation parfaite).
    v_cashback := public.compute_order_cashback_da(NEW);

    -- Wallet DÉPENSÉ par le client (cashback + Coligo Pay) : réduit le cash encaissé
    -- ET ce que le livreur reverse (absorbé par la plateforme).
    v_redeemed := GREATEST(0, COALESCE(NEW.cashback_used_da, 0) + COALESCE(NEW.topup_used_da, 0));

    v_owes_merchant := GREATEST(v_products_da - v_commission, 0);
    -- SIGNÉ : peut être négatif = la plateforme doit au livreur (réglé au relevé).
    v_owes_platform := v_commission + v_service_fee + v_driver_fee - v_redeemed;

    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_cash_collected', NEW.total_da, NULL)
    ON CONFLICT (order_id, type) DO NOTHING;

    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_owes_merchant', v_owes_merchant, NULL)
    ON CONFLICT (order_id, type) DO NOTHING;

    INSERT INTO public.delivery_ledger (driver_id, merchant_id, order_id, type, amount_da, note)
    VALUES (NEW.delivery_driver_id, NEW.merchant_id, NEW.id, 'driver_owes_platform', v_owes_platform, NULL)
    ON CONFLICT (order_id, type) DO NOTHING;

    -- Charge cashback plateforme (en COD le trigger wallet est skip → c'est ici).
    IF v_cashback > 0 THEN
      INSERT INTO public.platform_ledger (order_id, type, amount_da)
      VALUES (NEW.id, 'cashback_expense', -v_cashback)
      ON CONFLICT (order_id, type) DO NOTHING;
    END IF;

    UPDATE public.orders
       SET driver_owes_platform_da  = v_owes_platform,
           driver_owes_merchant_da  = v_owes_merchant,
           driver_cash_collected_da = NEW.total_da,
           cashback_rate_applied    = COALESCE(cashback_rate_applied, v_cashback_rate)
     WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 6. TOURNÉE (ch.9.4) — défaut des bandes = ~40% sous le barème express
--    (tour_discount_rate). Le trigger 0119 clampe toujours [delivery_min, barème].
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_merchant_delivery_zones(p_merchant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_disc NUMERIC(5, 4);
BEGIN
  SELECT tour_discount_rate INTO v_disc FROM public.platform_settings WHERE id = true;
  v_disc := COALESCE(v_disc, 0);

  INSERT INTO public.merchant_delivery_zones (merchant_id, band_index, max_km, price_da)
  VALUES
    (p_merchant_id, 0, 3.0,  round(public.platform_delivery_fee_da(3.0)  * (1 - v_disc))::INTEGER),
    (p_merchant_id, 1, 6.0,  round(public.platform_delivery_fee_da(6.0)  * (1 - v_disc))::INTEGER),
    (p_merchant_id, 2, 10.0, round(public.platform_delivery_fee_da(10.0) * (1 - v_disc))::INTEGER)
  ON CONFLICT (merchant_id, band_index) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_merchant_delivery_zones(UUID) TO authenticated;
