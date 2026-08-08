-- =============================================================================
-- 0450 — CONTENU ÉDITABLE DE LA PAGE PUBLIQUE /recrute
--
-- Les 4 cartes métier et l'habillage du héros étaient écrits en dur dans
-- app/recrute/page.tsx : changer une photo ou une accroche demandait un
-- déploiement. L'équipe Coligo peut désormais les modifier depuis
-- /admin/marketing/recrutement.
--
-- Sécurité, même patron que app_theme (0415) et category_filter_images (0310) :
--   - LECTURE publique (la page /recrute est publique) → policy SELECT pour
--     anon + authenticated, ET `GRANT SELECT` explicite (sans le GRANT, la
--     table reste invisible en anon malgré la policy) ;
--   - ÉCRITURE réservée au service_role : aucune policy d'écriture + REVOKE.
--     Les server actions d'administration sont gardées par adminCan('marketing').
--
-- Les images sont déposées dans le bucket public `promo-banners` (0248), déjà
-- utilisé par les bannières et la story de partage — pas de nouveau bucket.
-- =============================================================================

-- ─────────────────────── Réglages de page (ligne unique) ────────────────────
CREATE TABLE IF NOT EXISTS public.recrute_page (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  -- Habillage du héros. Allowlist DOUBLÉE côté serveur (lib/config/recrute-content.ts).
  design TEXT NOT NULL DEFAULT 'coligo'
    CHECK (design IN ('coligo', 'nuit', 'aurore', 'emeraude', 'ambre')),
  -- NULL = on garde le texte livré avec le code (le défaut reste la référence).
  hero_title TEXT,
  hero_subtitle TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

INSERT INTO public.recrute_page (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.recrute_page ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recrute_page_read ON public.recrute_page;
CREATE POLICY recrute_page_read ON public.recrute_page
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.recrute_page TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.recrute_page FROM anon, authenticated;

-- ──────────────────────────── Cartes métier ─────────────────────────────────
-- `key` reprend EXACTEMENT le drapeau de fonctionnalité du métier (mig 0448) :
-- une carte reste pilotée par son kill-switch, ce contenu ne fait que l'habiller.
CREATE TABLE IF NOT EXISTS public.recrute_roles (
  key TEXT PRIMARY KEY CHECK (
    key IN (
      'recruit_chauffeur',
      'recruit_merchant',
      'recruit_driver',
      'recruit_agent'
    )
  ),
  img_url TEXT,
  img_alt TEXT,
  title TEXT,
  tagline TEXT,
  highlight TEXT,
  -- 3 avantages affichés en liste. NULL = liste par défaut du code.
  perks TEXT[],
  cta TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

-- Les 4 lignes existent toujours : l'écran d'administration édite, il ne crée
-- pas. Colonnes laissées à NULL = valeur par défaut du code (aucune duplication
-- de contenu entre la base et le dépôt, une seule référence : le code).
INSERT INTO public.recrute_roles (key, position) VALUES
  ('recruit_chauffeur', 0),
  ('recruit_merchant',  1),
  ('recruit_driver',    2),
  ('recruit_agent',     3)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.recrute_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recrute_roles_read ON public.recrute_roles;
CREATE POLICY recrute_roles_read ON public.recrute_roles
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.recrute_roles TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.recrute_roles FROM anon, authenticated;
