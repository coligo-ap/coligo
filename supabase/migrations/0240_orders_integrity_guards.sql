-- =============================================================================
-- 0240 — Garde d'INTÉGRITÉ orders : INSERT forgé + transitions d'état illégales
-- =============================================================================
-- FAILLE (audit 2026-06-22, findings F-1 / C-1) :
--   La policy RLS INSERT `orders_insert_own_customer` (0016) ne contraint que
--   `customer_id`. Aucun des triggers BEFORE INSERT existants (0182 feature
--   gate, 0169 zones, 0164 capacité, 0186 wallet) ne réinitialise les colonnes
--   d'intégrité. Un client possède son JWT `authenticated` et peut POSTer
--   directement sur /rest/v1/orders :
--     • payment_status='paid' sur une commande online jamais encaissée → la
--       commande devient visible/validable (0068) et génère des écritures de
--       complétion SANS argent réel (vol — F-1, CRITIQUE) ;
--     • status='completed'/'ready' d'emblée → saute le cycle.
--   Et côté UPDATE : la machine à états (`ALLOWED_TRANSITIONS`, lib/types.ts)
--   n'est appliquée QUE dans la Server Action commerçant. Le trigger 0166 ne
--   protège que les colonnes financières, PAS `status`. Un commerçant peut
--   forcer `status='completed'` via PostgREST → déclenche les triggers de
--   complétion (crédit wallet cash, payout livreur) sur une commande jamais
--   préparée/récupérée (C-1, CRITIQUE).
--
-- CORRECTIF (bypass-proof, au niveau DB) :
--   1. BEFORE INSERT : pour les rôles de connexion PostgREST
--      (`authenticated`/`anon`), force les colonnes d'intégrité aux valeurs
--      sûres que la Server Action légitime pose de toute façon (status/
--      payment_status='pending', commission/cashback=0, order_number/pickup_code
--      NULL → régénérés, delivery_driver_id NULL). Les fonctions internes
--      (SECURITY DEFINER, owner=postgres → current_user='postgres') et le
--      service_role (webhook Chargily) passent INTACTES.
--   2. BEFORE UPDATE : enforce la table de transitions légale et RÉSERVE la
--      complétion d'une livraison au RPC `validate_delivery` (DEFINER) — un
--      commerçant ne peut plus compléter une livraison directement.
-- Vérifié : `createOrder` (checkout/actions.ts) insère status/payment_status
--   ='pending', commission_da=0, cashback_da=0, ne pose ni driver_id ni
--   order_number → AUCUN flux légitime n'est bridé. La complétion d'un retrait
--   (ready→completed, fulfillment_type='pickup') par le commerçant reste permise.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) BEFORE INSERT — neutralise les champs d'intégrité forgeables (F-1)
-- -----------------------------------------------------------------------------
-- Nom préfixé 'a_' pour s'exécuter AVANT `trigger_generate_pickup_code`
-- (ordre alphabétique des triggers BEFORE) → pickup_code/order_number remis à
-- NULL ici puis régénérés proprement par le générateur.
CREATE OR REPLACE FUNCTION public.enforce_order_insert_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    -- Statut & paiement : toujours 'pending' à la création (le passage à
    -- 'paid' est RÉSERVÉ au webhook Chargily / service_role ; l'avancée du
    -- statut passe par les transitions gardées ci-dessous).
    NEW.status          := 'pending';
    NEW.payment_status  := 'pending';
    -- Montants dérivés / figés à la complétion : jamais posés par le client.
    NEW.commission_da   := 0;
    NEW.cashback_da     := 0;
    -- Références régénérées par les triggers downstream.
    NEW.order_number    := NULL;
    NEW.pickup_code     := NULL;
    -- Attribution livreur : jamais à la création par le client.
    NEW.delivery_driver_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a_enforce_order_insert_integrity_trg ON public.orders;
CREATE TRIGGER a_enforce_order_insert_integrity_trg
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_order_insert_integrity();

-- -----------------------------------------------------------------------------
-- 2) BEFORE UPDATE — machine à états gardée + complétion livraison réservée (C-1)
-- -----------------------------------------------------------------------------
-- Table légale (miroir de ALLOWED_TRANSITIONS, lib/types.ts) :
--   pending   → preparing | accepted | cancelled
--   accepted  → preparing | cancelled
--   preparing → ready | cancelled
--   ready     → completed | cancelled
--   completed → ∅      cancelled → ∅
CREATE OR REPLACE FUNCTION public.enforce_order_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_legal BOOLEAN;
BEGIN
  -- On ne garde QUE les écritures directes via un rôle de connexion PostgREST.
  -- Les RPC internes (validate_delivery, cancel_order_by_customer, admin_*,
  -- triggers de complétion…) sont SECURITY DEFINER (current_user='postgres')
  -- ou service_role → exemptées.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_legal := CASE OLD.status
      WHEN 'pending'   THEN NEW.status IN ('preparing', 'accepted', 'cancelled')
      WHEN 'accepted'  THEN NEW.status IN ('preparing', 'cancelled')
      WHEN 'preparing' THEN NEW.status IN ('ready', 'cancelled')
      WHEN 'ready'     THEN NEW.status IN ('completed', 'cancelled')
      ELSE false
    END;

    IF NOT v_legal THEN
      RAISE EXCEPTION 'illegal_order_transition:%->%', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;

    -- La complétion d'une LIVRAISON ne se fait JAMAIS par écriture directe :
    -- elle est réservée au RPC `validate_delivery` (DEFINER, anti-fraude code).
    -- Le commerçant ne complète que les RETRAITS (click-and-collect).
    IF NEW.status = 'completed' AND COALESCE(NEW.fulfillment_type, 'pickup') = 'delivery' THEN
      RAISE EXCEPTION 'delivery_completion_requires_rpc'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_order_status_transition_trg ON public.orders;
CREATE TRIGGER enforce_order_status_transition_trg
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_order_status_transition();
