-- =============================================================================
-- 0383 — Coligo Pay v2 : historique navigable (id) + détail d'opération
-- =============================================================================
-- La refonte « workflow-oriented » de Coligo Pay ouvre chaque opération sur une
-- page de détail dédiée (reçu financier). Il faut donc :
--   1. exposer l'ID de chaque écriture dans l'historique (deep-link vers le
--      détail) et élargir la borne de 50 → 200 (page Historique complète,
--      chargement progressif côté UI) ;
--   2. une RPC de détail STRICTEMENT scopée au portefeuille du connecté
--      (impossible de lire l'écriture d'un autre portefeuille).
-- =============================================================================

-- 1) Historique : la signature de retour change (id en tête) ⇒ DROP + CREATE,
--    puis re-GRANT par rôle appelant (cf. règle EXECUTE par rôle).
DROP FUNCTION IF EXISTS public.my_operator_wallet_entries(INT);
CREATE FUNCTION public.my_operator_wallet_entries(p_limit INT DEFAULT 20)
RETURNS TABLE (
  id UUID,
  type TEXT,
  amount_da INTEGER,
  note TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT e.id, e.type, e.amount_da, e.note, e.created_at
  FROM public.operator_wallet_entries e
  WHERE e.wallet_id = public.my_operator_wallet()
  ORDER BY e.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 200));
$$;
REVOKE ALL ON FUNCTION public.my_operator_wallet_entries(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_operator_wallet_entries(INT) TO authenticated;

-- 2) Détail d'une écriture (page « reçu ») — self-only via my_operator_wallet().
CREATE OR REPLACE FUNCTION public.my_operator_wallet_entry(p_id UUID)
RETURNS TABLE (
  id UUID,
  type TEXT,
  amount_da INTEGER,
  note TEXT,
  ref_id UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT e.id, e.type, e.amount_da, e.note, e.ref_id, e.created_at
  FROM public.operator_wallet_entries e
  WHERE e.id = p_id
    AND e.wallet_id = public.my_operator_wallet();
$$;
REVOKE ALL ON FUNCTION public.my_operator_wallet_entry(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_operator_wallet_entry(UUID) TO authenticated;
