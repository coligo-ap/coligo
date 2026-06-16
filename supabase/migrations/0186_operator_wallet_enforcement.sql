-- =============================================================================
-- 0186 — Enforcement portefeuille opérateur (LOT 2) — DORMANT par défaut
-- =============================================================================
-- Bloque l'activité d'un opérateur quand son SOLDE EFFECTIF passe sous le seuil
-- négatif autorisé. Modèle « offset » : on NE TOUCHE PAS aux flux money audités
-- (delivery_ledger, ride_ledger, commissions) — on lit la dette existante en live.
--
--   solde_effectif = solde portefeuille (crédit prépayé)  −  dette existante
--     livreur   → driver_outstanding()
--     chauffeur → chauffeur_outstanding()  (nouveau, miroir)
--     commerçant→ 0  (pas de dette courante ; blocage via solde portefeuille)
--     partenaire→ 0
--
-- Enforcement = TRIGGERS bypass-proof aux points money (assignation livreur,
-- offre chauffeur, création commande). AUCUNE RPC existante modifiée.
--
-- ⚠️ DORMANT : l'interrupteur `operator_gating` est inséré INACTIF (status
-- 'hidden'). Tant qu'il n'est pas mis à 'active', operator_can_operate renvoie
-- toujours TRUE → ZÉRO blocage. On l'activera APRÈS les canaux de recharge
-- (LOT 3), pour ne jamais piéger un opérateur sans moyen de se renflouer.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. INTERRUPTEUR MAÎTRE (dormant) — gating actif SEULEMENT si ligne 'active'
-- ---------------------------------------------------------------------------
INSERT INTO public.feature_flags (key, status, title_fr, title_ar, message_fr, message_ar)
VALUES (
  'operator_gating', 'hidden',
  'Blocage solde insuffisant', 'حظر الرصيد غير الكافي',
  'Votre portefeuille est en dessous du seuil autorisé. Rechargez pour continuer.',
  'محفظتك أقل من الحد المسموح. أعد الشحن للمتابعة.'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.operator_gating_on()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  -- TRUE uniquement si la ligne existe ET status='active' (pas de défaut-actif)
  SELECT EXISTS (
    SELECT 1 FROM public.feature_flags
    WHERE key = 'operator_gating' AND status = 'active'
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. DETTE CHAUFFEUR (miroir conservateur de driver_outstanding)
--    = ce qu'il doit à la plateforme, non réglé (settled_at IS NULL).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chauffeur_outstanding(p_chauffeur_id UUID)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT GREATEST(0, COALESCE(SUM(
    CASE WHEN rl.type = 'chauffeur_owes_platform' THEN rl.amount_da ELSE 0 END
  ), 0))::INTEGER
  FROM public.ride_ledger rl
  WHERE rl.chauffeur_id = p_chauffeur_id
    AND rl.settled_at IS NULL;
$$;

-- ---------------------------------------------------------------------------
-- 3. DETTE PAR PORTEFEUILLE (résout owner → fonction de dette du rôle)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operator_role_debt(p_wallet_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE w public.operator_wallets%ROWTYPE;
BEGIN
  SELECT * INTO w FROM public.operator_wallets WHERE id = p_wallet_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  RETURN CASE w.owner_type
    WHEN 'driver'    THEN public.driver_outstanding(w.owner_id)
    WHEN 'chauffeur' THEN public.chauffeur_outstanding(w.owner_id)
    ELSE 0
  END;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. SOLDE EFFECTIF = crédit prépayé − dette existante
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operator_effective_balance(p_wallet_id UUID)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.operator_balance(p_wallet_id) - public.operator_role_debt(p_wallet_id);
$$;

-- ---------------------------------------------------------------------------
-- 5. PEUT-IL OPÉRER ? (redéfini : solde effectif + interrupteur dormant)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operator_can_operate(p_wallet_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE w public.operator_wallets%ROWTYPE;
BEGIN
  SELECT * INTO w FROM public.operator_wallets WHERE id = p_wallet_id;
  IF NOT FOUND THEN RETURN true; END IF;          -- jamais bloquer si pas de wallet
  IF w.status <> 'active' THEN RETURN false; END IF;
  IF NOT public.operator_gating_on() THEN RETURN true; END IF;  -- DORMANT → autorisé
  RETURN public.operator_effective_balance(w.id) >= -public.operator_neg_threshold(w.id);
END;
$$;

-- résolution par opérateur (utilisée par les triggers) — défaut TRUE si pas de wallet
CREATE OR REPLACE FUNCTION public.operator_can_operate_owner(
  p_owner_type TEXT, p_owner_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT public.operator_can_operate(w.id) FROM public.operator_wallets w
      WHERE w.owner_type = p_owner_type AND w.owner_id = p_owner_id),
    true);
$$;

-- ---------------------------------------------------------------------------
-- 6. ÉTAT COMPLET (recréé avec solde effectif + dette, pour UI/tests)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.operator_wallet_state(TEXT, UUID);
CREATE FUNCTION public.operator_wallet_state(
  p_owner_type TEXT, p_owner_id UUID
)
RETURNS TABLE (
  wallet_id UUID, status TEXT,
  balance_da INTEGER, debt_da INTEGER, effective_balance_da INTEGER,
  neg_threshold_da INTEGER, can_operate BOOLEAN, is_partner BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT w.id, w.status,
         public.operator_balance(w.id),
         public.operator_role_debt(w.id),
         public.operator_effective_balance(w.id),
         public.operator_neg_threshold(w.id),
         public.operator_can_operate(w.id),
         w.is_partner
  FROM public.operator_wallets w
  WHERE w.owner_type = p_owner_type AND w.owner_id = p_owner_id;
$$;
GRANT EXECUTE ON FUNCTION public.operator_wallet_state(TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. TRIGGERS D'ENFORCEMENT (bypass-proof, aux points money)
-- ---------------------------------------------------------------------------

-- 7a. LIVREUR — au moment de l'assignation (delivery_driver_id : NULL → valeur)
CREATE OR REPLACE FUNCTION public.trg_gate_driver_assign()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.delivery_driver_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.delivery_driver_id IS DISTINCT FROM OLD.delivery_driver_id)
     AND NOT public.operator_can_operate_owner('driver', NEW.delivery_driver_id) THEN
    RAISE EXCEPTION 'Solde insuffisant : rechargez votre portefeuille pour accepter des livraisons.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_gate_driver_assign ON public.orders;
CREATE TRIGGER trg_gate_driver_assign
  BEFORE INSERT OR UPDATE OF delivery_driver_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_gate_driver_assign();

-- 7b. CHAUFFEUR — au moment de faire une offre de course
CREATE OR REPLACE FUNCTION public.trg_gate_chauffeur_offer()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.operator_can_operate_owner('chauffeur', NEW.chauffeur_id) THEN
    RAISE EXCEPTION 'Solde insuffisant : rechargez votre portefeuille pour proposer des courses.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_gate_chauffeur_offer ON public.ride_offers;
CREATE TRIGGER trg_gate_chauffeur_offer
  BEFORE INSERT ON public.ride_offers
  FOR EACH ROW EXECUTE FUNCTION public.trg_gate_chauffeur_offer();

-- 7c. COMMERÇANT — au moment de la création d'une commande
CREATE OR REPLACE FUNCTION public.trg_gate_merchant_order()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.merchant_id IS NOT NULL
     AND NOT public.operator_can_operate_owner('merchant', NEW.merchant_id) THEN
    RAISE EXCEPTION 'Ce commerçant est temporairement indisponible (solde).'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_gate_merchant_order ON public.orders;
CREATE TRIGGER trg_gate_merchant_order
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_gate_merchant_order();
