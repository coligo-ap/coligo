-- =============================================================================
-- 0119 — Prix de livraison TOURNÉE « par zone » fixé par le commerçant
-- =============================================================================
-- Contexte : en TOURNÉE, le commerçant fait sa livraison en propre (ses livreurs
-- inscrits, ses créneaux). Il doit pouvoir FIXER son prix de livraison par bande
-- de distance — MAIS jamais au-dessus du prix « juste » du barème plateforme,
-- sinon des prix excessifs casseraient l'image « prix imbattables » de Coligo.
--
-- Modèle retenu (validé fondateur 2026-06-09) :
--   • 3 bandes de distance par défaut : 0–3 km, 3–6 km, 6–10 km (max_km = borne haute).
--   • Pour chaque bande, le commerçant fixe `price_da`. DÉFAUT = PLAFOND = le prix
--     barème plateforme à la borne haute de la bande. Le commerçant peut SEULEMENT
--     DESCENDRE sous ce plafond (pour être attractif), jamais le dépasser.
--   • Plancher = delivery_min_da (pour ne pas brader au point de ruiner le livreur).
--   • Le plafond est IMPOSÉ par un trigger serveur (clamp), donc inviolable même
--     en contournant l'UI.
--
-- L'EXPRESS reste 100 % barème plateforme (livreurs indépendants) — non concerné.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Barème plateforme en SQL (miroir exact de lib/delivery/pricing.ts) :
--    fee = clamp(base + max(0, km − free_km) × per_km, [min, max]).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_delivery_fee_da(p_km NUMERIC)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT LEAST(
           GREATEST(
             round(
               s.delivery_base_da
               + GREATEST(0, GREATEST(0, p_km) - s.delivery_free_km_threshold)
                 * s.delivery_per_km_da
             )::INTEGER,
             s.delivery_min_da
           ),
           s.delivery_max_da
         )
  FROM public.platform_settings s
  WHERE s.id = true;
$$;

GRANT EXECUTE ON FUNCTION public.platform_delivery_fee_da(NUMERIC) TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. Table des zones (bandes) par commerçant.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.merchant_delivery_zones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  band_index  INTEGER NOT NULL,                 -- 0,1,2 (ordre croissant)
  max_km      NUMERIC(4, 1) NOT NULL CHECK (max_km > 0),
  price_da    INTEGER NOT NULL CHECK (price_da >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mdz_merchant_band_unique UNIQUE (merchant_id, band_index)
);

CREATE INDEX IF NOT EXISTS idx_mdz_merchant ON public.merchant_delivery_zones (merchant_id);

-- ---------------------------------------------------------------------------
-- 3. Clamp serveur du prix : plancher = delivery_min_da, plafond = barème à la
--    borne haute. INVIOLABLE (s'applique même si l'UI envoie un prix excessif).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clamp_merchant_delivery_zone_price()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_min     INTEGER;
  v_ceiling INTEGER;
BEGIN
  SELECT delivery_min_da INTO v_min FROM public.platform_settings WHERE id = true;
  v_ceiling := public.platform_delivery_fee_da(NEW.max_km);
  NEW.price_da   := LEAST(GREATEST(NEW.price_da, COALESCE(v_min, 0)), v_ceiling);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clamp_mdz_price_trg ON public.merchant_delivery_zones;
CREATE TRIGGER clamp_mdz_price_trg
  BEFORE INSERT OR UPDATE ON public.merchant_delivery_zones
  FOR EACH ROW EXECUTE FUNCTION public.clamp_merchant_delivery_zone_price();

-- ---------------------------------------------------------------------------
-- 4. ensure_merchant_delivery_zones — crée les 3 bandes par défaut si absentes
--    (prix par défaut = plafond barème de la bande). Idempotent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_merchant_delivery_zones(p_merchant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.merchant_delivery_zones (merchant_id, band_index, max_km, price_da)
  VALUES
    (p_merchant_id, 0, 3.0,  public.platform_delivery_fee_da(3.0)),
    (p_merchant_id, 1, 6.0,  public.platform_delivery_fee_da(6.0)),
    (p_merchant_id, 2, 10.0, public.platform_delivery_fee_da(10.0))
  ON CONFLICT (merchant_id, band_index) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_merchant_delivery_zones(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. tour_delivery_fee_da — prix tournée pour une distance : la bande dont la
--    borne haute couvre la distance (la plus petite max_km ≥ distance). NULL si
--    aucune bande (= au-delà de la dernière borne / hors zone).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tour_delivery_fee_da(
  p_merchant_id UUID,
  p_distance_km NUMERIC
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT z.price_da
  FROM public.merchant_delivery_zones z
  WHERE z.merchant_id = p_merchant_id
    AND z.max_km >= GREATEST(0, p_distance_km)
  ORDER BY z.max_km ASC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.tour_delivery_fee_da(UUID, NUMERIC) TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- 6. RLS : le commerçant gère ses zones ; lecture publique (juste des prix,
--    nécessaire au checkout client pour afficher le tarif tournée).
-- ---------------------------------------------------------------------------
ALTER TABLE public.merchant_delivery_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mdz_select_public ON public.merchant_delivery_zones;
CREATE POLICY mdz_select_public ON public.merchant_delivery_zones
  FOR SELECT USING (true);

DROP POLICY IF EXISTS mdz_merchant_all ON public.merchant_delivery_zones;
CREATE POLICY mdz_merchant_all ON public.merchant_delivery_zones
  FOR ALL
  USING (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  )
  WITH CHECK (
    merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 7. Backfill : bandes par défaut pour tous les commerçants existants.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.merchants LOOP
    PERFORM public.ensure_merchant_delivery_zones(r.id);
  END LOOP;
END $$;
