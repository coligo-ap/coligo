-- =============================================================================
-- 0166 — Garde anti-fraude : colonnes financières de `orders` immuables côté
--        commerçant (écriture directe PostgREST)
-- =============================================================================
-- FAILLE (audit 2026-06-12, périmètre commerçant) : la policy RLS
-- `orders_update_own_merchant` (0003) autorise le commerçant à UPDATE ses
-- commandes SANS restriction de colonnes — Postgres ne sait pas restreindre les
-- colonnes dans une policy. L'UI ne modifie que `status`, mais un commerçant
-- malveillant peut appeler PostgREST directement (il a son JWT) et écrire
-- n'importe quelle colonne de SES commandes :
--   • gonfler total_da / net_total_da → commission & crédit wallet calculés
--     dessus à la complétion = vol ;
--   • baisser commission_da / service_fee_da → moins reversé à Coligo ;
--   • forcer payment_status='paid' sur une commande online jamais encaissée →
--     contourne le gating 0068 (la commande redevient visible/validable et
--     génère des écritures wallet sans argent réel) ;
--   • s'attribuer/détourner delivery_driver_id, falsifier pickup_code /
--     order_number.
-- Aucun trigger ne protégeait ces colonnes (contrairement à
-- `protect_customer_risk_fields` sur customers, 0116).
--
-- CORRECTIF : un trigger BEFORE UPDATE qui, pour les SEULES écritures émanant
-- d'un rôle de connexion PostgREST (`authenticated` / `anon`), RÉTABLIT les
-- colonnes financières/d'intégrité à leur valeur OLD (non-fatal, comme le garde
-- customers). Les fonctions internes (toutes SECURITY DEFINER, owner=postgres →
-- current_user='postgres') et le service_role (webhook Chargily, RPC admin)
-- passent INTACTES. Vérifié : le SEUL rôle de connexion disposant d'une policy
-- UPDATE sur orders est le commerçant, et il n'écrit légitimement QUE `status`
-- (app/(merchant)/orders/actions.ts) — donc rien de légitime n'est bridé.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.protect_order_financial_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- current_user = 'postgres' à l'intérieur des fonctions SECURITY DEFINER, et
  -- 'service_role' pour les webhooks/admin → on ne bride QUE les écritures
  -- directes via PostgREST sous un rôle de connexion utilisateur.
  IF current_user IN ('authenticated', 'anon') THEN
    -- Montants
    NEW.subtotal_da            := OLD.subtotal_da;
    NEW.discount_da            := OLD.discount_da;
    NEW.gross_total_da         := OLD.gross_total_da;
    NEW.net_total_da           := OLD.net_total_da;
    NEW.total_da               := OLD.total_da;
    NEW.service_fee_da         := OLD.service_fee_da;
    NEW.delivery_fee_da        := OLD.delivery_fee_da;
    NEW.commission_da          := OLD.commission_da;
    NEW.cashback_da            := OLD.cashback_da;
    NEW.cashback_estimate_da   := OLD.cashback_estimate_da;
    NEW.cashback_used_da       := OLD.cashback_used_da;
    NEW.topup_used_da          := OLD.topup_used_da;
    -- Snapshots de taux + commission tournée
    NEW.commission_rate_applied             := OLD.commission_rate_applied;
    NEW.cashback_rate_applied               := OLD.cashback_rate_applied;
    NEW.chargily_fee_rate_applied           := OLD.chargily_fee_rate_applied;
    NEW.tour_delivery_commission_da         := OLD.tour_delivery_commission_da;
    NEW.tour_delivery_commission_rate_applied := OLD.tour_delivery_commission_rate_applied;
    -- Snapshots livreur (custodian express)
    NEW.driver_fee_da          := OLD.driver_fee_da;
    NEW.driver_net_da          := OLD.driver_net_da;
    NEW.driver_fee_rate_applied := OLD.driver_fee_rate_applied;
    NEW.driver_cash_collected_da := OLD.driver_cash_collected_da;
    NEW.driver_owes_merchant_da  := OLD.driver_owes_merchant_da;
    NEW.driver_owes_platform_da  := OLD.driver_owes_platform_da;
    -- Paiement / intégrité
    NEW.payment_method         := OLD.payment_method;
    NEW.payment_status         := OLD.payment_status;
    NEW.pickup_code            := OLD.pickup_code;
    NEW.order_number           := OLD.order_number;
    NEW.delivery_driver_id     := OLD.delivery_driver_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_order_financial_fields_trg ON public.orders;
CREATE TRIGGER protect_order_financial_fields_trg
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_order_financial_fields();
