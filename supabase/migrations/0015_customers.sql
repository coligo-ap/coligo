-- =============================================================================
-- Coligo v3 - Migration 0015 : Profil CLIENT (séparé du commerçant)
-- =============================================================================
-- Appliquée via `npm run db:push` (ou copiable dans le SQL Editor Supabase).
--
-- Le côté client (coligo.app) introduit une nouvelle entité utilisateur :
-- - Un `auth.users` peut être un commerçant (row dans `merchants`) OU un client
--   (row dans `customers`). Les deux tables sont SÉPARÉES, la distinction se
--   fait par la présence du user_id dans l'une ou l'autre.
-- - L'inscription client exige email + nom + téléphone + mot de passe.
-- - Pour l'instant, le téléphone est stocké tel quel ; on validera le format
--   côté app (regex algérien).
--
-- RLS : un client ne lit/modifie QUE son profil. La lecture publique des
-- vitrines commerçants (vue `merchants_public`, migration 0014) couvre déjà
-- l'accès anonyme à la liste des commerces.
-- =============================================================================

-- ============================================================================
-- 1. TABLE: customers
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.customers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name             TEXT NOT NULL,
  phone                 TEXT NOT NULL,
  email                 TEXT,
  default_wilaya_code   TEXT,
  default_commune       TEXT,
  latitude              NUMERIC(9, 6),
  longitude             NUMERIC(9, 6),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_user_id        ON public.customers(user_id);
CREATE INDEX IF NOT EXISTS idx_customers_wilaya_commune
  ON public.customers(default_wilaya_code, default_commune);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.set_customers_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_customers_updated_at ON public.customers;
CREATE TRIGGER trigger_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_customers_updated_at();

-- ============================================================================
-- 2. ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers_select_own" ON public.customers
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "customers_insert_own" ON public.customers
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "customers_update_own" ON public.customers
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- 3. Garde-fou : un user ne peut PAS être à la fois client ET commerçant
--    (le compte est UNIQUE par rôle pour rester clair en MVP)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.assert_user_role_uniqueness()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'customers' THEN
    IF EXISTS (SELECT 1 FROM public.merchants WHERE user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'Ce compte est déjà un commerçant.'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'merchants' THEN
    IF EXISTS (SELECT 1 FROM public.customers WHERE user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'Ce compte est déjà un client.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_assert_customer_uniqueness ON public.customers;
CREATE TRIGGER trigger_assert_customer_uniqueness
  BEFORE INSERT ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_user_role_uniqueness();

DROP TRIGGER IF EXISTS trigger_assert_merchant_uniqueness ON public.merchants;
CREATE TRIGGER trigger_assert_merchant_uniqueness
  BEFORE INSERT ON public.merchants
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_user_role_uniqueness();

-- =============================================================================
-- REQUÊTE DE VÉRIFICATION (à exécuter après, dans le SQL Editor) :
--
--   -- 1. Lister les vitrines accessibles aux clients anonymes
--   SELECT slug, name, opening_hours, min_order_da
--   FROM public.merchants_public
--   ORDER BY name LIMIT 10;
--
--   -- 2. Les RLS des `customers` n'autorisent QUE le user lui-même
--   --    (testé en se connectant sous un compte client).
-- =============================================================================
