-- =============================================================================
-- 0433 — La porte anti-fraude connaît enfin « vérification d'identité exigée ».
--
-- Le super-admin pouvait poser la mesure `require_idv` : elle s'enregistrait,
-- s'affichait dans l'historique… et ne produisait AUCUN effet. La porte lue par
-- l'application ne renvoyait que trois drapeaux (pop-up, suspension,
-- limitation). Une mesure sans effet est pire qu'une mesure absente : l'équipe
-- croit avoir agi.
--
-- On ajoute `require_idv`. Même logique que les autres : la mesure compte tant
-- qu'elle n'est ni révoquée ni expirée.
-- =============================================================================

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
    RETURN jsonb_build_object(
      'require_ack', false, 'suspended', false,
      'limited', false, 'require_idv', false
    );
  END IF;
  RETURN jsonb_build_object(
    'require_ack', EXISTS (SELECT 1 FROM public.fraud_actions a
        WHERE a.actor_kind = 'customer' AND a.actor_id = cid
          AND a.action = 'require_ack' AND a.revoked_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > now())),
    'suspended', EXISTS (SELECT 1 FROM public.fraud_actions a
        WHERE a.actor_kind = 'customer' AND a.actor_id = cid
          AND a.action = 'suspend' AND a.revoked_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > now())),
    'limited', EXISTS (SELECT 1 FROM public.fraud_actions a
        WHERE a.actor_kind = 'customer' AND a.actor_id = cid
          AND a.action = 'limit' AND a.revoked_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > now())),
    'require_idv', EXISTS (SELECT 1 FROM public.fraud_actions a
        WHERE a.actor_kind = 'customer' AND a.actor_id = cid
          AND a.action = 'require_idv' AND a.revoked_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > now())));
END $function$;

GRANT EXECUTE ON FUNCTION public.customer_fraud_gate() TO authenticated, service_role;
