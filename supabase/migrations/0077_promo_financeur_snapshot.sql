-- =============================================================================
-- 0077 — Promos PARTIE B : financeur + snapshot immuable + commission sur NET
-- =============================================================================
-- Règles métier validées (cf. PARTIE B) :
--   - TOUTE promo est financée par le COMMERÇANT pour l'instant (la plateforme
--     ne perd rien). On garde un champ `financeur` (platform|merchant) défaut
--     'merchant', mais AUCUNE logique « platform » n'est codée.
--   - La commission Coligo se calcule TOUJOURS sur le montant APRÈS promo
--     (le net). On le rend EXPLICITE via orders.net_total_da (base figée), au
--     lieu de dépendre d'un calcul subtotal − discount sensible aux conventions
--     d'affichage.
--   - Snapshot immuable par commande : prix AVANT promo (gross_total_da), prix
--     APRÈS promo (net_total_da), financeur (promo_financeur). La réduction se
--     déduit (gross − net) et la commission figée reste commission_da.
--   - Aucun mouvement de wallet/ledger n'est créé par une promo : elle baisse
--     seulement la base. L'invariant SUM=0 du grand livre est donc préservé.
-- =============================================================================

-- 1) Financeur sur les promotions (défaut MERCHANT ; pas de logique plateforme).
ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS financeur TEXT NOT NULL DEFAULT 'merchant';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'promotions_financeur_check'
  ) THEN
    ALTER TABLE public.promotions
      ADD CONSTRAINT promotions_financeur_check
      CHECK (financeur IN ('platform', 'merchant'));
  END IF;
END $$;

-- 2) Snapshot immuable sur la commande.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS promo_financeur TEXT,            -- qui a financé (snapshot)
  ADD COLUMN IF NOT EXISTS gross_total_da   INTEGER,        -- prix produits AVANT promo
  ADD COLUMN IF NOT EXISTS net_total_da     INTEGER;        -- prix produits APRÈS promo (base commission)

-- 3) La complétion calcule la commission/cashback sur le NET explicite.
--    COALESCE → fallback sur l'ancien calcul pour les commandes déjà créées
--    (avant cette migration, net_total_da est NULL ; subtotal − discount y
--    valait déjà le net car aucune promo n'existait → zéro régression).
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

  IF NEW.payment_method = 'cash' THEN
    v_comm_rate := public.resolve_rate(NEW.merchant_id, 'commission_cash');
    v_cash_rate := public.resolve_rate(NEW.merchant_id, 'cashback_cash');
    v_fee_rate  := 0;
  ELSE
    v_comm_rate := public.resolve_rate(NEW.merchant_id, 'commission_online');
    v_cash_rate := public.resolve_rate(NEW.merchant_id, 'cashback_online');
    v_fee_rate  := public.resolve_rate(NEW.merchant_id, 'chargily_fee');
  END IF;

  -- products_da = base commission/cashback = montant produits APRÈS promo (NET),
  -- explicitement figé à la création. Exclut service_fee, livraison, wallets.
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

  -- WALLET COMMERÇANT.
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

  -- COMPTA COLIGO.
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
