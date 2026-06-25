-- =============================================================================
-- 0260 — promotion_products : le produit lié DOIT appartenir au même commerçant
-- =============================================================================
-- Bug constaté : le formulaire de promo listait les produits de TOUTES les
-- boutiques (getMerchantProductsLite sans filtre merchant → s'appuyait sur le
-- RLS public des produits). Un commerçant pouvait donc associer à sa promo le
-- produit d'une AUTRE boutique. Côté client, le catalogue est scopé par
-- commerçant → ce produit n'apparaissait jamais (carrousel « Achat offert » /
-- réductions vides).
--
-- Correctifs : (1) nettoyage des liens incohérents existants ; (2) garde
-- inviolable côté DB (trigger) refusant tout lien cross-commerçant — backstop
-- du filtre applicatif (getMerchantProductsLite scopé par merchant).
-- =============================================================================

-- 1) Nettoyage : supprime les liens promo→produit cross-commerçant existants.
DELETE FROM public.promotion_products pp
USING public.promotions p, public.products pr
WHERE pp.promotion_id = p.id
  AND pp.product_id = pr.id
  AND pr.merchant_id <> p.merchant_id;

-- 2) Garde : un promotion_product ne peut lier qu'un produit du même commerçant
--    que la promotion. SECURITY DEFINER pour lire promotions/products sans RLS.
CREATE OR REPLACE FUNCTION public.enforce_promotion_product_same_merchant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_promo_merchant   UUID;
  v_product_merchant UUID;
BEGIN
  SELECT merchant_id INTO v_promo_merchant
    FROM public.promotions WHERE id = NEW.promotion_id;
  SELECT merchant_id INTO v_product_merchant
    FROM public.products WHERE id = NEW.product_id;

  IF v_promo_merchant IS NULL
     OR v_product_merchant IS NULL
     OR v_promo_merchant <> v_product_merchant THEN
    RAISE EXCEPTION
      'promotion_products: le produit (%) doit appartenir au même commerçant que la promotion (%)',
      NEW.product_id, NEW.promotion_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promotion_product_same_merchant ON public.promotion_products;
CREATE TRIGGER trg_promotion_product_same_merchant
  BEFORE INSERT OR UPDATE ON public.promotion_products
  FOR EACH ROW EXECUTE FUNCTION public.enforce_promotion_product_same_merchant();
