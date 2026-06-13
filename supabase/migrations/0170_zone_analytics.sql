-- =============================================================================
-- 0170 — Observabilité du moteur de zones : refus réels + statistiques ops
-- =============================================================================
-- Le moteur 0169 bloque les commandes/courses hors zone. Pour piloter (« où la
-- demande est-elle refusée ? », « quelles zones ouvrir en priorité ? »), on
-- journalise UNIQUEMENT les SOUMISSIONS RÉELLEMENT BLOQUÉES (pas les prechecks
-- temps réel, trop bruyants), depuis la couche ACTION (un RAISE dans une RPC
-- annulerait la transaction → le log serait perdu).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.zone_block_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service      TEXT NOT NULL CHECK (service IN ('express', 'tour', 'drive')),
  -- 'order' (livraison) | 'drive'
  source       TEXT NOT NULL CHECK (source IN ('order', 'drive')),
  role         TEXT,           -- origin | destination | any
  reason       TEXT,           -- blocked | no_coverage | service_inactive | maxdist
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  wilaya_code  TEXT,
  commune      TEXT,
  user_id      UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_zone_block_events_service
  ON public.zone_block_events (service, created_at DESC);

ALTER TABLE public.zone_block_events ENABLE ROW LEVEL SECURITY;
-- Aucune policy : écriture via RPC SECURITY DEFINER, lecture via service_role (admin).

-- ----------------------------------------------------------------------------
-- Journalisation (best-effort) — appelée par les actions à un refus réel.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_zone_block(
  p_service TEXT,
  p_source  TEXT,
  p_role    TEXT DEFAULT NULL,
  p_reason  TEXT DEFAULT NULL,
  p_lat     DOUBLE PRECISION DEFAULT NULL,
  p_lng     DOUBLE PRECISION DEFAULT NULL,
  p_wilaya_code TEXT DEFAULT NULL,
  p_commune TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_service NOT IN ('express', 'tour', 'drive') THEN RETURN; END IF;
  IF p_source NOT IN ('order', 'drive') THEN RETURN; END IF;
  INSERT INTO public.zone_block_events
    (service, source, role, reason, lat, lng, wilaya_code, commune, user_id)
  VALUES (p_service, p_source, p_role, p_reason, p_lat, p_lng,
          p_wilaya_code, p_commune, auth.uid());
END;
$$;
GRANT EXECUTE ON FUNCTION public.log_zone_block(TEXT, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Stats admin : refus agrégés par service + zone (N derniers jours).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.zone_block_stats(p_days INTEGER DEFAULT 30)
RETURNS TABLE(
  service TEXT, wilaya_code TEXT, commune TEXT, cnt BIGINT, last_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT service, wilaya_code, commune, count(*) AS cnt, max(created_at) AS last_at
  FROM public.zone_block_events
  WHERE created_at > now() - make_interval(days => GREATEST(1, p_days))
  GROUP BY service, wilaya_code, commune
  ORDER BY cnt DESC
  LIMIT 100;
$$;
GRANT EXECUTE ON FUNCTION public.zone_block_stats(INTEGER) TO service_role;

-- Résumé liste d'attente (« Prévenez-moi ») par service + zone.
CREATE OR REPLACE FUNCTION public.zone_waitlist_stats(p_days INTEGER DEFAULT 90)
RETURNS TABLE(
  service TEXT, wilaya_code TEXT, commune TEXT, cnt BIGINT, last_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT service, wilaya_code, commune, count(*) AS cnt, max(created_at) AS last_at
  FROM public.zone_waitlist
  WHERE created_at > now() - make_interval(days => GREATEST(1, p_days))
  GROUP BY service, wilaya_code, commune
  ORDER BY cnt DESC
  LIMIT 100;
$$;
GRANT EXECUTE ON FUNCTION public.zone_waitlist_stats(INTEGER) TO service_role;

-- =============================================================================
-- VÉRIF : SELECT * FROM public.zone_block_stats(30);
-- =============================================================================
