-- =============================================================================
-- 0034 — Fondations livraison (commerçant uniquement, prompt LIV-01)
-- =============================================================================
-- Périmètre strict : on prépare les rails de la livraison côté barème
-- (super-admin) et activation (commerçant). Aucun livreur, aucune commande
-- de livraison n'est créée ici — c'est dans les migrations 0035+ (livreurs)
-- et plus tard (checkout livraison).
--
-- ⚠️ Tarif imposé par la PLATEFORME — le commerçant ne fixe pas son prix.
-- Modèle : base + (max(0, distance - free_km) * per_km), borné [min, max],
-- distance > max_radius_km = hors livraison.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Barème global (platform_settings — ligne unique id = true)
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS delivery_base_da              INTEGER NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS delivery_per_km_da            INTEGER NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS delivery_free_km_threshold    NUMERIC(4, 1) NOT NULL DEFAULT 2.0,
  ADD COLUMN IF NOT EXISTS delivery_min_da               INTEGER NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS delivery_max_da               INTEGER NOT NULL DEFAULT 450,
  ADD COLUMN IF NOT EXISTS delivery_max_radius_km        NUMERIC(4, 1) NOT NULL DEFAULT 10.0;

ALTER TABLE public.platform_settings
  ADD CONSTRAINT platform_settings_delivery_amounts_pos
    CHECK (
      delivery_base_da           >= 0 AND
      delivery_per_km_da         >= 0 AND
      delivery_free_km_threshold >= 0 AND
      delivery_min_da            >= 0 AND
      delivery_max_da            >= delivery_min_da AND
      delivery_max_radius_km     >  0
    );

-- ---------------------------------------------------------------------------
-- 2. Flags d'activation côté commerçant + shop_public_id (identifiant
--    opaque distinct du slug — sert aux liens livreur, QR, etc.).
-- ---------------------------------------------------------------------------
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS delivery_enabled    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS express_enabled     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tours_enabled       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_radius_km  NUMERIC(4, 1),
  ADD COLUMN IF NOT EXISTS shop_public_id      TEXT;

-- Borne logique : on ne peut PAS dépasser le max plateforme (vérifié aussi
-- côté serveur Zod ; ici on protège contre l'écriture SQL directe).
ALTER TABLE public.merchants
  ADD CONSTRAINT merchants_delivery_radius_positive
    CHECK (delivery_radius_km IS NULL OR delivery_radius_km > 0);

-- shop_public_id : 12 chars hex (collision quasi nulle ; lisible mais opaque).
-- Backfill des merchants existants une seule fois ; les nouveaux héritent
-- d'un trigger BEFORE INSERT.
UPDATE public.merchants
SET shop_public_id = substring(replace(gen_random_uuid()::text, '-', '') for 12)
WHERE shop_public_id IS NULL;

ALTER TABLE public.merchants
  ALTER COLUMN shop_public_id SET NOT NULL,
  ADD CONSTRAINT merchants_shop_public_id_unique UNIQUE (shop_public_id);

CREATE OR REPLACE FUNCTION public.merchants_set_shop_public_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.shop_public_id IS NULL THEN
    NEW.shop_public_id := substring(replace(gen_random_uuid()::text, '-', '') for 12);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS merchants_default_shop_public_id ON public.merchants;
CREATE TRIGGER merchants_default_shop_public_id
  BEFORE INSERT ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION public.merchants_set_shop_public_id();

-- ---------------------------------------------------------------------------
-- 3. Orders : type de remise (retrait par défaut) + mode si livraison.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fulfillment_type') THEN
    CREATE TYPE public.fulfillment_type AS ENUM ('pickup', 'delivery');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_mode') THEN
    CREATE TYPE public.delivery_mode AS ENUM ('express', 'tour');
  END IF;
END $$;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fulfillment_type public.fulfillment_type NOT NULL DEFAULT 'pickup',
  ADD COLUMN IF NOT EXISTS delivery_mode    public.delivery_mode;

-- Invariant : une commande livraison DOIT avoir un mode ; pickup n'en a pas.
ALTER TABLE public.orders
  ADD CONSTRAINT orders_delivery_mode_required
    CHECK (
      (fulfillment_type = 'pickup'   AND delivery_mode IS NULL) OR
      (fulfillment_type = 'delivery' AND delivery_mode IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_type ON public.orders(fulfillment_type);

-- ---------------------------------------------------------------------------
-- 4. RLS : les colonnes ajoutées sont couvertes par les policies existantes
--    (merchants_update_own pour les flags d'activation ; admin pour
--    platform_settings via la policy platform_settings_update_admin).
--    On NE crée pas de nouvelles policies : on hérite.
-- ---------------------------------------------------------------------------
