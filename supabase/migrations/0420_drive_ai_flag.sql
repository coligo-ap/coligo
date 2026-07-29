-- 0420 : interrupteur super-admin de la RECHERCHE INTELLIGENTE Drive
-- (barre « Dis où tu veux aller » + dictée vocale). Demande produit :
-- désactivée POUR L'INSTANT (default false), réactivable depuis la
-- Config Drive admin sans déploiement. Même pattern que
-- drive_scheduled_enabled (0224) : colonne du singleton platform_settings,
-- lue par getDriveContext (client) et gardée SERVEUR dans parseDriveIntent
-- + transcribeDriveAudio (le front seul est contournable).

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS drive_ai_enabled BOOLEAN NOT NULL DEFAULT false;
