-- =============================================================================
-- 0295 — Filet serveur : annuler les commandes ONLINE non payées qui traînent
-- =============================================================================
-- Contexte : une commande online est créée en `pending` puis confirmée `paid`
-- par le webhook Chargily (mig 0068 : invisible commerçant + sans numéro tant
-- que non payée). Si le client ABANDONNE le paiement, on comptait UNIQUEMENT
-- sur l'event `checkout.expired` de Chargily (webhook) pour l'annuler — mais il
-- n'arrive pas de façon fiable/rapide. Résultat observé (prod, 01/07) : une
-- commande online restée `pending` 86 min, jamais nettoyée →
--   • /checkout/success affiche « paiement en cours de confirmation » à l'infini
--     (même en actualisant) ;
--   • le créneau reste occupé (max_orders_per_slot) ;
--   • le cashback / Coligo Pay éventuellement réservé n'est jamais re-crédité.
-- La mig 0244 (auto-refus) EXCLUT volontairement l'online non payé (« relève du
-- cycle Chargily ») → ce trou n'était couvert par personne.
--
-- CORRECTIF : RPC `expire_unpaid_online_orders`, filet INDÉPENDANT de Chargily,
-- avec la MÊME sémantique que le handler `checkout.expired` du webhook
-- (status='cancelled' + payment_status='failed' + reason). Les triggers
-- `refund_customer_*_on_cancel` re-créditent cashback/topup et le créneau se
-- libère. Idempotent (WHERE payment_status='pending' → un paiement confirmé
-- entre-temps n'est jamais touché). Appelée par le cron /api/cron/expire-orders
-- (quotidien) ; service_role uniquement (le webhook garde son rôle temps réel).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.expire_unpaid_online_orders(
  p_max_age_min INTEGER DEFAULT 60
) RETURNS TABLE(expired INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  -- Annulation « système » des commandes online restées non payées au-delà du
  -- seuil. Le garde `payment_status = 'pending'` rend l'opération sûre vis-à-vis
  -- d'un webhook `paid` concurrent (il ne matchera plus). Les triggers de
  -- contre-passation (cashback/topup) se déclenchent sur le passage à 'cancelled'.
  UPDATE public.orders
    SET status                 = 'cancelled',
        payment_status         = 'failed',
        payment_failure_reason = COALESCE(payment_failure_reason, 'payment_timeout'),
        cancelled_by           = 'system'
    WHERE payment_method = 'online'
      AND payment_status = 'pending'
      AND status <> 'cancelled'
      AND created_at < now() - make_interval(mins => GREATEST(1, p_max_age_min));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_count;
END;
$$;

-- Filet appelé par le cron (service_role) uniquement — jamais exposé au client.
REVOKE ALL ON FUNCTION public.expire_unpaid_online_orders(INTEGER)
  FROM PUBLIC, anon, authenticated;
