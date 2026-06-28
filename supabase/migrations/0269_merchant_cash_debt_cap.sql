-- =============================================================================
-- 0269 — Plafond de dette ESPÈCES commerçant (politique B + A, façon Yassir)
-- =============================================================================
-- Problème : un commerçant 100 % espèces accumule une dette de commission qui
-- ne s'apure jamais (aucune vente en ligne pour la netter). On plafonne :
--   - dette = max(0, −solde wallet)  (= « Vous devez à Coligo »)
--   - cap   = platform_settings.max_debt_da (déjà présent, jusqu'ici DORMANT ;
--             0 = politique désactivée → aucun blocage, zéro régression)
--   - au cap, on BLOQUE les nouvelles commandes ESPÈCES qui creusent la dette
--     (retrait + tournée). Les commandes EN LIGNE restent permises (elles
--     réduisent la dette). La livraison EXPRESS COD est exclue : c'est le
--     livreur qui est custodian (mig 0124/0127), elle n'alourdit pas le wallet.
--
-- Enforcement bypass-proof : trigger BEFORE INSERT sur orders, bridé aux rôles
-- de connexion (authenticated/anon) comme 0166/0169 → DEFINER & service_role
-- passent intacts (admin, seeds, corrections).
-- =============================================================================

-- 1. Dette espèces courante d'un commerçant (= −solde, plancher 0).
CREATE OR REPLACE FUNCTION public.merchant_cash_debt(p_merchant UUID)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(0, -COALESCE(sum(amount_da), 0))::INTEGER
  FROM public.wallet_entries
  WHERE merchant_id = p_merchant;
$$;

-- 2. Le commerçant a-t-il atteint le plafond de dette ? (cap 0 → jamais bloqué)
CREATE OR REPLACE FUNCTION public.merchant_cash_blocked(p_merchant UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_cap  INTEGER;
  v_debt INTEGER;
BEGIN
  SELECT COALESCE(max_debt_da, 0) INTO v_cap FROM public.platform_settings WHERE id = true;
  IF COALESCE(v_cap, 0) <= 0 THEN
    RETURN false; -- politique désactivée
  END IF;
  v_debt := public.merchant_cash_debt(p_merchant);
  RETURN v_debt >= v_cap;
END;
$$;

-- Le checkout (client authentifié/anon) doit pouvoir interroger le statut.
GRANT EXECUTE ON FUNCTION public.merchant_cash_blocked(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.merchant_cash_debt(UUID) TO authenticated;

-- 3. Enforcement (bypass-proof) : refuse une NOUVELLE commande espèces si le
--    commerçant est au plafond. Exclut l'express COD (custodian livreur).
--    NON SECURITY DEFINER : le trigger doit voir le VRAI current_user (le rôle
--    de connexion) pour ne brider que authenticated/anon — la lecture du solde
--    passe par merchant_cash_blocked (lui définer). (cf. pattern mig 0169.)
CREATE OR REPLACE FUNCTION public.enforce_merchant_cash_debt_cap()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF NEW.payment_method IS DISTINCT FROM 'cash' THEN RETURN NEW; END IF;
  -- Express COD : le livreur custodie le cash, n'alourdit pas le wallet → permis.
  IF NEW.fulfillment_type = 'delivery' AND NEW.delivery_mode = 'express' THEN
    RETURN NEW;
  END IF;

  IF public.merchant_cash_blocked(NEW.merchant_id) THEN
    RAISE EXCEPTION 'merchant_cash_debt_cap'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_merchant_cash_debt_cap_trg ON public.orders;
CREATE TRIGGER enforce_merchant_cash_debt_cap_trg
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_merchant_cash_debt_cap();
