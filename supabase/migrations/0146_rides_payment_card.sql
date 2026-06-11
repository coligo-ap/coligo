-- 0146 — rides.payment_method : autorise 'card' (carte CIB/Dahabia via
-- Chargily Pay, payée AVANT diffusion — mig 0145). La contrainte d'origine
-- (mig 0131) ne connaissait que cash / coligo_pay.
ALTER TABLE public.rides DROP CONSTRAINT IF EXISTS rides_payment_method_check;
ALTER TABLE public.rides ADD CONSTRAINT rides_payment_method_check
  CHECK (payment_method IN ('cash', 'card', 'coligo_pay'));
