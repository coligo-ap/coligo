-- =============================================================================
-- 0434 — Suspension en LECTURE SEULE : une sanction graduée.
--
-- Jusqu'ici, une seule option : tout bloquer. C'est brutal pour un doute — le
-- client perd l'accès à ses commandes en cours, à ses reçus, à son historique,
-- et appelle le support pour ça.
--
-- Nouvelle mesure `readonly` : le compte reste CONSULTABLE (commandes, reçus,
-- historique, adresses) mais AUCUNE action n'est possible — commander, réserver
-- une course, payer, modifier. L'équipe garde `suspend` pour les cas certains.
--
-- Le contrôle réel reste côté serveur (checkout, Drive, paiement) : masquer un
-- bouton n'a jamais empêché personne d'appeler l'API.
-- =============================================================================

ALTER TABLE public.fraud_actions DROP CONSTRAINT IF EXISTS fraud_actions_action_check;
ALTER TABLE public.fraud_actions ADD CONSTRAINT fraud_actions_action_check
  CHECK (action = ANY (ARRAY[
    'warn','require_ack','limit','force_offline','require_idv',
    'suspend','restore','note','readonly'
  ]));


-- Une mesure est ACTIVE si elle n'est ni révoquée ni expirée. Défini UNE fois :
-- recopié cinq fois, un écart entre deux copies passerait inaperçu.
CREATE OR REPLACE FUNCTION public._fraud_has(p_customer uuid, p_action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $f$
  SELECT EXISTS (
    SELECT 1 FROM public.fraud_actions a
     WHERE a.actor_kind = 'customer' AND a.actor_id = p_customer
       AND a.action = p_action AND a.revoked_at IS NULL
       AND (a.expires_at IS NULL OR a.expires_at > now())
  );
$f$;

CREATE OR REPLACE FUNCTION public.customer_fraud_gate()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE cid UUID;
BEGIN
  SELECT c.id INTO cid FROM public.customers c WHERE c.user_id = auth.uid();
  IF cid IS NULL THEN
    RETURN jsonb_build_object('require_ack', false, 'suspended', false,
      'limited', false, 'require_idv', false, 'readonly', false);
  END IF;
  RETURN jsonb_build_object(
    'require_ack', public._fraud_has(cid, 'require_ack'),
    'suspended',   public._fraud_has(cid, 'suspend'),
    'limited',     public._fraud_has(cid, 'limit'),
    'require_idv', public._fraud_has(cid, 'require_idv'),
    'readonly',    public._fraud_has(cid, 'readonly'));
END $function$;

GRANT EXECUTE ON FUNCTION public.customer_fraud_gate() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._fraud_has(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._fraud_has(uuid, text) TO authenticated, service_role;
