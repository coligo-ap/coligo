-- =============================================================================
-- 0059 — Avis client sur les LIVREURS (miroir de 0027 reviews commerçant)
-- =============================================================================
-- Le client peut noter le LIVREUR d'une commande livrée (1 à 5 + commentaire).
--   - 1 avis MAX par commande (UNIQUE order_id).
--   - Insertion autorisée si : commande au client connecté, status='completed',
--     et le livreur noté = celui assigné à la commande (delivery_driver_id).
--   - Édition par le client pendant 24h. Suppression = admin (modération).
--   - rating_avg / rating_count dénormalisés sur drivers via trigger.
-- =============================================================================

-- 1. Colonnes cache sur drivers
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS rating_avg   NUMERIC(3, 2) NOT NULL DEFAULT 0
    CHECK (rating_avg >= 0 AND rating_avg <= 5),
  ADD COLUMN IF NOT EXISTS rating_count INTEGER NOT NULL DEFAULT 0
    CHECK (rating_count >= 0);

-- 2. Table driver_reviews
CREATE TABLE IF NOT EXISTS public.driver_reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  driver_id   UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT CHECK (comment IS NULL OR char_length(comment) <= 500),
  is_hidden   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_driver_reviews_driver
  ON public.driver_reviews(driver_id, created_at DESC)
  WHERE is_hidden = false;
CREATE INDEX IF NOT EXISTS idx_driver_reviews_customer
  ON public.driver_reviews(customer_id, created_at DESC);

-- 3. Recalcul rating_avg / rating_count
CREATE OR REPLACE FUNCTION public.refresh_driver_rating(p_driver_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_avg NUMERIC(3,2); v_cnt INTEGER;
BEGIN
  SELECT COALESCE(round(avg(rating)::numeric, 2), 0), count(*)
    INTO v_avg, v_cnt
  FROM public.driver_reviews
  WHERE driver_id = p_driver_id AND is_hidden = false;

  UPDATE public.drivers
  SET rating_avg = v_avg, rating_count = v_cnt
  WHERE id = p_driver_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_driver_rating_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.driver_id IS DISTINCT FROM NEW.driver_id THEN
    PERFORM public.refresh_driver_rating(OLD.driver_id);
  END IF;
  PERFORM public.refresh_driver_rating(COALESCE(NEW.driver_id, OLD.driver_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trigger_refresh_driver_rating ON public.driver_reviews;
CREATE TRIGGER trigger_refresh_driver_rating
  AFTER INSERT OR UPDATE OR DELETE ON public.driver_reviews
  FOR EACH ROW EXECUTE FUNCTION public.refresh_driver_rating_trigger();

-- 4. Validation métier (ceinture + bretelles avec la RLS)
CREATE OR REPLACE FUNCTION public.validate_driver_review()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT; v_customer UUID; v_driver UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status::text, customer_id, delivery_driver_id
      INTO v_status, v_customer, v_driver
    FROM public.orders WHERE id = NEW.order_id;

    IF v_status IS NULL THEN
      RAISE EXCEPTION 'Commande introuvable.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_status <> 'completed' THEN
      RAISE EXCEPTION 'Tu peux noter le livreur uniquement après la livraison.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_customer IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION 'Cette commande ne t''appartient pas.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_driver IS NULL OR v_driver IS DISTINCT FROM NEW.driver_id THEN
      RAISE EXCEPTION 'Livreur incohérent avec la commande.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.order_id IS DISTINCT FROM OLD.order_id
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
      RAISE EXCEPTION 'Modification interdite de ces champs.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.created_at < now() - INTERVAL '24 hours' THEN
      IF NEW.rating IS DISTINCT FROM OLD.rating
         OR NEW.comment IS DISTINCT FROM OLD.comment THEN
        RAISE EXCEPTION 'Ton avis n''est plus modifiable (24h passées).'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NEW.rating IS DISTINCT FROM OLD.rating
       OR NEW.comment IS DISTINCT FROM OLD.comment THEN
      NEW.edited_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_driver_review ON public.driver_reviews;
CREATE TRIGGER trigger_validate_driver_review
  BEFORE INSERT OR UPDATE ON public.driver_reviews
  FOR EACH ROW EXECUTE FUNCTION public.validate_driver_review();

-- 5. RLS
ALTER TABLE public.driver_reviews ENABLE ROW LEVEL SECURITY;

-- Lecture : avis non masqués visibles ; le client voit les siens ; le LIVREUR
-- concerné voit les avis le concernant ; l'admin voit tout.
DROP POLICY IF EXISTS "driver_reviews_select" ON public.driver_reviews;
CREATE POLICY "driver_reviews_select" ON public.driver_reviews
  FOR SELECT TO anon, authenticated
  USING (
    is_hidden = false
    OR customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
    OR driver_id = public.driver_id_for_user(auth.uid())
    OR public.is_super_admin()
  );

-- Insertion : le client propriétaire de la commande.
DROP POLICY IF EXISTS "driver_reviews_insert_own" ON public.driver_reviews;
CREATE POLICY "driver_reviews_insert_own" ON public.driver_reviews
  FOR INSERT
  WITH CHECK (
    customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );

-- Édition : client (fenêtre 24h via trigger) ou admin.
DROP POLICY IF EXISTS "driver_reviews_update_own_or_admin" ON public.driver_reviews;
CREATE POLICY "driver_reviews_update_own_or_admin" ON public.driver_reviews
  FOR UPDATE
  USING (
    public.is_super_admin()
    OR customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  )
  WITH CHECK (
    public.is_super_admin()
    OR customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );

-- Suppression : admin uniquement.
DROP POLICY IF EXISTS "driver_reviews_delete_admin" ON public.driver_reviews;
CREATE POLICY "driver_reviews_delete_admin" ON public.driver_reviews
  FOR DELETE USING (public.is_super_admin());
