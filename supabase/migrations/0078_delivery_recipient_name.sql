-- =============================================================================
-- 0078 — Livraison à un tiers : nom du destinataire
-- =============================================================================
-- Le client peut commander une livraison pour quelqu'un d'autre : on capture le
-- NOM du destinataire (le téléphone est déjà géré par delivery_phone). Le
-- livreur contacte ce destinataire. Nullable → comportement inchangé quand la
-- livraison est pour le client lui-même.
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_recipient_name TEXT;
