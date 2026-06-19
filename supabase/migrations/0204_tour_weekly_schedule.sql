-- =============================================================================
-- 0204 — Planning de tournée RÉCURRENT par jour de la semaine
-- =============================================================================
-- Le commerçant ne crée plus des créneaux date par date : il définit un planning
-- hebdomadaire (lun→dim, plusieurs plages horaires + capacité par plage). Les
-- créneaux datés concrets (`delivery_slots`, auxquels les commandes se
-- rattachent) sont MATÉRIALISÉS à la lecture pour les prochains jours via
-- ensure_tour_slots(), bornés par merchant.max_days_ahead (réservation à
-- l'avance, défaut 7, configurable).
--
-- weekday : 0 = dimanche … 6 = samedi (convention EXTRACT(DOW) / JS getDay()).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.merchant_tour_schedule (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id  UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  weekday      SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  max_orders   INTEGER NOT NULL CHECK (max_orders > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT merchant_tour_schedule_time_order CHECK (start_time < end_time),
  UNIQUE (merchant_id, weekday, start_time, end_time)
);

CREATE INDEX IF NOT EXISTS idx_tour_schedule_merchant
  ON public.merchant_tour_schedule (merchant_id, weekday);

ALTER TABLE public.merchant_tour_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tour_schedule_merchant_all" ON public.merchant_tour_schedule;
CREATE POLICY "tour_schedule_merchant_all"
  ON public.merchant_tour_schedule FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.merchants m
            WHERE m.id = merchant_tour_schedule.merchant_id AND m.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.merchants m
            WHERE m.id = merchant_tour_schedule.merchant_id AND m.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Idempotence de la matérialisation : une occurrence = (merchant, date, début,
-- fin) unique. On déduplique d'abord les éventuels doublons SANS commande.
-- ---------------------------------------------------------------------------
DELETE FROM public.delivery_slots a
USING public.delivery_slots b
WHERE a.merchant_id = b.merchant_id
  AND a.slot_date   = b.slot_date
  AND a.start_time  = b.start_time
  AND a.end_time    = b.end_time
  AND a.id > b.id
  AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.delivery_slot_id = a.id);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_slots_uniq_occurrence
  ON public.delivery_slots (merchant_id, slot_date, start_time, end_time);

-- ---------------------------------------------------------------------------
-- ensure_tour_slots : matérialise (et synchronise) les créneaux datés des
-- prochains jours à partir du planning hebdomadaire du commerçant.
--   • horizon = LEAST(max_days_ahead, 30) jours, en heure d'Alger.
--   • upsert : crée les occurrences manquantes, met à jour la capacité des
--     occurrences OUVERTES si le planning a changé.
--   • nettoyage : supprime les occurrences futures OUVERTES qui ne sont plus
--     dans le planning ET sans commande rattachée (ex. plage retirée).
-- SECURITY DEFINER : appelée côté client (checkout) qui n'a pas le droit
-- d'écrire dans delivery_slots ; ne touche QUE les créneaux du commerçant visé.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_tour_slots(p_merchant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tours   BOOLEAN;
  v_days    INTEGER;
  v_today   DATE := (now() AT TIME ZONE 'Africa/Algiers')::date;
  v_horizon DATE;
BEGIN
  SELECT tours_enabled, COALESCE(max_days_ahead, 7)
    INTO v_tours, v_days
  FROM public.merchants
  WHERE id = p_merchant_id;

  IF NOT FOUND OR NOT v_tours THEN
    RETURN;
  END IF;

  v_days := LEAST(GREATEST(v_days, 0), 30);
  v_horizon := v_today + v_days;

  -- 1. Matérialisation des occurrences à venir depuis le planning.
  INSERT INTO public.delivery_slots
    (merchant_id, slot_date, start_time, end_time, max_orders, status)
  SELECT p_merchant_id, d::date, s.start_time, s.end_time, s.max_orders, 'open'
  FROM generate_series(v_today, v_horizon, interval '1 day') AS d
  JOIN public.merchant_tour_schedule s
    ON s.merchant_id = p_merchant_id
   AND s.weekday = EXTRACT(DOW FROM d)::int
  ON CONFLICT (merchant_id, slot_date, start_time, end_time)
  DO UPDATE SET max_orders = EXCLUDED.max_orders
  WHERE public.delivery_slots.status = 'open';

  -- 2. Nettoyage des occurrences futures ouvertes hors planning, sans commande.
  DELETE FROM public.delivery_slots ds
  WHERE ds.merchant_id = p_merchant_id
    AND ds.status = 'open'
    AND ds.slot_date >= v_today
    AND NOT EXISTS (
      SELECT 1 FROM public.merchant_tour_schedule s
      WHERE s.merchant_id = p_merchant_id
        AND s.weekday = EXTRACT(DOW FROM ds.slot_date)::int
        AND s.start_time = ds.start_time
        AND s.end_time   = ds.end_time
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.orders o WHERE o.delivery_slot_id = ds.id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_tour_slots(UUID) TO authenticated, anon;
