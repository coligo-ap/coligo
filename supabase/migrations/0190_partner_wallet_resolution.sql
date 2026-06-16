-- =============================================================================
-- 0190 — Résolution du portefeuille partenaire par session (LOT 6)
-- =============================================================================
-- Un point de recharge partenaire est un operator_wallets(owner_type='partner').
-- Pour qu'il puisse définir son PIN et REVENDRE du crédit (coligo_recharge_sell,
-- mig 0188), my_operator_wallet() doit aussi le résoudre. Convention : pour les
-- partenaires, owner_id = l'id du compte auth (auth.users.id) du partenaire.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.my_operator_wallet()
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid UUID := auth.uid(); v_id UUID;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  -- partenaire : owner_id = auth user id
  SELECT id INTO v_id FROM public.operator_wallets
    WHERE owner_type = 'partner' AND owner_id = v_uid LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT w.id INTO v_id FROM public.operator_wallets w
    JOIN public.drivers d ON d.id = w.owner_id
    WHERE w.owner_type = 'driver' AND d.user_id = v_uid LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT w.id INTO v_id FROM public.operator_wallets w
    JOIN public.chauffeurs ch ON ch.id = w.owner_id
    WHERE w.owner_type = 'chauffeur' AND ch.user_id = v_uid LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT w.id INTO v_id FROM public.operator_wallets w
    JOIN public.merchants m ON m.id = w.owner_id
    WHERE w.owner_type = 'merchant' AND m.user_id = v_uid LIMIT 1;
  RETURN v_id;
END;
$$;
