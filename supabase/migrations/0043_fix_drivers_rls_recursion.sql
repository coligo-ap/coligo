-- =============================================================================
-- 0043 — Fix récursion infinie RLS drivers ↔ merchant_drivers
-- =============================================================================
-- Bug détecté par test bout-en-bout : un SELECT en contexte authenticated qui
-- traverse à la fois `drivers` ET `merchant_drivers` (ex: depuis
-- `driver_availability` qui JOIN les deux) déclenche une boucle infinie :
--
--   drivers RLS                                          merchant_drivers RLS
--     drivers_select_via_merchant_drivers   ────▶          merchant_drivers_driver_select_own
--       (SELECT merchant_drivers JOIN merchants)             (SELECT drivers WHERE user_id=auth.uid())
--                                          ◀────                                           │
--                                              (réévalue drivers RLS → boucle)
--
-- Fix : on remplace les sous-requêtes croisées par un helper SECURITY DEFINER
-- qui bypass RLS pour le lookup, retournant juste l'id du driver lié à un user.
-- Les policies peuvent alors comparer des UUIDs sans relancer une évaluation
-- des policies sur la table opposée.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.driver_id_for_user(p_user_id UUID)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT id FROM public.drivers WHERE user_id = p_user_id LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.driver_id_for_user(UUID) TO authenticated;

-- Helper : un merchant possède-t-il ce merchant_driver_id (sans RLS).
CREATE OR REPLACE FUNCTION public.user_owns_merchant_driver(p_md_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.merchant_drivers md
    JOIN public.merchants m ON m.id = md.merchant_id
    WHERE md.id = p_md_id AND m.user_id = auth.uid()
  )
$$;

GRANT EXECUTE ON FUNCTION public.user_owns_merchant_driver(UUID) TO authenticated;

-- =============================================================================
-- Réécriture des policies qui causaient la récursion
-- =============================================================================

-- 1. drivers : la lecture "via merchant_drivers" passe par le helper.
DROP POLICY IF EXISTS "drivers_select_via_merchant_drivers" ON public.drivers;
CREATE POLICY "drivers_select_via_merchant_drivers"
  ON public.drivers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.merchant_drivers md
      WHERE md.driver_id = drivers.id
        AND md.merchant_id IN (
          SELECT id FROM public.merchants WHERE user_id = auth.uid()
        )
    )
  );

-- 2. merchant_drivers : la lecture côté livreur compare directement à
--    driver_id_for_user(auth.uid()) — un UUID, pas de sous-SELECT sur drivers
--    qui aurait pu déclencher la récursion.
DROP POLICY IF EXISTS "merchant_drivers_driver_select_own" ON public.merchant_drivers;
CREATE POLICY "merchant_drivers_driver_select_own"
  ON public.merchant_drivers FOR SELECT
  USING (driver_id = public.driver_id_for_user(auth.uid()));

-- 3. driver_availability : même pattern. Le livreur compare son own driver_id
--    via le helper plutôt que via un JOIN sur drivers.
DROP POLICY IF EXISTS "driver_availability_driver_all" ON public.driver_availability;
CREATE POLICY "driver_availability_driver_all"
  ON public.driver_availability FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.merchant_drivers md
      WHERE md.id = driver_availability.merchant_driver_id
        AND md.status = 'active'
        AND md.driver_id = public.driver_id_for_user(auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.merchant_drivers md
      WHERE md.id = driver_availability.merchant_driver_id
        AND md.status = 'active'
        AND md.driver_id = public.driver_id_for_user(auth.uid())
    )
  );

-- 4. delivery_slots côté livreur — même fix.
DROP POLICY IF EXISTS "delivery_slots_driver_select" ON public.delivery_slots;
CREATE POLICY "delivery_slots_driver_select"
  ON public.delivery_slots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.merchant_drivers md
      WHERE md.merchant_id = delivery_slots.merchant_id
        AND md.status = 'active'
        AND md.driver_id = public.driver_id_for_user(auth.uid())
    )
  );

-- 5. delivery_tours côté livreur.
DROP POLICY IF EXISTS "delivery_tours_driver" ON public.delivery_tours;
CREATE POLICY "delivery_tours_driver"
  ON public.delivery_tours FOR ALL
  USING (driver_id = public.driver_id_for_user(auth.uid()))
  WITH CHECK (driver_id = public.driver_id_for_user(auth.uid()));

-- 6. tour_stops côté livreur — compare via tours.driver_id, lui-même filtré
--    sans sous-requête sur drivers.
DROP POLICY IF EXISTS "tour_stops_driver" ON public.tour_stops;
CREATE POLICY "tour_stops_driver"
  ON public.tour_stops FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.delivery_tours t
      WHERE t.id = tour_stops.tour_id
        AND t.driver_id = public.driver_id_for_user(auth.uid())
    )
  );

-- 7. delivery_ledger côté livreur.
DROP POLICY IF EXISTS "delivery_ledger_driver_select" ON public.delivery_ledger;
CREATE POLICY "delivery_ledger_driver_select"
  ON public.delivery_ledger FOR SELECT
  USING (driver_id = public.driver_id_for_user(auth.uid()));
