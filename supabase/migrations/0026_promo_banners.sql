-- =============================================================================
-- Coligo v3 - Migration 0026 : promo_banners éditoriales (redesign prompt 20)
-- =============================================================================
-- Bannières purement VISUELLES pour la home — pas de mécanique de code promo
-- plateforme (ce serait un autre chantier financier). Gérées plus tard via
-- l'espace admin.
--
-- Champs :
--   - title / subtitle / cta_label : texte
--   - image_url        : optionnel (gradient si null)
--   - link             : optionnel (URL interne ou externe)
--   - accent           : enum visuel ('violet'|'coral'|'mint'|'amber'|'dark')
--   - position         : tri d'affichage (asc)
--   - active           : visible si true
--   - starts_at / ends_at : programmation
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.promo_banners (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  subtitle    TEXT,
  cta_label   TEXT,
  image_url   TEXT,
  link        TEXT,
  accent      TEXT NOT NULL DEFAULT 'violet'
              CHECK (accent IN ('violet','coral','mint','amber','dark')),
  position    INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promo_banners_active_position
  ON public.promo_banners(position ASC) WHERE active = true;

-- RLS : lecture publique (utilisé sur la home client) ; écriture super-admin.
ALTER TABLE public.promo_banners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promo_banners_select_all" ON public.promo_banners;
CREATE POLICY "promo_banners_select_all" ON public.promo_banners
  FOR SELECT TO anon, authenticated
  USING (
    active = true
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at IS NULL OR ends_at > now())
  );

DROP POLICY IF EXISTS "promo_banners_admin_all" ON public.promo_banners;
CREATE POLICY "promo_banners_admin_all" ON public.promo_banners
  FOR ALL USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Seed : 2 bannières de démo (sans image — gradient + texte uniquement).
INSERT INTO public.promo_banners (title, subtitle, cta_label, link, accent, position)
VALUES
  (
    'Bienvenue sur Coligo',
    'Commande dans tes commerces de quartier, retire sans faire la queue.',
    'Voir les commerces',
    '/',
    'violet',
    1
  ),
  (
    'Click & Collect partout en Algérie',
    'Plus de 50 commerces déjà présents — paye en espèces ou en ligne.',
    'Découvrir',
    '/',
    'coral',
    2
  )
ON CONFLICT DO NOTHING;
