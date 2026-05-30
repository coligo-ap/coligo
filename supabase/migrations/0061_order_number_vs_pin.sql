-- =============================================================================
-- 0061 — Séparer NUMÉRO DE COMMANDE et CODE PIN de validation
-- =============================================================================
-- Deux notions distinctes :
--   * order_number : référence de COMMUNICATION commerçant ↔ client. Non secret,
--     affiché partout (ticket, client, commerçant, livreur). Format LETTRE + 3
--     chiffres (ex. « A042 »), visuellement différent du PIN.
--   * pickup_code  : code PIN de SÉCURITÉ pour VALIDER un retrait ou une
--     livraison payée en ligne. Secret — montré UNIQUEMENT au client, JAMAIS
--     imprimé sur le ticket. Repassé de 6 → 4 chiffres.
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_number TEXT;

CREATE SEQUENCE IF NOT EXISTS public.order_number_seq;

-- Génération : pickup_code (4 chiffres) + order_number (lettre + 3 chiffres).
CREATE OR REPLACE FUNCTION public.generate_pickup_code()
RETURNS TRIGGER AS $$
DECLARE
  v BIGINT;
BEGIN
  IF NEW.pickup_code IS NULL OR NEW.pickup_code = '' THEN
    NEW.pickup_code := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
  END IF;
  IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
    v := nextval('public.order_number_seq');
    NEW.order_number :=
      chr(65 + ((v / 1000) % 26)::int) || LPAD((v % 1000)::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backfill des commandes existantes (ordre chronologique) — référence stable.
DO $$
DECLARE r RECORD; v BIGINT;
BEGIN
  FOR r IN SELECT id FROM public.orders WHERE order_number IS NULL ORDER BY created_at LOOP
    v := nextval('public.order_number_seq');
    UPDATE public.orders
      SET order_number = chr(65 + ((v / 1000) % 26)::int) || LPAD((v % 1000)::TEXT, 3, '0')
      WHERE id = r.id;
  END LOOP;
END $$;
