-- =============================================================================
-- 0372 — IDV : recalibrage du refus automatique + nouveaux contrôles du selfie.
--
-- CE QUE MESURE CE CHANGEMENT (scripts/test-idv-calibration.mjs, 13 identités
-- réelles, photos DIFFÉRENTES, imposteurs de même cohorte) :
--
--   pire cas LÉGITIME (même personne) ... cosinus 0.365
--   pire IMPOSTEUR (même sexe/âge) ...... cosinus 0.370
--
-- Le seuil de refus valait 0.35 en score normalisé, soit un cosinus de 0.33 :
-- il passait DANS la zone où vivent encore des gens honnêtes. Le banc a d'ailleurs
-- attrapé un cas réel — une personne légitime refusée AUTOMATIQUEMENT (cos 0.322)
-- sur deux vraies photos d'elle-même.
--
-- Un refus automatique, c'est une porte fermée à quelqu'un qui n'a rien fait.
-- Le doute doit aller à la revue humaine, jamais au refus. On abaisse donc le
-- refus à 0.25 (cosinus 0.25) : SOUS tout ce qu'une personne légitime a produit
-- dans les mesures, avec 0.115 de marge.
--
-- L'approbation automatique, elle, NE BOUGE PAS (0.60 = cosinus 0.53) : elle
-- reste 0.16 au-dessus du pire imposteur mesuré. On n'achète pas de confort en
-- vendant de la sécurité.
--
-- Effet net : les imposteurs de la zone grise (0.25-0.33) partent en revue
-- humaine au lieu d'être refusés seuls — ils ne sont JAMAIS approuvés pour
-- autant. On échange un peu de travail humain contre l'assurance de ne pas
-- refuser un innocent.
-- =============================================================================

-- Nouveau défaut pour tout mode créé ensuite.
ALTER TABLE public.idv_modes
  ALTER COLUMN face_match_reject SET DEFAULT 0.25;

-- Modes existants : on ne touche QUE ceux restés sur l'ancien réglage (0.35).
-- Un seuil déjà ajusté à la main par l'équipe est un choix — on ne l'écrase pas.
UPDATE public.idv_modes
   SET face_match_reject = 0.25
 WHERE face_match_reject = 0.35;

-- ── Nouveaux contrôles du pipeline (idv_modes.checks) ───────────────────────
--   selfie_quality  : la capture est-elle exploitable ? (sinon on REDEMANDE
--                     une photo — on ne juge pas une identité sur du flou) ;
--   face_ambiguity  : un seul visage dans le cadre ? (deux visages ⇒ « le plus
--                     grand » n'est plus une réponse, c'est un pari) ;
--   face_replay     : le selfie n'est-il pas, au pixel près, le portrait de la
--                     carte ? (un cosinus parfait obtenu par copier-coller ne
--                     prouve rien).
-- Tous trois actifs par défaut : ce sont des garde-fous, pas des options.
UPDATE public.idv_modes
   SET checks = checks
              || '{"selfie_quality": true, "face_ambiguity": true, "face_replay": true}'::jsonb;

COMMENT ON COLUMN public.idv_modes.face_match_reject IS
  'Score normalisé sous lequel le dossier est refusé AUTOMATIQUEMENT. Calibré '
  'sur mesures réelles : doit rester SOUS le pire cas légitime observé '
  '(cos 0.365 → score 0.39). Au-dessus, on refuse des gens honnêtes.';
