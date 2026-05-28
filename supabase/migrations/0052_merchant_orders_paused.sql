-- =============================================================================
-- 0052 — « Fermer maintenant » : pause manuelle des commandes commerçant
-- =============================================================================
-- Indépendant des horaires d'ouverture : le commerçant peut couper net la
-- réception de commandes (rush, rupture, fermeture imprévue) via un bouton
-- dans son header. Quand orders_paused = true, le checkout refuse toute
-- nouvelle commande, quel que soit l'horaire.
-- =============================================================================

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS orders_paused BOOLEAN NOT NULL DEFAULT false;
