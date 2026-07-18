-- =============================================================================
-- 0378 — Paiement € EMBARQUÉ (Payment Element) : idempotence par PaymentIntent
-- =============================================================================
-- Le flux embarqué crée un PaymentIntent (plus de Checkout Session hébergée
-- au checkout ; le retry, lui, garde la page hébergée). Le webhook
-- payment_intent.succeeded retrouve la session par stripe_payment_intent →
-- index UNIQUE partiel (idempotence + perfs), stripe_session_id devient
-- optionnel (déjà nullable).

CREATE UNIQUE INDEX IF NOT EXISTS uq_intl_sessions_payment_intent
  ON public.intl_payment_sessions (stripe_payment_intent)
  WHERE stripe_payment_intent IS NOT NULL;
