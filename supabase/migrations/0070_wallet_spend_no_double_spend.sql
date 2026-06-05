-- =============================================================================
-- 0070 — Anti double-dépense wallet (cashback + topup) : verrou par client
-- =============================================================================
-- ⚠️ ARGENT RÉEL. Les triggers de dépense (0017 cashback, 0019 topup) lisent le
-- solde via SUM() puis refusent si insuffisant. Sous l'isolation par défaut de
-- Postgres (READ COMMITTED), deux commandes SIMULTANÉES du même client lisent
-- toutes deux l'ancien solde AVANT que l'une ait écrit son débit → les deux
-- passent le garde-fou → le solde devient NÉGATIF (double-dépense).
--
-- Correctif : un VERROU TRANSACTIONNEL CONSULTATIF par client, pris avant la
-- lecture du solde. La 2e transaction concurrente attend la 1re, relit le solde
-- à jour, et refuse correctement la sur-dépense. Le verrou est relâché à la fin
-- de la transaction (COMMIT ou ROLLBACK), donc aucun risque de blocage durable.
-- Clé commune cashback/topup (même client) → sérialisation simple ; le verrou
-- consultatif est ré-entrant dans une même transaction (un ordre qui dépense
-- cashback PUIS topup le prend deux fois sans interblocage).
-- =============================================================================

-- --- Cashback (remplace la fonction de 0017, le trigger reste attaché) -------
CREATE OR REPLACE FUNCTION public.spend_customer_cashback_on_order_create()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  IF NEW.customer_id IS NOT NULL AND NEW.cashback_used_da > 0 THEN
    -- Sérialise les dépenses concurrentes du MÊME client (anti double-spend).
    PERFORM pg_advisory_xact_lock(hashtext('cwe_spend:' || NEW.customer_id::text));

    SELECT public.customer_cashback_balance(NEW.customer_id) INTO v_balance;
    IF v_balance < NEW.cashback_used_da THEN
      RAISE EXCEPTION
        'Solde cashback insuffisant (% DA disponible, % DA demandé).',
        v_balance, NEW.cashback_used_da
        USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.customer_wallet_entries
      (customer_id, order_id, type, source, amount_da)
    VALUES
      (NEW.customer_id, NEW.id, 'cashback_spent', 'cashback',
       -NEW.cashback_used_da)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- --- Topup / Coligo Pay (remplace la fonction de 0019) -----------------------
CREATE OR REPLACE FUNCTION public.spend_customer_topup_on_order_create()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  IF NEW.customer_id IS NOT NULL AND NEW.topup_used_da > 0 THEN
    -- Même verrou par client que le cashback (sérialise toutes les dépenses
    -- wallet du client).
    PERFORM pg_advisory_xact_lock(hashtext('cwe_spend:' || NEW.customer_id::text));

    SELECT public.customer_topup_balance(NEW.customer_id) INTO v_balance;
    IF v_balance < NEW.topup_used_da THEN
      RAISE EXCEPTION
        'Solde Coligo Pay insuffisant (% DA disponible, % DA demandé).',
        v_balance, NEW.topup_used_da
        USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.customer_wallet_entries
      (customer_id, order_id, type, source, amount_da)
    VALUES
      (NEW.customer_id, NEW.id, 'topup_spent', 'topup', -NEW.topup_used_da)
    ON CONFLICT (order_id, type) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
