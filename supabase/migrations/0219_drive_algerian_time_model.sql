-- ============================================================================
-- 0219 — Garde-fou commission ≤10% + modèle horaire ALGÉRIEN (jour×heure)
-- ----------------------------------------------------------------------------
-- (A) Plafond de commission bypass-proof : driver_fee_rate ne peut pas dépasser
--     drive_commission_ceiling (défaut 0.10, sous les 12% d'inDrive → l'avantage
--     chauffeur est protégé). Pour monter au-delà (ex. phase mature à 20%), il
--     faut RELEVER le plafond consciemment d'abord — pas d'erreur accidentelle.
--
-- (B) drive_time_coef(dow, hour) : demande calibrée sur la société algérienne
--     ACTUELLE (pas les rythmes occidentaux) :
--       • Week-end = VENDREDI + SAMEDI ; jours ouvrés = DIMANCHE→JEUDI.
--       • JEUDI SOIR (18-23h) = veille de week-end = la plus grosse sortie.
--       • VENDREDI : matin calme, prière 12-14h creux, après-midi/soir familial.
--       • SAMEDI : courses en journée, sorties le soir.
--       • Ouvrés (dim-jeu) : pointe matin 7-9h, déjeuner-maison 12-14h, soir 16-19h.
--       • NUIT profonde 0-4h : chauffeurs rares → léger premium pour en trouver.
--     Soft & plafonné à 12% (anti-surge facon inDrive — la pointe est surtout
--     absorbée par la négociation, pas par une majoration punitive).
-- ============================================================================

-- (A) Plafond de commission --------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS drive_commission_ceiling NUMERIC NOT NULL DEFAULT 0.10;

CREATE OR REPLACE FUNCTION public.enforce_drive_commission_ceiling()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.driver_fee_rate > NEW.drive_commission_ceiling + 1e-9 THEN
    RAISE EXCEPTION 'Commission chauffeur (%) > plafond (%). Relevez d''abord drive_commission_ceiling.',
      NEW.driver_fee_rate, NEW.drive_commission_ceiling USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_drive_commission_ceiling ON public.platform_settings;
CREATE TRIGGER trg_drive_commission_ceiling
  BEFORE INSERT OR UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_drive_commission_ceiling();

-- (B) Modèle horaire algérien ------------------------------------------------
-- p_dow = ISODOW (lun=1 … ven=5, sam=6, dim=7).
CREATE OR REPLACE FUNCTION public.drive_time_coef(p_dow INTEGER, p_hour INTEGER)
RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE v NUMERIC := 0;
BEGIN
  IF p_dow = 4 AND p_hour BETWEEN 18 AND 23 THEN
    v := 0.12;                                   -- jeudi soir = veille de week-end (sortie max)
  ELSIF p_dow = 5 THEN                            -- vendredi
    v := CASE WHEN p_hour BETWEEN 12 AND 14 THEN 0.02   -- prière, creux
              WHEN p_hour BETWEEN 15 AND 23 THEN 0.08   -- après-midi/soir familial
              ELSE 0.00 END;                            -- matin calme
  ELSIF p_dow = 6 THEN                            -- samedi
    v := CASE WHEN p_hour BETWEEN 10 AND 13 THEN 0.05   -- courses
              WHEN p_hour BETWEEN 18 AND 23 THEN 0.08   -- sorties
              ELSE 0.02 END;
  ELSE                                            -- jours ouvrés DZ (dim, lun, mar, mer, jeu-jour)
    v := CASE WHEN p_hour BETWEEN 7  AND 9  THEN 0.10   -- pointe matin
              WHEN p_hour BETWEEN 12 AND 14 THEN 0.05   -- déjeuner (retour maison)
              WHEN p_hour BETWEEN 16 AND 19 THEN 0.10   -- pointe soir
              ELSE 0.00 END;
  END IF;
  IF p_hour BETWEEN 0 AND 4 THEN v := GREATEST(v, 0.07); END IF;  -- rareté nuit profonde
  RETURN LEAST(0.12, v);
END; $$;
GRANT EXECUTE ON FUNCTION public.drive_time_coef(INTEGER, INTEGER) TO authenticated, anon;

-- drive_smart_quote v7 : remplace rush+week-end par le coef horaire algérien.
CREATE OR REPLACE FUNCTION public.drive_smart_quote(
  p_distance_km NUMERIC,
  p_gamme       TEXT DEFAULT 'classic',
  p_pickup_lat  DOUBLE PRECISION DEFAULT NULL,
  p_pickup_lng  DOUBLE PRECISION DEFAULT NULL,
  p_at          TIMESTAMPTZ DEFAULT now()
) RETURNS TABLE(
  floor_da INTEGER, mini_da INTEGER, reco_da INTEGER, fast_da INTEGER,
  demand_n INTEGER, supply_n INTEGER, surge NUMERIC, learn NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.platform_settings%ROWTYPE;
  g JSONB; v_base INTEGER; v_floor INTEGER;
  v_per_min NUMERIC; v_minutes NUMERIC; v_time_cost NUMERIC;
  v_h INTEGER; v_dow INTEGER; v_tcoef NUMERIC := 0;
  v_demand INTEGER := 0; v_supply INTEGER := 0; v_surge NUMERIC := 0;
  v_learn NUMERIC; v_discount NUMERIC; v_market NUMERIC; v_raw NUMERIC;
  v_cap INTEGER; v_reco INTEGER;
BEGIN
  SELECT * INTO s FROM public.platform_settings WHERE id = true;
  g := s.drive_pricing -> COALESCE(NULLIF(p_gamme, ''), 'classic');
  IF g IS NULL THEN g := s.drive_pricing -> 'classic'; END IF;

  v_base  := COALESCE(
               public.drive_zone_recommended(p_distance_km, p_gamme, p_pickup_lat, p_pickup_lng, p_at),
               public.drive_recommended_price(p_distance_km, p_gamme, p_at));
  v_floor := GREATEST(
               public.drive_price_floor(p_distance_km, p_gamme),
               (round(v_base * s.drive_floor_rate / 5) * 5)::INTEGER);

  v_per_min := COALESCE((g->>'per_min')::NUMERIC, 0);
  v_minutes := GREATEST(0, COALESCE(p_distance_km, 0)) / GREATEST(10, s.drive_avg_speed_kmh) * 60;
  v_time_cost := v_per_min * v_minutes;

  v_h   := EXTRACT(HOUR   FROM (p_at AT TIME ZONE 'Africa/Algiers'))::INTEGER;
  v_dow := EXTRACT(ISODOW FROM (p_at AT TIME ZONE 'Africa/Algiers'))::INTEGER;
  v_tcoef := public.drive_time_coef(v_dow, v_h);   -- demande jour×heure (Algérie)

  IF p_pickup_lat IS NOT NULL AND p_pickup_lng IS NOT NULL THEN
    SELECT count(*)::INTEGER INTO v_demand
    FROM public.rides r
    WHERE r.status = 'searching'
      AND r.created_at > now() - INTERVAL '15 minutes'
      AND r.pickup_lat IS NOT NULL
      AND (6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(p_pickup_lat)) * cos(radians(r.pickup_lat)) * cos(radians(r.pickup_lng) - radians(p_pickup_lng))
            + sin(radians(p_pickup_lat)) * sin(radians(r.pickup_lat)))))) <= 4;
    SELECT count(*)::INTEGER INTO v_supply
    FROM public.chauffeur_presence p
    JOIN public.chauffeurs c ON c.id = p.chauffeur_id
    WHERE p.is_online AND p.updated_at > now() - INTERVAL '3 minutes'
      AND c.is_verified AND NOT c.is_frozen AND NOT c.is_blocked
      AND (CASE c.gamme
            WHEN 'confort' THEN COALESCE(NULLIF(p_gamme,''),'classic') IN ('classic','confort')
            WHEN 'classic' THEN COALESCE(NULLIF(p_gamme,''),'classic') = 'classic'
            ELSE COALESCE(NULLIF(p_gamme,''),'classic') = 'moto' END)
      AND (6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(p_pickup_lat)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(p_pickup_lng))
            + sin(radians(p_pickup_lat)) * sin(radians(p.lat)))))) <= 4;
    v_surge := LEAST(s.drive_surge_max, GREATEST(-0.05,
      (v_demand - v_supply)::NUMERIC / GREATEST(1, v_supply) * 0.10));
  END IF;

  v_learn := public.drive_learning_coef(p_gamme, p_at);
  v_discount := public.drive_competitive_discount();

  v_market := (v_base + v_time_cost)
              * (1 + v_tcoef) * (1 + v_surge)
              * (1 + LEAST(0.20, GREATEST(0, s.drive_weather_coef) + GREATEST(0, s.drive_event_coef)));
  v_raw := v_market * v_learn * (1 - v_discount);
  v_reco := (round(v_raw / 5) * 5)::INTEGER;
  v_cap := (round(v_market * (1 - s.drive_undercut_min) / 5) * 5)::INTEGER;
  v_reco := LEAST(v_reco, v_cap);
  v_reco := GREATEST(v_floor, v_reco);

  floor_da := v_floor;
  reco_da  := v_reco;
  mini_da  := GREATEST(v_floor, (round(v_reco * (1 - s.drive_mini_rate) / 5) * 5))::INTEGER;
  fast_da  := LEAST(v_cap, (round(v_reco * (1 + s.drive_fast_rate) / 5) * 5))::INTEGER;
  demand_n := v_demand; supply_n := v_supply; surge := v_surge; learn := v_learn;
  RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.drive_smart_quote(NUMERIC, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ) TO authenticated, anon;
