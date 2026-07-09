-- =============================================================================
-- 0351 — Montant d'une demande de versement borné au solde disponible (RLS)
-- =============================================================================
-- Complément de 0350 (défense en profondeur). 0350 empêche déjà toute PERTE
-- d'argent (le paiement admin refuse un montant > solde). Mais un commerçant
-- pouvait encore CRÉER une demande à montant forgé via un INSERT PostgREST
-- direct (la policy `payout_requests_insert_own` ne contraignait que le
-- propriétaire + le statut, pas le montant) : demande impayable mais trompeuse
-- dans la file admin.
--
-- CORRECTIF : la policy INSERT exige désormais que le montant soit > 0 et ≤
-- solde DISPONIBLE du commerçant — exactement l'invariant de l'action serveur
-- (`availableBalance` = SUM(wallet_entries) − demandes en cours pending/approved).
--
-- IMPORTANT (piège) : on NE PEUT PAS lire `payout_requests` dans une sous-requête
-- de sa PROPRE policy → récursion infinie RLS (42P17). Le calcul passe donc par
-- une fonction SECURITY DEFINER (`merchant_available_payout_da`) : elle bypass la
-- RLS en interne (aucune ré-évaluation de policy → pas de récursion) et ne fuit
-- rien (elle ne renvoie le solde que pour un commerce appartenant à l'appelant,
-- sinon NULL → l'insert est rejeté). Le service_role (action/RPC admin) bypass la
-- RLS et n'est pas affecté ; l'insert légitime (toujours ≤ disponible) passe sans
-- changement de code.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.merchant_available_payout_da(p_merchant_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN public.is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.merchants m
        WHERE m.id = p_merchant_id AND m.user_id = auth.uid()
      )
    THEN
      COALESCE((
        SELECT SUM(w.amount_da) FROM public.wallet_entries w
        WHERE w.merchant_id = p_merchant_id
      ), 0)
      - COALESCE((
        SELECT SUM(pr.amount_da) FROM public.payout_requests pr
        WHERE pr.merchant_id = p_merchant_id
          AND pr.status IN ('pending'::payout_status, 'approved'::payout_status)
      ), 0)
    ELSE NULL
  END
$function$;

-- Exécutable par les rôles applicatifs (nécessaire pour l'évaluation de la
-- policy sous le rôle du commerçant). La garde de propriété est DANS la fonction.
REVOKE ALL ON FUNCTION public.merchant_available_payout_da(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merchant_available_payout_da(uuid) TO authenticated;

DROP POLICY IF EXISTS payout_requests_insert_own ON public.payout_requests;

CREATE POLICY payout_requests_insert_own ON public.payout_requests
  FOR INSERT
  WITH CHECK (
    merchant_id IN (
      SELECT m.id FROM public.merchants m WHERE m.user_id = auth.uid()
    )
    AND status = 'pending'::payout_status
    AND amount_da > 0
    AND amount_da <= public.merchant_available_payout_da(merchant_id)
  );
