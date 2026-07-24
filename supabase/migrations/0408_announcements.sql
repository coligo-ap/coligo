-- =============================================================================
-- 0408 — ANNONCES & COMMUNICATIONS ADMIN (pop-up in-app + push ciblées)
-- =============================================================================
-- Le super-admin publie des annonces bilingues FR/AR ciblées par RÔLE
-- (client / commerçant / livreur / chauffeur), diffusées en push FCM et/ou
-- pop-up in-app (à l'ouverture, instantanée via broadcast, ou sur une page
-- précise), normales ou BLOQUANTES, avec 0-2 boutons d'action typés.
--
-- SÉCURITÉ : AUCUNE policy de lecture pour les rôles applicatifs — toute
-- lecture passe par `my_announcements()` qui résout le rôle CÔTÉ SERVEUR :
-- un client ne peut JAMAIS lire une annonce destinée aux commerçants.
-- Reçus : upserts FORWARD-ONLY (idempotents → file offline rejouable).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. TABLE announcements
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.announcements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  title_fr        TEXT NOT NULL,
  title_ar        TEXT NOT NULL,
  body_fr         TEXT NOT NULL,
  body_ar         TEXT NOT NULL,
  image_url       TEXT,
  audiences       TEXT[] NOT NULL
    CHECK (audiences <@ ARRAY['customer','merchant','driver','chauffeur']::text[]
           AND array_length(audiences, 1) >= 1),
  channel         TEXT NOT NULL DEFAULT 'both' CHECK (channel IN ('push', 'popup', 'both')),
  popup_mode      TEXT NOT NULL DEFAULT 'next_open'
    CHECK (popup_mode IN ('next_open', 'instant', 'route')),
  route_prefix    TEXT,
  blocking        BOOLEAN NOT NULL DEFAULT FALSE,
  -- [{label_fr, label_ar, action: acknowledge|redirect_internal|redirect_external|dismiss, target}]
  buttons         JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(buttons) = 'array' AND jsonb_array_length(buttons) <= 2),
  starts_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at         TIMESTAMPTZ,
  push_sent_at    TIMESTAMPTZ,
  push_sent_count INTEGER NOT NULL DEFAULT 0,
  -- Extensibilité (wilaya, merchant précis, segment) — inutilisé v1.
  audience_filter JSONB,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at     TIMESTAMPTZ,
  -- Une annonce BLOQUANTE doit offrir au moins une action pour continuer.
  CHECK ((NOT blocking) OR jsonb_array_length(buttons) >= 1),
  -- Le mode « page précise » exige son préfixe de route.
  CHECK (popup_mode <> 'route' OR route_prefix IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_announcements_active
  ON public.announcements (status, starts_at, ends_at)
  WHERE disabled_at IS NULL;

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- Admin seulement (console) — les rôles applicatifs passent par la RPC.
DROP POLICY IF EXISTS announcements_admin_all ON public.announcements;
CREATE POLICY announcements_admin_all ON public.announcements
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 2. TABLE announcement_receipts — impressions / accusés / clics (append-forward)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.announcement_receipts (
  announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  seen_at         TIMESTAMPTZ,
  acked_at        TIMESTAMPTZ,
  dismissed_at    TIMESTAMPTZ,
  clicked_button  SMALLINT,
  clicked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_announcement_receipts_ann
  ON public.announcement_receipts (announcement_id);

ALTER TABLE public.announcement_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS announcement_receipts_admin_select ON public.announcement_receipts;
CREATE POLICY announcement_receipts_admin_select ON public.announcement_receipts
  FOR SELECT USING (public.is_super_admin());
-- Écritures : RPC SECURITY DEFINER uniquement.

-- ---------------------------------------------------------------------------
-- 3. Helper interne — rôle applicatif d'un user (populations disjointes).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._announcement_role(p_uid uuid)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.customers  WHERE user_id = p_uid) THEN 'customer'
    WHEN EXISTS (SELECT 1 FROM public.merchants  WHERE user_id = p_uid) THEN 'merchant'
    WHEN EXISTS (SELECT 1 FROM public.drivers    WHERE user_id = p_uid) THEN 'driver'
    WHEN EXISTS (SELECT 1 FROM public.chauffeurs WHERE user_id = p_uid) THEN 'chauffeur'
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public._announcement_role(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. RPC my_announcements() — LES annonces à afficher pour MOI, rien d'autre.
--    Non-bloquante : cachée dès qu'elle a été VUE (ou fermée/acquittée).
--    Bloquante : revient tant qu'aucune ACTION (ack / clic / dismiss bouton).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_announcements()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_role := public._announcement_role(v_uid);
  IF v_role IS NULL THEN RETURN '[]'::jsonb; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', a.id,
             'title_fr', a.title_fr, 'title_ar', a.title_ar,
             'body_fr', a.body_fr, 'body_ar', a.body_ar,
             'image_url', a.image_url,
             'popup_mode', a.popup_mode,
             'route_prefix', a.route_prefix,
             'blocking', a.blocking,
             'buttons', a.buttons
           ) ORDER BY a.blocking DESC, a.created_at DESC)
    FROM (
      SELECT a.*
        FROM public.announcements a
        LEFT JOIN public.announcement_receipts r
          ON r.announcement_id = a.id AND r.user_id = v_uid
       WHERE a.status = 'published'
         AND a.disabled_at IS NULL
         AND a.starts_at <= now()
         AND (a.ends_at IS NULL OR a.ends_at > now())
         AND v_role = ANY (a.audiences)
         AND a.channel IN ('popup', 'both')
         AND NOT (
           CASE WHEN a.blocking
                THEN (r.acked_at IS NOT NULL OR r.clicked_at IS NOT NULL
                      OR r.dismissed_at IS NOT NULL)
                ELSE (r.seen_at IS NOT NULL OR r.acked_at IS NOT NULL
                      OR r.dismissed_at IS NOT NULL)
           END
         )
       LIMIT 10
    ) a
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.my_announcements() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_announcements() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. RPC announcement_receipt() — impressions/accusés/clics, IDEMPOTENTE
--    (forward-only : rien ne recule jamais — la file offline peut rejouer).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.announcement_receipt(
  p_id     uuid,
  p_event  text,              -- 'seen' | 'ack' | 'dismiss' | 'click'
  p_button integer DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
  v_ok   boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_event NOT IN ('seen', 'ack', 'dismiss', 'click') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_event');
  END IF;
  v_role := public._announcement_role(v_uid);
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_role');
  END IF;

  -- L'annonce doit exister ET viser MON rôle (défense en profondeur). On
  -- accepte les accusés tardifs (annonce expirée entre-temps : sync offline).
  SELECT EXISTS (
    SELECT 1 FROM public.announcements a
     WHERE a.id = p_id AND v_role = ANY (a.audiences)
  ) INTO v_ok;
  IF NOT v_ok THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_targeted');
  END IF;

  INSERT INTO public.announcement_receipts
    (announcement_id, user_id, role, seen_at, acked_at, dismissed_at,
     clicked_button, clicked_at)
  VALUES
    (p_id, v_uid, v_role,
     now(),
     CASE WHEN p_event = 'ack' THEN now() END,
     CASE WHEN p_event = 'dismiss' THEN now() END,
     CASE WHEN p_event = 'click' THEN p_button END,
     CASE WHEN p_event = 'click' THEN now() END)
  ON CONFLICT (announcement_id, user_id) DO UPDATE SET
    seen_at        = COALESCE(announcement_receipts.seen_at, EXCLUDED.seen_at),
    acked_at       = COALESCE(announcement_receipts.acked_at, EXCLUDED.acked_at),
    dismissed_at   = COALESCE(announcement_receipts.dismissed_at, EXCLUDED.dismissed_at),
    clicked_button = COALESCE(announcement_receipts.clicked_button, EXCLUDED.clicked_button),
    clicked_at     = COALESCE(announcement_receipts.clicked_at, EXCLUDED.clicked_at);

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.announcement_receipt(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.announcement_receipt(uuid, text, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. RPC admin_announcement_stats() — le petit tableau de bord par annonce.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_announcement_stats(p_id uuid)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.admin_can('marketing') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'push_sent', (SELECT push_sent_count FROM public.announcements WHERE id = p_id),
      'impressions', count(*) FILTER (WHERE seen_at IS NOT NULL),
      'acked',       count(*) FILTER (WHERE acked_at IS NOT NULL),
      'dismissed',   count(*) FILTER (WHERE dismissed_at IS NOT NULL),
      'clicks_0',    count(*) FILTER (WHERE clicked_button = 0),
      'clicks_1',    count(*) FILTER (WHERE clicked_button = 1)
    )
    FROM public.announcement_receipts
    WHERE announcement_id = p_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_announcement_stats(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_announcement_stats(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. RPC announcements_due_push() — pushes PROGRAMMÉES dues (cron, service).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.announcements_due_push()
RETURNS SETOF public.announcements
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.announcements
   WHERE status = 'published'
     AND disabled_at IS NULL
     AND channel IN ('push', 'both')
     AND push_sent_at IS NULL
     AND starts_at <= now()
     AND (ends_at IS NULL OR ends_at > now());
$$;

REVOKE ALL ON FUNCTION public.announcements_due_push() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.announcements_due_push() TO service_role;

-- =============================================================================
-- VÉRIFICATION :
--   SELECT public.my_announcements();          -- (authenticated) '[]'
--   INSERT bloquante sans bouton → échec CHECK
-- =============================================================================
