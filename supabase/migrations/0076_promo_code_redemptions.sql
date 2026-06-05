-- =============================================================================
-- 0076 — Codes promo : suivi d'usage (anti-fraude) + snapshot commande
-- =============================================================================
-- Le moteur (computeCart) applique déjà un code ; il manquait :
--   - l'ENREGISTREMENT des usages (pour plafonds max_uses / par client),
--   - le SNAPSHOT du code sur la commande (audit immuable),
--   - une RPC atomique pour incrémenter uses_count + journaliser, idempotente.
-- Le financeur d'une promo reste MERCHANT (la plateforme ne perd rien) — la
-- réduction baisse simplement le prix net, et la commission se calcule sur ce
-- net (déjà le cas : commission = (total_da - service_fee) * taux).
-- =============================================================================

-- Snapshot du code promo sur la commande (audit). discount_da existant agrège
-- déjà toutes les remises ; ici on garde la trace du CODE précis utilisé.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS promo_id   UUID REFERENCES public.promotions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promo_code TEXT;

-- Journal des usages de codes promo.
CREATE TABLE IF NOT EXISTS public.promotion_redemptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id  UUID NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
  order_id      UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  customer_id   UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  discount_da   INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Idempotence : un code n'est compté qu'une fois par commande.
  CONSTRAINT promo_redemption_order_promo_unique UNIQUE (order_id, promotion_id)
);

CREATE INDEX IF NOT EXISTS idx_promo_redemptions_promo
  ON public.promotion_redemptions(promotion_id);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_customer
  ON public.promotion_redemptions(promotion_id, customer_id);

ALTER TABLE public.promotion_redemptions ENABLE ROW LEVEL SECURITY;

-- Le client LIT ses propres usages (pour le contrôle "déjà utilisé"). Aucune
-- écriture côté client : seule la RPC SECURITY DEFINER insère.
DROP POLICY IF EXISTS "promo_redemptions_select_own" ON public.promotion_redemptions;
CREATE POLICY "promo_redemptions_select_own" ON public.promotion_redemptions
  FOR SELECT USING (
    customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );

-- Lecture super-admin (analytics).
DROP POLICY IF EXISTS "promo_redemptions_select_admin" ON public.promotion_redemptions;
CREATE POLICY "promo_redemptions_select_admin" ON public.promotion_redemptions
  FOR SELECT USING (public.is_super_admin());

-- RPC : journalise un usage + incrémente uses_count, ATOMIQUE et IDEMPOTENTE.
-- Appelée après la création de la commande. Best-effort sur les plafonds (la
-- validation principale est faite côté serveur AVANT l'insert) ; ici on garde
-- l'intégrité du compteur et la trace.
CREATE OR REPLACE FUNCTION public.redeem_promo(
  p_promotion_id uuid,
  p_order_id uuid,
  p_customer_id uuid,
  p_code text,
  p_discount_da integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted boolean := false;
BEGIN
  INSERT INTO public.promotion_redemptions
    (promotion_id, order_id, customer_id, code, discount_da)
  VALUES (p_promotion_id, p_order_id, p_customer_id, p_code,
          GREATEST(0, COALESCE(p_discount_da, 0)))
  ON CONFLICT (order_id, promotion_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- N'incrémente le compteur global que si une NOUVELLE ligne a été insérée
  -- (évite le double comptage sur re-soumission idempotente d'une commande).
  IF v_inserted THEN
    UPDATE public.promotions
    SET uses_count = COALESCE(uses_count, 0) + 1
    WHERE id = p_promotion_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_promo(uuid, uuid, uuid, text, integer)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.redeem_promo(uuid, uuid, uuid, text, integer)
  TO authenticated;
