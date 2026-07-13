-- ============================================================================
-- 0370 — IDV : UN SEUL niveau de vérification + méthode KYC du chauffeur.
--
-- 1) UN SEUL MODE.
--    Le socle 0367 livrait deux niveaux ('express' = « rapide » et 'standard').
--    Deux niveaux, c'est deux postures de sécurité : le niveau « rapide »
--    n'exécutait NI l'authenticité du document NI les défis de présence
--    (liveness actif), et se contentait de « mettre en revue » un échec de
--    présence au lieu de le refuser. Autrement dit : une porte plus basse, sur
--    le même mur. Elle finit toujours par être celle qu'on emprunte.
--    On ne garde donc qu'un seul mode, le COMPLET (tous les contrôles), pour
--    que la promesse « identité vérifiée » veuille dire la même chose partout.
--    La table reste multi-modes (extensibilité : un futur mode « renforcé »
--    reste possible) — c'est la CONFIGURATION qui n'en propose plus qu'un.
--
-- 2) MÉTHODE KYC DU CHAUFFEUR (miroir de drivers.kyc_method, mig 0369) :
--    'instant' (scan + selfie, résultat immédiat) ou 'manual' (pièces
--    examinées par l'équipe Coligo). NULL = pas encore choisi.
-- ============================================================================

-- ── 1) Un seul mode ─────────────────────────────────────────────────────────

-- Les dossiers déjà passés en mode « rapide » sont rattachés au mode complet :
-- la colonne `mode` référence idv_modes(key), on ne peut pas laisser d'orphelin.
UPDATE public.idv_verifications SET mode = 'standard' WHERE mode = 'express';

UPDATE public.idv_profile_rules
   SET allowed_modes        = ARRAY['standard'],
       default_mode         = 'standard',
       user_can_choose_mode = false;

DELETE FROM public.idv_modes WHERE key = 'express';

-- Le mode restant devient « la » vérification : nom neutre, description qui dit
-- ce qui est réellement exécuté.
UPDATE public.idv_modes
   SET label_fr       = 'Vérification complète',
       label_ar       = 'تحقق كامل',
       description_fr = 'Document lisible, authentique et valide, présence réelle (défis), comparaison du visage avec la photo du document.',
       description_ar = 'وثيقة مقروءة وأصلية وسارية، حضور فعلي (تحديات)، مطابقة الوجه مع صورة الوثيقة.',
       enabled        = true,
       position       = 0
 WHERE key = 'standard';

COMMENT ON COLUMN public.idv_profile_rules.allowed_modes IS
  'Modes proposés au profil. Un seul mode existe aujourd''hui (standard) : la colonne reste pour une extension future (mode renforcé), pas pour offrir un niveau plus faible.';

-- ── 2) Méthode de vérification du chauffeur ─────────────────────────────────

ALTER TABLE public.chauffeurs
  ADD COLUMN IF NOT EXISTS kyc_method text
    CHECK (kyc_method IS NULL OR kyc_method IN ('manual', 'instant'));

COMMENT ON COLUMN public.chauffeurs.kyc_method IS
  'Méthode de vérification d''identité choisie : instant (IDV automatique) ou manual (pièces examinées par l''équipe).';
