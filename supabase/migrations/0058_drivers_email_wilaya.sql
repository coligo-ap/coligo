-- =============================================================================
-- 0058 — Profil livreur : email + wilaya
-- =============================================================================
-- À l'inscription, le livreur fournit désormais OBLIGATOIREMENT : prénom, nom,
-- téléphone, email, wilaya, mot de passe. L'auth reste basée sur le téléphone
-- (email synthétisé `{phone}@drivers.coligo.local` pour Supabase Auth), donc on
-- stocke l'email réel et la wilaya sur la table métier `drivers`.
-- Colonnes NULLABLE : les livreurs déjà inscrits n'ont pas ces données.
-- =============================================================================

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS email  TEXT,
  ADD COLUMN IF NOT EXISTS wilaya TEXT;
