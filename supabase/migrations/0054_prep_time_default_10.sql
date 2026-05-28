-- =============================================================================
-- 0054 — Temps de préparation par défaut = 10 min (au lieu de 15)
-- =============================================================================
-- Aligne le défaut sur l'attente produit. N'affecte QUE les nouveaux
-- commerçants ; les existants gardent leur valeur (modifiable dans les
-- paramètres commerçant → règles de commande).
-- =============================================================================
ALTER TABLE public.merchants ALTER COLUMN prep_time_min SET DEFAULT 10;
