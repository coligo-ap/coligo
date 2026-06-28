-- =============================================================================
-- 0270 — Gating opérateur : EXCEPTION « payé en ligne / prépayé » (façon Yassir)
-- =============================================================================
-- Règle métier (validée) : un opérateur en dette au-dessus du seuil reste
-- bloqué SUR LE CASH (qui creuse la dette), mais peut continuer à recevoir les
-- jobs PAYÉS EN LIGNE / PRÉPAYÉS — ils n'amènent aucune espèce à custodier, donc
-- aucune nouvelle dette, et l'encaissement online sert justement à résorber la
-- dette. L'opérateur se renfloue en travaillant, sans rester piégé.
--
-- On ajoute donc une exception aux 3 gates de mig 0186 :
--   - LIVREUR (assignation commande)    : autorisé si order.payment_method='online'
--   - COMMERÇANT (création commande)     : autorisé si order.payment_method='online'
--   - CHAUFFEUR (offre de course)        : autorisé si ride.payment_method='coligo_pay'
-- Le cash/COD reste bloqué quand l'opérateur est sous le seuil.
--
-- Inchangé : tout reste dormant tant que feature_flags.operator_gating <> 'active'
-- (operator_can_operate_owner renvoie true). Les commerçants sont par ailleurs
-- déjà couverts par le plafond de dette espèces (mig 0269) — cohérent (les deux
-- bloquent le cash, laissent l'online).
-- =============================================================================

-- 7a. LIVREUR — assignation : exception online (prépayé → pas de cash à custodier)
CREATE OR REPLACE FUNCTION public.trg_gate_driver_assign()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.delivery_driver_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.delivery_driver_id IS DISTINCT FROM OLD.delivery_driver_id)
     AND NEW.payment_method IS DISTINCT FROM 'online'          -- online = prépayé → autorisé
     AND NOT public.operator_can_operate_owner('driver', NEW.delivery_driver_id) THEN
    RAISE EXCEPTION 'Solde insuffisant : rechargez votre portefeuille pour accepter des livraisons en espèces.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- 7b. CHAUFFEUR — offre : exception coligo_pay (course prépayée → pas de cash)
CREATE OR REPLACE FUNCTION public.trg_gate_chauffeur_offer()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_pay TEXT;
BEGIN
  SELECT payment_method INTO v_pay FROM public.rides WHERE id = NEW.ride_id;
  IF v_pay IS DISTINCT FROM 'coligo_pay'                       -- coligo_pay = prépayé → autorisé
     AND NOT public.operator_can_operate_owner('chauffeur', NEW.chauffeur_id) THEN
    RAISE EXCEPTION 'Solde insuffisant : rechargez votre portefeuille pour proposer des courses en espèces.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- 7c. COMMERÇANT — création commande : exception online (résorbe la dette)
CREATE OR REPLACE FUNCTION public.trg_gate_merchant_order()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.merchant_id IS NOT NULL
     AND NEW.payment_method IS DISTINCT FROM 'online'          -- online = encaissé → réduit la dette → autorisé
     AND NOT public.operator_can_operate_owner('merchant', NEW.merchant_id) THEN
    RAISE EXCEPTION 'Ce commerçant est temporairement indisponible pour les commandes en espèces (solde).'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
