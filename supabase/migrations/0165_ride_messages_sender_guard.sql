-- =============================================================================
-- 0165 — Chat Drive : le champ `sender` doit correspondre au rôle réel
-- =============================================================================
-- Suite de l'audit 0164 étendu aux autres verticales. La policy ride_messages
-- (0139, FOR ALL) vérifiait que l'expéditeur PARTICIPE à la course mais pas la
-- cohérence du champ `sender` : un client pouvait insérer un message étiqueté
-- 'chauffeur' dans son propre chat (spoofing — gênant en cas de litige), et la
-- policy FOR ALL autorisait aussi UPDATE/DELETE (réécriture de l'historique).
-- Le chat livraison (order_messages) n'est PAS concerné : SELECT-only + RPC.
--
-- Nouveau découpage : SELECT participants ; INSERT par rôle avec sender imposé ;
-- AUCUN UPDATE/DELETE client (historique immuable).
-- =============================================================================

DROP POLICY IF EXISTS ride_messages_participants ON public.ride_messages;

CREATE POLICY ride_messages_select ON public.ride_messages
  FOR SELECT TO authenticated
  USING (
    ride_id IN (
      SELECT r.id FROM public.rides r
      WHERE r.customer_id IN (SELECT cu.id FROM public.customers cu WHERE cu.user_id = auth.uid())
         OR r.chauffeur_id IN (SELECT c.id FROM public.chauffeurs c WHERE c.user_id = auth.uid())
    )
  );

CREATE POLICY ride_messages_insert_customer ON public.ride_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender = 'customer'
    AND ride_id IN (
      SELECT r.id FROM public.rides r
      JOIN public.customers cu ON cu.id = r.customer_id
      WHERE cu.user_id = auth.uid()
    )
  );

CREATE POLICY ride_messages_insert_chauffeur ON public.ride_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender = 'chauffeur'
    AND ride_id IN (
      SELECT r.id FROM public.rides r
      JOIN public.chauffeurs c ON c.id = r.chauffeur_id
      WHERE c.user_id = auth.uid()
    )
  );
