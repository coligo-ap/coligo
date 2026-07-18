-- =============================================================================
-- 0379 — Paiement € (Stripe) pour les courses Coligo Drive
-- =============================================================================
-- intl_payment_sessions servait uniquement les commandes marketplace
-- (order_id NOT NULL). Les courses Drive payées par carte internationale ont
-- besoin du même suivi (plafonds, taux figé, rapprochement webhook) →
-- order_id devient optionnel et ride_id apparaît, avec la garantie qu'une
-- session vise EXACTEMENT une cible (commande OU course).

ALTER TABLE public.intl_payment_sessions
  ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE public.intl_payment_sessions
  ADD COLUMN IF NOT EXISTS ride_id uuid REFERENCES public.rides(id);

ALTER TABLE public.intl_payment_sessions
  ADD CONSTRAINT chk_intl_session_one_target
  CHECK ((order_id IS NOT NULL)::int + (ride_id IS NOT NULL)::int = 1);

CREATE INDEX IF NOT EXISTS idx_intl_sessions_ride
  ON public.intl_payment_sessions (ride_id)
  WHERE ride_id IS NOT NULL;
