-- =============================================================================
-- 0254 — Dispatch : canaux Realtime PRIVÉS (Realtime Authorization)
-- =============================================================================
-- Les canaux perso `chauffeur:{userId}` / `courier:{userId}` (dispatch push,
-- mig 0253 + commits) étaient PUBLICS : un topic en UUID non énumérable, mais
-- sans contrôle d'accès. Exposition réelle FAIBLE (la charge utile n'est qu'un
-- ping { rideId|orderId } ; les données de course sont RLS-gardées côté Server
-- Actions), mais on durcit pour aligner sur l'isolation stricte des rôles.
--
-- Mécanisme : Realtime Authorization. La RLS sur `realtime.messages` est DÉJÀ
-- activée (défaut Supabase) et ne s'applique QU'AUX canaux ouverts avec
-- `config.private = true` — les canaux PUBLICS existants (orders-bridge,
-- ride_offers, presence…) ne sont PAS affectés. On ajoute une policy SELECT :
-- un partenaire authentifié ne peut RECEVOIR les broadcasts QUE sur SON propre
-- canal (topic se terminant par son auth.uid()). L'émission reste faite par le
-- serveur en service_role (bypass RLS), donc seul le SELECT (réception) compte.
--
-- Effet : un tiers qui devinerait un UUID ne peut plus s'abonner au canal d'un
-- autre (l'abonnement privé est refusé par la policy).
-- =============================================================================

-- Réception des broadcasts dispatch : uniquement sur SON canal perso.
DROP POLICY IF EXISTS dispatch_partner_reads_own_channel ON realtime.messages;
CREATE POLICY dispatch_partner_reads_own_channel
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    extension = 'broadcast'
    AND (
      realtime.topic() = 'chauffeur:' || (auth.uid())::text
      OR realtime.topic() = 'courier:' || (auth.uid())::text
    )
  );
