-- 0335 — Version minimale imposée de l'app Android CLIENT (Google Play).
--
-- Google Play In-App Updates : l'app client (app.coligo.client) vérifie au
-- démarrage si une mise à jour est disponible. Par défaut elle propose une
-- mise à jour FLEXIBLE (téléchargement en arrière-plan, redémarrage au choix).
-- Quand le versionCode installé est STRICTEMENT INFÉRIEUR à cette valeur,
-- l'app force une mise à jour IMMEDIATE (plein écran Play, bloquante) — à
-- utiliser pour les versions cassées ou les changements incompatibles.
--
-- 0 = jamais de mise à jour forcée (défaut). La valeur est publique par
-- conception (servie par /api/app/min-version au WebView, avant login).

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS client_app_min_version_code INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.platform_settings.client_app_min_version_code IS
  'versionCode Android minimal de l''app client Google Play (app.coligo.client). En dessous → In-App Update IMMEDIATE forcée. 0 = désactivé.';
