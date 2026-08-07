-- =============================================================================
-- 0441 — Partage story : PLUS de designs + PHOTO optionnelle (mig 0440).
--
-- Demande produit (07/08/2026) : de meilleurs designs pour la story générée
-- (4 nouveaux : émeraude, océan, corail, or — 8 au total), et la possibilité
-- pour le super-admin d'ajouter une PHOTO qui accompagne le texte (dessinée en
-- fond de la story, sous le voile dégradé du design ; les textes restent
-- lisibles). La photo est uploadée dans le bucket public `promo-banners`
-- (mig 0248, même pipeline sécurisé que les bannières : signature binaire) —
-- seule son URL publique est stockée ici.
-- =============================================================================

ALTER TABLE public.share_story_settings
  DROP CONSTRAINT IF EXISTS share_story_settings_design_check;

ALTER TABLE public.share_story_settings
  ADD CONSTRAINT share_story_settings_design_check
  CHECK (design IN (
    'violet', 'rose', 'nuit', 'ambre',
    'emeraude', 'ocean', 'corail', 'or'
  ));

ALTER TABLE public.share_story_settings
  ADD COLUMN IF NOT EXISTS image_url text;
