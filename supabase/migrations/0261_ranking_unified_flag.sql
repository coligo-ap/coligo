-- =============================================================================
-- 0261 — Drapeau « ranking unifié » de la marketplace (rollout contrôlé).
-- =============================================================================
-- Aujourd'hui le classement de l'accueil client a DEUX chemins :
--   • client avec GPS  → tri distance pure (splitOpenFirst) : la note, la
--     popularité, les promos et les favoris sont IGNORÉS ;
--   • client sans GPS  → score composite rankMerchants (qualité/popularité/…).
--
-- Ce drapeau active le « ranking unifié » façon Uber : le score composite
-- devient la source de vérité UNIQUE sur les deux chemins, avec la distance en
-- signal pondéré FORT (le rayon reste filtré par merchants_nearby). On préserve
-- 100 % du comportement actuel tant qu'il est à FALSE → activation/rollback
-- triviaux, sans redéploiement.
-- =============================================================================

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS ranking_unified boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.platform_settings.ranking_unified IS
  'Si true, l''accueil client classe par score composite (rankMerchants) sur TOUS les chemins, distance incluse comme signal pondéré. Si false (défaut), comportement legacy : distance pure quand GPS connu.';

-- Expose le drapeau dans /admin/config (toggle bilingue + historique). Le super-
-- admin peut l'activer/désactiver sans redéploiement → rollout/rollback triviaux.
INSERT INTO public.platform_config_registry
  (key, value_type, group_key, label_fr, label_ar, help_fr, help_ar, sort_order, min_num, max_num, step_num, json_shape)
VALUES
  ('ranking_unified', 'bool', 'ranking',
   'Classement unifié de l''accueil', 'الترتيب الموحّد للصفحة الرئيسية',
   'Si activé, les commerces sont classés par score composite (proximité FORTE + note + popularité + promos + favoris) sur TOUS les cas, même avec GPS. Si désactivé : tri par distance pure quand la position est connue (comportement historique).',
   'عند التفعيل، تُرتَّب المتاجر بدرجة مركّبة (القرب القوي + التقييم + الشعبية + العروض + المفضّلة) في كل الحالات حتى مع GPS. عند الإيقاف: ترتيب بالمسافة فقط عند معرفة الموقع.',
   10, NULL, NULL, NULL, NULL)
ON CONFLICT (key) DO NOTHING;
