-- =============================================================================
-- 0197 — Lecture RLS du portefeuille partenaire par son propriétaire
-- =============================================================================
-- `getCurrentPartner` lit operator_wallets via le client utilisateur (role
-- authenticated). Or operator_wallets est en RLS DENY-ALL (aucune policy) →
-- la lecture renvoyait 0 ligne et l'espace agent était cassé APRÈS connexion
-- (redirigé en boucle vers /partenaire/login alors que la session est valide).
-- Confirmé par scripts/test-agent-signup.mjs.
--
-- Correctif minimal et sûr : UNE policy SELECT, strictement limitée au
-- propriétaire partenaire (owner_id = auth.uid()). Convention mig 0190 :
-- pour un partenaire, owner_id = l'id du compte auth.
--
-- ⚠️ AUCUNE policy INSERT/UPDATE/DELETE n'est ajoutée → l'agent ne peut
-- toujours pas modifier son statut/sa vérification (anti-auto-activation
-- préservée ; l'activation passe par le service_role côté super-admin).
-- Les autres rôles (driver/chauffeur/merchant) ont owner_id ≠ auth.uid() →
-- cette policy ne les concerne pas (ils lisent via my_operator_wallet_state,
-- SECURITY DEFINER) : aucune fuite.
-- =============================================================================

DROP POLICY IF EXISTS operator_wallets_partner_owner_read ON public.operator_wallets;
CREATE POLICY operator_wallets_partner_owner_read ON public.operator_wallets
  FOR SELECT USING (owner_type = 'partner' AND owner_id = auth.uid());
