-- =============================================================================
-- 0305 — Plans Drive personnalisés : lever le CHECK figé plan ∈ (pro, premium)
-- -----------------------------------------------------------------------------
-- Le super-admin peut créer des plans avec n'importe quel code (0304). Les
-- colonnes `plan` de chauffeur_subscriptions / _payments étaient verrouillées à
-- ('pro','premium'), ce qui bloquait tout plan personnalisé. On lève ces CHECK :
-- la validité du code est désormais garantie par drive_subscribe (SECURITY
-- DEFINER) qui vérifie l'existence + l'activité du plan dans drive_plans. On ne
-- pose PAS de FK → la suppression d'un plan reste possible sans casser l'historique
-- (les enregistrements passés conservent le code en texte).
-- =============================================================================

ALTER TABLE public.chauffeur_subscriptions
  DROP CONSTRAINT IF EXISTS chauffeur_subscriptions_plan_check;

ALTER TABLE public.chauffeur_subscription_payments
  DROP CONSTRAINT IF EXISTS chauffeur_subscription_payments_plan_check;

-- Garde-fou léger : le code de plan reste non vide (jamais NULL/''), sans
-- restreindre l'ensemble des valeurs.
ALTER TABLE public.chauffeur_subscriptions
  ADD CONSTRAINT chauffeur_subscriptions_plan_nonempty CHECK (length(btrim(plan)) > 0);
ALTER TABLE public.chauffeur_subscription_payments
  ADD CONSTRAINT chauffeur_subscription_payments_plan_nonempty CHECK (length(btrim(plan)) > 0);
