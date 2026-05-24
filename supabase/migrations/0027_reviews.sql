-- =============================================================================
-- Coligo v3 - Migration 0027 : système d'avis client (robuste anti-casse)
-- =============================================================================
-- ⚠️ Source de vérité pour la réputation des commerçants → règles strictes :
--   - 1 avis MAXIMUM par commande (UNIQUE order_id) — impossible de spammer.
--   - Insertion autorisée UNIQUEMENT si :
--       * la commande appartient au client connecté
--       * status = 'completed'
--       * aucun avis n'existe déjà sur cette commande (couvert par UNIQUE)
--   - Édition autorisée par le propriétaire pendant 24h max après création.
--     Après ça l'avis est figé pour le client (admin peut toujours masquer).
--   - Suppression INTERDITE côté client. Modération via is_hidden (super-admin).
--   - Recalcul de rating_avg / rating_count via TRIGGER SECURITY DEFINER —
--     pas manipulable côté client, atomique avec l'insert.
-- =============================================================================

-- ============================================================================
-- 1. Colonnes dénormalisées sur merchants (cache lecture)
-- ============================================================================
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS rating_avg   NUMERIC(3, 2) NOT NULL DEFAULT 0
    CHECK (rating_avg >= 0 AND rating_avg <= 5),
  ADD COLUMN IF NOT EXISTS rating_count INTEGER NOT NULL DEFAULT 0
    CHECK (rating_count >= 0);

-- ============================================================================
-- 2. Table reviews
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT
              CHECK (comment IS NULL OR char_length(comment) <= 500),
  is_hidden   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reviews_merchant
  ON public.reviews(merchant_id, created_at DESC)
  WHERE is_hidden = false;
CREATE INDEX IF NOT EXISTS idx_reviews_customer
  ON public.reviews(customer_id, created_at DESC);

-- ============================================================================
-- 3. Fonction de recalcul rating_avg / rating_count (atomique, idempotente)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.refresh_merchant_rating(p_merchant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_avg NUMERIC(3, 2);
  v_cnt INTEGER;
BEGIN
  SELECT
    COALESCE(round(avg(rating)::numeric, 2), 0),
    count(*)
  INTO v_avg, v_cnt
  FROM public.reviews
  WHERE merchant_id = p_merchant_id
    AND is_hidden = false;

  UPDATE public.merchants
  SET rating_avg = v_avg, rating_count = v_cnt
  WHERE id = p_merchant_id;
END;
$$;

-- Trigger sur reviews : recalcule à chaque INSERT/UPDATE/DELETE.
CREATE OR REPLACE FUNCTION public.refresh_merchant_rating_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- En cas de changement de merchant_id (rare/inattendu), on rafraîchit
  -- ancien et nouveau.
  IF TG_OP = 'UPDATE' AND OLD.merchant_id IS DISTINCT FROM NEW.merchant_id THEN
    PERFORM public.refresh_merchant_rating(OLD.merchant_id);
  END IF;
  PERFORM public.refresh_merchant_rating(
    COALESCE(NEW.merchant_id, OLD.merchant_id)
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trigger_refresh_merchant_rating ON public.reviews;
CREATE TRIGGER trigger_refresh_merchant_rating
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_merchant_rating_trigger();

-- ============================================================================
-- 4. Trigger de validation : empêche insert/update qui violent les règles
--    métier (en plus de la RLS, ceinture+bretelles).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.validate_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_status TEXT;
  v_order_customer UUID;
  v_order_merchant UUID;
BEGIN
  -- INSERT : la commande doit être 'completed' et appartenir au customer.
  IF TG_OP = 'INSERT' THEN
    SELECT status::text, customer_id, merchant_id
    INTO v_order_status, v_order_customer, v_order_merchant
    FROM public.orders WHERE id = NEW.order_id;

    IF v_order_status IS NULL THEN
      RAISE EXCEPTION 'Commande introuvable.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_order_status <> 'completed' THEN
      RAISE EXCEPTION
        'Tu peux noter ta commande uniquement après l''avoir récupérée.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_order_customer IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION 'Cette commande ne t''appartient pas.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_order_merchant IS DISTINCT FROM NEW.merchant_id THEN
      RAISE EXCEPTION 'Incohérence commerçant/commande.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- UPDATE : autorisé seulement < 24h après création, et seul rating/comment
  -- peuvent changer (pas order_id/customer_id/merchant_id).
  IF TG_OP = 'UPDATE' THEN
    IF NEW.order_id IS DISTINCT FROM OLD.order_id
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id THEN
      RAISE EXCEPTION 'Modification interdite de ces champs.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.created_at < now() - INTERVAL '24 hours' THEN
      -- On laisse passer SEULEMENT si seul is_hidden change (modération admin).
      IF NEW.rating IS DISTINCT FROM OLD.rating
         OR NEW.comment IS DISTINCT FROM OLD.comment THEN
        RAISE EXCEPTION
          'Ton avis n''est plus modifiable (24h passées).'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    -- Marqueur d'édition si rating/comment changent.
    IF NEW.rating IS DISTINCT FROM OLD.rating
       OR NEW.comment IS DISTINCT FROM OLD.comment THEN
      NEW.edited_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_review ON public.reviews;
CREATE TRIGGER trigger_validate_review
  BEFORE INSERT OR UPDATE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_review();

-- ============================================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- Lecture publique : tout le monde voit les avis non masqués (vitrine).
-- Le client voit AUSSI ses propres avis masqués (transparence).
DROP POLICY IF EXISTS "reviews_select_public" ON public.reviews;
CREATE POLICY "reviews_select_public" ON public.reviews
  FOR SELECT
  TO anon, authenticated
  USING (
    is_hidden = false
    OR customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
    OR public.is_super_admin()
  );

-- Insertion : uniquement le propriétaire de la commande peut écrire un avis
-- sur elle. La règle "commande completed" est en plus appliquée par le trigger
-- de validation (et le UNIQUE order_id bloque les doublons).
DROP POLICY IF EXISTS "reviews_insert_own" ON public.reviews;
CREATE POLICY "reviews_insert_own" ON public.reviews
  FOR INSERT
  WITH CHECK (
    customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );

-- Mise à jour : le client peut éditer son avis (le trigger valide la fenêtre
-- 24h et les champs autorisés). Le super-admin peut tout (modération).
DROP POLICY IF EXISTS "reviews_update_own_or_admin" ON public.reviews;
CREATE POLICY "reviews_update_own_or_admin" ON public.reviews
  FOR UPDATE
  USING (
    public.is_super_admin()
    OR customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  )
  WITH CHECK (
    public.is_super_admin()
    OR customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );

-- Suppression : admin uniquement (modération).
DROP POLICY IF EXISTS "reviews_delete_admin" ON public.reviews;
CREATE POLICY "reviews_delete_admin" ON public.reviews
  FOR DELETE
  USING (public.is_super_admin());

-- =============================================================================
-- VÉRIF :
--   SELECT public.refresh_merchant_rating('<merchant_uuid>');
--   SELECT rating_avg, rating_count FROM public.merchants;
-- =============================================================================
