-- =============================================================================
-- 0440 — Réglages du PARTAGE STORY post-commande (mégaphone viral, mig 0421).
--
-- Demande produit (06/08/2026) : le super-admin pilote cette fonction depuis
-- Marketing — activer/désactiver, et CHOISIR LE DESIGN de la story générée
-- (canvas 1080×1920). Les CONDITIONS (cadeau parrain / cadeau filleul /
-- commande minimum) restent celles du parrainage (referral_settings,
-- mig 0403) — une seule source de vérité, réglée dans Marketing > Parrainage.
--
-- Ligne unique (id=true), lecture SERVEUR uniquement (la page commande est
-- rendue serveur) : RLS activée sans policy = service_role seul.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.share_story_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT true,
  design text NOT NULL DEFAULT 'violet'
    CHECK (design IN ('violet', 'rose', 'nuit', 'ambre')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.share_story_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO public.share_story_settings (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;
