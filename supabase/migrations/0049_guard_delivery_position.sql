-- =============================================================================
-- 0049 — Garde-fou : delivery_enabled exige une position lat/lng
-- =============================================================================
-- Bug observé : un commerçant peut avoir `delivery_enabled=true` sans
-- latitude/longitude (ex. ancien profil avant que l'UI n'exige la position).
-- Résultat : côté checkout client, `fetchCheckoutContext` calcule
-- `deliveryEnabled = delivery_enabled && lat != null && lng != null` qui
-- retourne `false`, et la section livraison reste invisible.
--
-- Fix permanent :
--  1) Trigger BEFORE INSERT/UPDATE qui désactive delivery_enabled si la
--     position est manquante (cohérence DB).
--  2) Nettoyage immédiat des lignes existantes : si delivery_enabled=true
--     sans lat/lng → on force delivery_enabled=false (le commerçant doit
--     repasser par /settings/delivery pour pointer sa boutique).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ensure_delivery_position()
RETURNS TRIGGER AS $$
BEGIN
  -- Désactive la livraison si la position est absente : la distance
  -- commerçant ↔ client est indispensable pour calculer les frais.
  IF NEW.delivery_enabled
     AND (NEW.latitude IS NULL OR NEW.longitude IS NULL) THEN
    NEW.delivery_enabled := false;
    NEW.express_enabled := false;
    NEW.tours_enabled := false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ensure_delivery_position ON public.merchants;
CREATE TRIGGER trg_ensure_delivery_position
  BEFORE INSERT OR UPDATE ON public.merchants
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_delivery_position();

-- Nettoyage immédiat : aligne les données existantes.
UPDATE public.merchants
   SET delivery_enabled = false,
       express_enabled  = false,
       tours_enabled    = false
 WHERE delivery_enabled = true
   AND (latitude IS NULL OR longitude IS NULL);
