-- =============================================================================
-- Coligo v3 - Migration 0023 : commande programmable J+N
-- =============================================================================
-- Ajoute `merchants.max_days_ahead` (défaut 7) — combien de jours à l'avance
-- le commerçant accepte qu'un client réserve un créneau.
--
-- Côté Server Action `createOrder` :
--   - pickup_type='asap'  → isOpenNow() requis (récupération immédiate)
--   - pickup_type='slot'  → on vérifie que le créneau choisi tombe dans la
--                           fenêtre [now + prep_time, now + max_days_ahead]
--                           ET dans les horaires d'ouverture ce jour-là.
--     PAS de check isOpenNow → un client peut commander à 22h pour demain 10h
--     même si le commerçant ferme à 21h.
-- =============================================================================

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS max_days_ahead INTEGER NOT NULL DEFAULT 7
    CHECK (max_days_ahead BETWEEN 0 AND 30);
