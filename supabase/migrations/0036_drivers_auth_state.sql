-- =============================================================================
-- 0036 — Auth livreur via Supabase + statut disponibilité par paire
-- =============================================================================
-- Le livreur a un compte Supabase auth (email synthétique <phone>@drivers.coligo
-- généré au signup). Le rôle "driver" est dérivé de la présence d'une ligne
-- `drivers.user_id`. `merchant_drivers` reste la source de vérité pour
-- l'accès PAR commerçant.
--
-- `driver_availability` : statut PAR PAIRE (le livreur peut être "available"
-- chez un commerçant et "offline" chez un autre). Indispensable pour FIFO
-- (prompt 7) qui matche par commerçant actif.
-- =============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'driver_avail_status') THEN
    CREATE TYPE public.driver_avail_status AS ENUM ('offline', 'available', 'busy');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.driver_availability (
  merchant_driver_id  UUID PRIMARY KEY REFERENCES public.merchant_drivers(id) ON DELETE CASCADE,
  status              public.driver_avail_status NOT NULL DEFAULT 'offline',
  -- Verrou « commande en cours » pour interdire le double-pull en express.
  current_order_id    UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_availability_status
  ON public.driver_availability (status)
  WHERE status = 'available';

ALTER TABLE public.driver_availability ENABLE ROW LEVEL SECURITY;

-- Le livreur lit/modifie sa propre dispo (uniquement pour ses pairs actifs).
DROP POLICY IF EXISTS "driver_availability_driver_all" ON public.driver_availability;
CREATE POLICY "driver_availability_driver_all"
  ON public.driver_availability FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.merchant_drivers md
      JOIN public.drivers d ON d.id = md.driver_id
      WHERE md.id = driver_availability.merchant_driver_id
        AND md.status = 'active'
        AND d.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.merchant_drivers md
      JOIN public.drivers d ON d.id = md.driver_id
      WHERE md.id = driver_availability.merchant_driver_id
        AND md.status = 'active'
        AND d.user_id = auth.uid()
    )
  );

-- Le commerçant lit la dispo de SES livreurs.
DROP POLICY IF EXISTS "driver_availability_merchant_select" ON public.driver_availability;
CREATE POLICY "driver_availability_merchant_select"
  ON public.driver_availability FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.merchant_drivers md
      JOIN public.merchants m ON m.id = md.merchant_id
      WHERE md.id = driver_availability.merchant_driver_id
        AND m.user_id = auth.uid()
    )
  );

-- Trigger touch updated_at
CREATE OR REPLACE FUNCTION public.driver_availability_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS driver_availability_touch_trg ON public.driver_availability;
CREATE TRIGGER driver_availability_touch_trg
  BEFORE UPDATE ON public.driver_availability
  FOR EACH ROW EXECUTE FUNCTION public.driver_availability_touch();
