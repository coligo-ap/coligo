-- =============================================================================
-- 0193 — Lecture du portefeuille par l'opérateur lui-même (recharge UI)
-- =============================================================================
-- L'opérateur (livreur / chauffeur / commerçant / partenaire) consulte SON
-- portefeuille : solde effectif, seuil, statut, et son historique d'écritures.
-- Résolution par session via my_operator_wallet() (mig 0187/0190).
-- =============================================================================

-- État du portefeuille de l'utilisateur connecté.
CREATE OR REPLACE FUNCTION public.my_operator_wallet_state()
RETURNS TABLE (
  wallet_id UUID,
  status TEXT,
  balance_da INTEGER,
  debt_da INTEGER,
  effective_balance_da INTEGER,
  neg_threshold_da INTEGER,
  can_operate BOOLEAN,
  is_partner BOOLEAN
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
  WHERE w.id = public.my_operator_wallet();
$$;
GRANT EXECUTE ON FUNCTION public.my_operator_wallet_state() TO authenticated;

-- Historique récent des écritures du portefeuille de l'utilisateur connecté.
CREATE OR REPLACE FUNCTION public.my_operator_wallet_entries(p_limit INT DEFAULT 20)
RETURNS TABLE (
  type TEXT,
  amount_da INTEGER,
  note TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT e.type, e.amount_da, e.note, e.created_at
  FROM public.operator_wallet_entries e
  WHERE e.wallet_id = public.my_operator_wallet()
  ORDER BY e.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 50));
$$;
GRANT EXECUTE ON FUNCTION public.my_operator_wallet_entries(INT) TO authenticated;
