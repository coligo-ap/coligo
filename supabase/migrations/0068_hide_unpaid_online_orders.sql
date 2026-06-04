-- =============================================================================
-- 0068 — Sécurité paiement : une commande EN LIGNE n'existe pour le commerçant
--        qu'UNE FOIS PAYÉE (confirmée par le webhook Chargily)
-- =============================================================================
-- Bug : une commande payée « en ligne » était créée AVANT le paiement (status
-- 'pending', payment_status 'pending'), donc le commerçant la recevait (board,
-- son, push) et un order_number était déjà attribué — alors que le client
-- pouvait quitter Chargily sans jamais payer.
--
-- Correctif (sans déranger le reste du flux) :
--   1. RLS : le commerçant ne VOIT une commande online que si payment_status
--      vaut 'paid' (ou 'refunded'). Tant que c'est 'pending'/'failed', elle est
--      invisible partout côté commerçant (board, polling, realtime, stats,
--      validation, ticket) — centralisé en un seul point.
--   2. Numéro de commande (order_number) NON attribué tant que le paiement
--      online n'est pas confirmé. Il est attribué au moment où payment_status
--      passe à 'paid'. (Le cash garde son numéro dès la création.)
--
-- Côté client rien ne change : /commandes filtre déjà l'online non payé, et le
-- détail/redirige vers la page d'attente de confirmation.
-- =============================================================================

-- 1. RLS commerçant : masque les commandes online pas encore payées.
DROP POLICY IF EXISTS "orders_select_own_merchant" ON public.orders;
CREATE POLICY "orders_select_own_merchant" ON public.orders
  FOR SELECT
  USING (
    merchant_id IN (
      SELECT id FROM public.merchants WHERE user_id = auth.uid()
    )
    AND (
      payment_method <> 'online'
      OR payment_status IN ('paid', 'refunded')
    )
  );

-- 2a. À l'INSERT : pickup_code toujours ; order_number SAUF online non payé.
CREATE OR REPLACE FUNCTION public.generate_pickup_code()
RETURNS TRIGGER AS $$
DECLARE
  v BIGINT;
BEGIN
  IF NEW.pickup_code IS NULL OR NEW.pickup_code = '' THEN
    NEW.pickup_code := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
  END IF;
  -- Pas de référence de commande tant qu'un paiement en ligne n'est pas
  -- confirmé : on n'attribue rien (le commerçant ne doit RIEN recevoir).
  IF (NEW.order_number IS NULL OR NEW.order_number = '')
     AND NOT (NEW.payment_method = 'online' AND NEW.payment_status <> 'paid')
  THEN
    v := nextval('public.order_number_seq');
    NEW.order_number :=
      chr(65 + ((v / 1000) % 26)::int) || LPAD((v % 1000)::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2b. Quand le paiement devient 'paid' : on attribue le numéro s'il manque
--     (cas d'une commande online dont le numéro avait été différé).
CREATE OR REPLACE FUNCTION public.assign_order_number_on_payment()
RETURNS TRIGGER AS $$
DECLARE
  v BIGINT;
BEGIN
  IF (NEW.order_number IS NULL OR NEW.order_number = '') THEN
    v := nextval('public.order_number_seq');
    NEW.order_number :=
      chr(65 + ((v / 1000) % 26)::int) || LPAD((v % 1000)::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_order_number_on_payment ON public.orders;
CREATE TRIGGER trg_assign_order_number_on_payment
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  WHEN (
    NEW.payment_status = 'paid'
    AND OLD.payment_status IS DISTINCT FROM 'paid'
  )
  EXECUTE FUNCTION public.assign_order_number_on_payment();
