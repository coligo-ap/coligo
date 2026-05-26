-- =============================================================================
-- 0035 — Livreurs : code de référence + table drivers + lien commerçant↔livreur
-- =============================================================================
-- ⚠️ Sécurité d'accès :
--  - Le code de référence d'un commerçant n'est JAMAIS stocké en clair.
--    On stocke SHA-256(code) ; la comparaison se fait sur le hash.
--  - Multi-commerçants étanche : un livreur peut soumettre les codes de
--    plusieurs commerçants ; chaque relation (statut, sessions) est isolée
--    dans `merchant_drivers`.
--  - Révocation : la régénération d'un code invalide TOUS les liens actifs
--    du commerçant (sessions_revoked_at touché par trigger) et désactive
--    l'ancien code. Les livreurs devront soumettre le NOUVEAU code pour
--    être réacceptés.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. drivers — profil minimal du livreur (étendu en migration 0036+ avec
--    documents/vehicle/etc. à l'étape « PWA livreur »).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.drivers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- nullable : à ce stade le livreur peut exister par téléphone sans compte
  -- auth (le compte auth sera créé à la PWA livreur, étape 3 = prompt 4).
  user_id     UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name   TEXT NOT NULL,
  phone       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drivers_user_id ON public.drivers(user_id)
  WHERE user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. merchant_referral_codes — historique des codes (1 actif max par commerçant).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.merchant_referral_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Garantit qu'un commerçant n'a JAMAIS deux codes actifs simultanément.
CREATE UNIQUE INDEX IF NOT EXISTS merchant_referral_codes_one_active_per_merchant
  ON public.merchant_referral_codes (merchant_id)
  WHERE is_active = true;

-- Lookup principal côté serveur lors d'une soumission de code : hash + actif.
CREATE INDEX IF NOT EXISTS idx_merchant_referral_codes_hash_active
  ON public.merchant_referral_codes (code_hash)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- 3. merchant_drivers — état (par paire) commerçant↔livreur.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'merchant_driver_status') THEN
    CREATE TYPE public.merchant_driver_status AS ENUM ('pending', 'active', 'blocked');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.merchant_drivers (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id          UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  driver_id            UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  status               public.merchant_driver_status NOT NULL DEFAULT 'pending',
  joined_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  status_changed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Horodatage de révocation : la PWA livreur compare son issued_at de
  -- session avec ce champ ; si la session est antérieure, accès refusé.
  sessions_revoked_at  TIMESTAMPTZ,
  UNIQUE (merchant_id, driver_id)
);

CREATE INDEX IF NOT EXISTS idx_merchant_drivers_merchant_status
  ON public.merchant_drivers (merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_merchant_drivers_driver
  ON public.merchant_drivers (driver_id);

-- ---------------------------------------------------------------------------
-- 4. Journal d'actions (audit) — chaque action commerçant journalisée.
--    Append-only, lecture par le commerçant concerné.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.merchant_driver_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id  UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  driver_id    UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  actor_email  TEXT,
  action       TEXT NOT NULL,   -- code_regenerated | request_accepted | request_refused | driver_blocked | driver_unblocked | driver_removed | code_expiration_set
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_merchant_driver_events_merchant
  ON public.merchant_driver_events (merchant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.drivers                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_referral_codes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_drivers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_driver_events   ENABLE ROW LEVEL SECURITY;

-- drivers : le livreur voit/maintient SON profil (quand il aura un user_id) ;
-- les commerçants voient les drivers qui ont une relation avec eux (jointure).
DROP POLICY IF EXISTS "drivers_select_self" ON public.drivers;
CREATE POLICY "drivers_select_self"
  ON public.drivers FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "drivers_update_self" ON public.drivers;
CREATE POLICY "drivers_update_self"
  ON public.drivers FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "drivers_select_via_merchant_drivers" ON public.drivers;
CREATE POLICY "drivers_select_via_merchant_drivers"
  ON public.drivers FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.merchant_drivers md
      JOIN public.merchants m ON m.id = md.merchant_id
      WHERE md.driver_id = drivers.id
        AND m.user_id = auth.uid()
    )
  );

-- merchant_referral_codes : le commerçant lit/écrit ses propres codes.
-- (le code en clair n'est jamais persisté — ni en colonne ni en log).
DROP POLICY IF EXISTS "merchant_referral_codes_owner_all" ON public.merchant_referral_codes;
CREATE POLICY "merchant_referral_codes_owner_all"
  ON public.merchant_referral_codes FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.merchants m
      WHERE m.id = merchant_referral_codes.merchant_id
        AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.merchants m
      WHERE m.id = merchant_referral_codes.merchant_id
        AND m.user_id = auth.uid()
    )
  );

-- merchant_drivers : le commerçant gère ses relations ; le livreur voit
-- les siennes (read-only — il n'accepte pas lui-même).
DROP POLICY IF EXISTS "merchant_drivers_merchant_all" ON public.merchant_drivers;
CREATE POLICY "merchant_drivers_merchant_all"
  ON public.merchant_drivers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.merchants m
      WHERE m.id = merchant_drivers.merchant_id
        AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.merchants m
      WHERE m.id = merchant_drivers.merchant_id
        AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "merchant_drivers_driver_select_own" ON public.merchant_drivers;
CREATE POLICY "merchant_drivers_driver_select_own"
  ON public.merchant_drivers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = merchant_drivers.driver_id
        AND d.user_id = auth.uid()
    )
  );

-- merchant_driver_events : lecture / insert par le commerçant uniquement
-- (audit unilatéral — append-only via les Server Actions).
DROP POLICY IF EXISTS "merchant_driver_events_merchant_select" ON public.merchant_driver_events;
CREATE POLICY "merchant_driver_events_merchant_select"
  ON public.merchant_driver_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.merchants m
      WHERE m.id = merchant_driver_events.merchant_id
        AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "merchant_driver_events_merchant_insert" ON public.merchant_driver_events;
CREATE POLICY "merchant_driver_events_merchant_insert"
  ON public.merchant_driver_events FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.merchants m
      WHERE m.id = merchant_driver_events.merchant_id
        AND m.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 6. Trigger : maintenir status_changed_at + horodater la révocation
--    quand on bloque un livreur.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merchant_drivers_touch_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
    IF NEW.status = 'blocked' THEN
      NEW.sessions_revoked_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS merchant_drivers_status_change ON public.merchant_drivers;
CREATE TRIGGER merchant_drivers_status_change
  BEFORE UPDATE ON public.merchant_drivers
  FOR EACH ROW EXECUTE FUNCTION public.merchant_drivers_touch_status();
