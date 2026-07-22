-- =============================================================================
-- 0399 — CORRECTIF CRITIQUE de `enforce_customer_block_orders` (mig 0397)
-- =============================================================================
-- `orders.delivery_mode` est un ENUM, pas du TEXT : l'appel
-- `customer_feature_blocked(NEW.customer_id, NEW.delivery_mode)` ne résolvait
-- AUCUNE signature. PL/pgSQL prépare l'expression du `IF` à la première
-- évaluation — le court-circuit ne protège donc de rien : TOUTE insertion de
-- commande par un client échouait avec
-- « function public.customer_feature_blocked(uuid, delivery_mode) does not exist ».
--
-- Correctif : cast explicite en text. Leçon retenue : un trigger doit être testé
-- sur le chemin PASSANT (commande qui doit RÉUSSIR), pas seulement sur le chemin
-- refusé — un test qui ne vérifie que les refus valide un trigger qui bloque tout.

create or replace function public.enforce_customer_block_orders()
returns trigger language plpgsql
set search_path = public, pg_temp as $$
BEGIN
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.customer_is_blocked(NEW.customer_id) THEN
    RAISE EXCEPTION 'account_blocked' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.fulfillment_type::text = 'delivery'
     AND NEW.delivery_mode IS NOT NULL
     AND public.customer_feature_blocked(
           NEW.customer_id, NEW.delivery_mode::text
         ) THEN
    RAISE EXCEPTION 'feature_disabled:%', NEW.delivery_mode::text
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END; $$;
