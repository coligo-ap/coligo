-- ============================================================================
-- 0224 — Réservation PROGRAMMÉE (gated super-admin, OFF + masqué par défaut)
-- ----------------------------------------------------------------------------
-- Course planifiée à une date/heure future. Désactivée et masquée par défaut
-- (drive_scheduled_enabled=false) → aucun impact tant que le super-admin ne
-- l'active pas. MVP : paiement ESPÈCES uniquement (pas de séquestre à gérer).
--
-- Cycle : création status='scheduled' (non diffusée) → quand l'heure approche
-- (scheduled_at − lead), bascule en 'searching' (diffusion normale). La bascule
-- est déclenchée par le POLL chauffeur (pas de cron fréquent, cf. archi Express)
-- + filet de sécurité dans le cron Drive quotidien. Le prix est figé au devis
-- PROGRAMMÉ (sans surge ni majoration horaire).
-- ============================================================================

ALTER TYPE public.ride_status ADD VALUE IF NOT EXISTS 'scheduled';

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS drive_scheduled_enabled   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS drive_scheduled_lead_min  INTEGER NOT NULL DEFAULT 15,   -- diffusion N min avant l'heure
  ADD COLUMN IF NOT EXISTS drive_scheduled_max_days  INTEGER NOT NULL DEFAULT 7;    -- horizon max de réservation

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

-- NB : l'index partiel WHERE status='scheduled' et les fonctions utilisant la
-- nouvelle valeur d'enum sont en 0225 (PG interdit d'utiliser une valeur d'enum
-- dans la même transaction que son ADD VALUE).
