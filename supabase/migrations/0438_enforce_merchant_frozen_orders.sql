-- =============================================================================
-- 0438 — GEL COMMERÇANT = PLUS DE NOUVELLES COMMANDES (immédiat, bypass-proof).
--
-- Trou constaté : `merchants.is_frozen` ne suspendait que les VERSEMENTS — le
-- commerçant restait visible ET commandable côté client. Or la sanction
-- anti-fraude « suspend » pose précisément is_frozen (mig 0374) : un
-- commerçant suspendu pour fraude continuait d'encaisser des commandes.
-- Exigence produit : toute décision super-admin doit mordre IMMÉDIATEMENT.
--
-- Enforcement AU NIVEAU BASE (trigger BEFORE INSERT sur orders, comme les
-- kill-switches mig 0182 et la garde dette cash) : aucun chemin applicatif
-- (checkout, panier partagé, commandes programmées) ne peut le contourner.
-- Les commandes EN COURS ne sont pas touchées (on ne casse jamais une
-- commande déjà acceptée) ; le dégel rouvre instantanément.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.trg_gate_frozen_merchant_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.merchant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = NEW.merchant_id AND m.is_frozen
  ) THEN
    RAISE EXCEPTION 'merchant_frozen'
      USING ERRCODE = 'check_violation',
            HINT = 'Commerçant gelé par l''équipe Coligo — nouvelles commandes refusées.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_merchant_frozen_order ON public.orders;
CREATE TRIGGER enforce_merchant_frozen_order
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_gate_frozen_merchant_order();
