-- =============================================================================
-- 0079 — customers.phone nullable (connexion sociale)
-- =============================================================================
-- Avec la connexion via Google (OAuth), le téléphone n'est pas fourni à la
-- création du compte : on crée d'abord le profil client (email + nom) puis on
-- demande le téléphone sur la page Compte avant la 1re commande. La commande
-- continue d'exiger un téléphone (garde côté serveur dans createOrder).
-- =============================================================================

ALTER TABLE public.customers
  ALTER COLUMN phone DROP NOT NULL;
