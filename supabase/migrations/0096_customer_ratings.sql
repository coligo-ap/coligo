-- =============================================================================
-- 0096 — Notation du CLIENT par le LIVREUR (miroir inversé de 0059)
-- =============================================================================
-- Après une livraison, le livreur peut noter le client (1 à 5 + commentaire) :
-- politesse, accessibilité, exactitude de l'adresse… Permet de repérer les
-- clients problématiques (note dénormalisée sur customers).
--
--   • 1 note MAX par commande (UNIQUE order_id).
--   • Insertion : le LIVREUR attribué, commande livrée (status='completed').
--   • Le client NE voit PAS la note qu'on lui a donnée (lecture livreur+admin).
--   • rating_avg / rating_count dénormalisés sur customers via trigger.
-- =============================================================================

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS rating_avg   NUMERIC(3, 2) NOT NULL DEFAULT 0
    CHECK (rating_avg >= 0 AND rating_avg <= 5),
  ADD COLUMN IF NOT EXISTS rating_count INTEGER NOT NULL DEFAULT 0
    CHECK (rating_count >= 0);

CREATE TABLE IF NOT EXISTS public.customer_ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  driver_id   UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT CHECK (comment IS NULL OR char_length(comment) <= 500),
  is_hidden   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_customer_ratings_customer
  ON public.customer_ratings(customer_id, created_at DESC)
  WHERE is_hidden = false;
CREATE INDEX IF NOT EXISTS idx_customer_ratings_driver
  ON public.customer_ratings(driver_id, created_at DESC);

-- Recalcul dénormalisé sur customers.
CREATE OR REPLACE FUNCTION public.refresh_customer_rating(p_customer_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_avg NUMERIC(3,2); v_cnt INTEGER;
BEGIN
  SELECT COALESCE(round(avg(rating)::numeric, 2), 0), count(*)
    INTO v_avg, v_cnt
  FROM public.customer_ratings
  WHERE customer_id = p_customer_id AND is_hidden = false;

  UPDATE public.customers
  SET rating_avg = v_avg, rating_count = v_cnt
  WHERE id = p_customer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_customer_rating_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.customer_id IS DISTINCT FROM NEW.customer_id THEN
    PERFORM public.refresh_customer_rating(OLD.customer_id);
  END IF;
  PERFORM public.refresh_customer_rating(COALESCE(NEW.customer_id, OLD.customer_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trigger_refresh_customer_rating ON public.customer_ratings;
CREATE TRIGGER trigger_refresh_customer_rating
  AFTER INSERT OR UPDATE OR DELETE ON public.customer_ratings
  FOR EACH ROW EXECUTE FUNCTION public.refresh_customer_rating_trigger();

-- Validation métier (ceinture + bretelles avec la RLS).
CREATE OR REPLACE FUNCTION public.validate_customer_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_status TEXT; v_customer UUID; v_driver UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status::text, customer_id, delivery_driver_id
      INTO v_status, v_customer, v_driver
    FROM public.orders WHERE id = NEW.order_id;

    IF v_status IS NULL THEN
      RAISE EXCEPTION 'Commande introuvable.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_status <> 'completed' THEN
      RAISE EXCEPTION 'Notation possible seulement après la livraison.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_driver IS NULL OR v_driver IS DISTINCT FROM NEW.driver_id THEN
      RAISE EXCEPTION 'Cette commande ne t''est pas attribuée.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_customer IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION 'Client incohérent avec la commande.'
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
    IF NEW.rating IS DISTINCT FROM OLD.rating
       OR NEW.comment IS DISTINCT FROM OLD.comment THEN
      NEW.edited_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_customer_rating ON public.customer_ratings;
CREATE TRIGGER trigger_validate_customer_rating
  BEFORE INSERT OR UPDATE ON public.customer_ratings
  FOR EACH ROW EXECUTE FUNCTION public.validate_customer_rating();

ALTER TABLE public.customer_ratings ENABLE ROW LEVEL SECURITY;

-- Lecture : le LIVREUR auteur + le super-admin (le client ne voit pas sa note).
DROP POLICY IF EXISTS customer_ratings_select ON public.customer_ratings;
CREATE POLICY customer_ratings_select ON public.customer_ratings
  FOR SELECT TO authenticated
  USING (
    driver_id = public.driver_id_for_user(auth.uid())
    OR public.is_super_admin()
  );

-- Insertion : le LIVREUR pour lui-même (le trigger valide la cohérence commande).
DROP POLICY IF EXISTS customer_ratings_insert_own ON public.customer_ratings;
CREATE POLICY customer_ratings_insert_own ON public.customer_ratings
  FOR INSERT TO authenticated
  WITH CHECK (driver_id = public.driver_id_for_user(auth.uid()));

-- Édition : le livreur auteur ou l'admin.
DROP POLICY IF EXISTS customer_ratings_update_own_or_admin ON public.customer_ratings;
CREATE POLICY customer_ratings_update_own_or_admin ON public.customer_ratings
  FOR UPDATE TO authenticated
  USING (driver_id = public.driver_id_for_user(auth.uid()) OR public.is_super_admin())
  WITH CHECK (driver_id = public.driver_id_for_user(auth.uid()) OR public.is_super_admin());

-- Suppression : admin uniquement.
DROP POLICY IF EXISTS customer_ratings_delete_admin ON public.customer_ratings;
CREATE POLICY customer_ratings_delete_admin ON public.customer_ratings
  FOR DELETE TO authenticated USING (public.is_super_admin());
