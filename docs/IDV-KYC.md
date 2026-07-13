# IDV — Vérification d'identité automatisée (KYC), 100 % open source

Chantier démarré le 13/07/2026. Module transverse `idv_*` (mig 0367+),
distinct du « dossier KYC livreur » (driver_documents, mig 0352) : IDV vérifie
**QUI est la personne** (document authentique + visage correspondant), pour
n'importe quel profil, entièrement piloté par le super-admin.

## RÈGLE LICENCES (exigence propriétaire, 13/07/2026)

**Toute bibliothèque ET tout poids de modèle intégré doit être sous licence
autorisant EXPLICITEMENT l'usage commercial** (Apache-2.0, MIT, BSD…). Vérifier
la licence du CODE **et** des POIDS avant toute intégration ; si une
restriction existe (ex. « research only »), proposer une alternative.
C'est pour ça qu'**InsightFace est ÉCARTÉ** : code MIT, mais poids
pré-entraînés « non-commercial research purposes only ».

## RÈGLE INFRA : Vercel + Supabase, rien d'autre

Pas de VPS, pas de service Docker auto-hébergé. Tout le ML serveur tourne dans
les **fonctions Node de Vercel** (onnxruntime-node + petits modèles ONNX),
qui restent dans les limites de la plateforme (~80 Mo de modèles < 250 Mo par
fonction ; Fluid compute garde l'instance chaude, les modèles se chargent une
fois par instance).

## Principe d'architecture : le client GUIDE, le serveur DÉCIDE

```
┌─ App (Next.js / Capacitor WebView) ─────────────────────────────┐
│ Capture guidée temps réel (cadrage, netteté, reflets, défis     │
│ liveness) — MediaPipe Tasks (WASM) + heuristiques canvas.       │
│ AUCUNE décision côté client (tout est falsifiable).             │
└──────────────┬──────────────────────────────────────────────────┘
               │ upload sécurisé (magic bytes, lib/security)
┌──────────────▼──────────────────────────────────────────────────┐
│ Vercel — Server Actions + route pipeline Node                   │
│ ORCHESTRATION + ANALYSE + DÉCISION (onnxruntime-node, sharp) :  │
│ • document : PP-OCR ONNX (ar+latin) + MRZ tesseract.js +        │
│   checksums ICAO 9303 (implémentés en TS, spec publique)        │
│ • visage : YuNet (détection) + SFace (embeddings)               │
│ • anti-spoof passif : MiniFASNetV2 (converti ONNX)              │
│ • moteur de décision à seuils : lib/idv/decision.ts (pur)       │
│ • journal d'audit append-only (idv_audit_log)                   │
│ Doc et selfie analysés en DEUX appels courts (< limites CPU).   │
└──────────────┬──────────────────────────────────────────────────┘
┌──────────────▼────────────────────────────────────────┐
│ Supabase : tables idv_* + RLS, bucket privé           │
│ idv-captures, feature_flags identity_verification     │
└───────────────────────────────────────────────────────┘
```

Pourquoi ce découpage :

- **Les seuils vivent en DB** (idv_modes), la décision en TypeScript pur :
  changer un seuil ne redéploie rien. Les scores sont **normalisés [0,1]**
  quel que soit le modèle — on peut changer de backend sans casser la config.
- **Dégradé** : pipeline en échec technique ⇒ le dossier part en revue humaine
  (`pending_review`), on ne bloque jamais un utilisateur sur une panne.

## Choix techniques — licences VÉRIFIÉES le 13/07/2026 (code + poids)

| Besoin                            | Retenu                                                                                           | Licence vérifiée                                    | Écarté et pourquoi                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Détection visage (serveur)        | **YuNet** (opencv_zoo, ~345 Ko)                                                                  | MIT (LICENSE du dossier modèle)                     | SCRFD/RetinaFace : poids sur datasets research-only                                                                               |
| Embeddings visage                 | **SFace** (opencv_zoo, ~37 Mo ONNX)                                                              | Apache-2.0 (LICENSE du dossier modèle)              | **InsightFace ArcFace : poids « non-commercial research only » → EXCLU** ; dlib : poids OK mais runtime C++ impossible sur Vercel |
| Anti-spoof passif                 | **MiniFASNetV2** (Silent-Face-Anti-Spoofing, ~2 Mo, poids dans le repo → conversion ONNX maison) | Apache-2.0 (repo + poids inclus)                    | modèles propriétaires = SaaS payant                                                                                               |
| OCR document (AR + FR)            | **PP-OCR det+rec ONNX** (PaddleOCR, ~15-25 Mo)                                                   | Apache-2.0 (code ET modèles, confirmé Baidu)        | EasyOCR : lent ; runtime Paddle C++ : pas Vercel                                                                                  |
| MRZ                               | **tesseract.js** whitelist `A-Z0-9<` + checksums ICAO 9303 en TS                                 | Apache-2.0 (tesseract.js ET tessdata)               | lib Python `mrz` : plus de runtime Python                                                                                         |
| Guidage + liveness actif (client) | **MediaPipe Tasks** (WASM) — défis émis et vérifiés PAR LE SERVEUR                               | Apache-2.0 (framework ET poids, model cards Google) | reconnaissance navigateur seule = falsifiable                                                                                     |
| Runtime inference                 | **onnxruntime-node**                                                                             | MIT                                                 | —                                                                                                                                 |
| Traitement d'image serveur        | **sharp**                                                                                        | Apache-2.0                                          | OpenCV serveur : natif lourd, inutile ici                                                                                         |

Sources licences : [SFace](https://github.com/opencv/opencv_zoo/blob/main/models/face_recognition_sface/LICENSE),
[YuNet](https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/LICENSE),
[Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/blob/master/LICENSE),
[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE),
[tesseract.js](https://github.com/naptha/tesseract.js/blob/master/LICENSE.md),
[tessdata](https://github.com/tesseract-ocr/tessdata/blob/main/LICENSE),
[MediaPipe](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE).

Obligation Apache-2.0/MIT : conserver les notices de licence → un fichier
`THIRD-PARTY-LICENSES` sera ajouté à l'étape 3.

Note précision : SFace (LFW ≈ 99,6 %) est un cran sous ArcFace-r100, mais la
zone intermédiaire part en revue humaine — c'est le filet. Les seuils par
défaut seront **calibrés à l'étape 7** sur le modèle réel (c'est pour ça
qu'ils sont en DB, pas dans le code).

## Modèle de données (mig 0367)

| Table                | Rôle                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idv_modes`          | Niveaux de vérification (express, standard, extensible) : contrôles activés (`checks` jsonb), réaction aux échecs (`policy` jsonb), seuils, tentatives max |
| `idv_document_types` | Registre des documents (dz_passport TD3, dz_cni TD1, dz_permis sans MRZ) — ajouter un pays = une ligne                                                     |
| `idv_profile_rules`  | Par profil (driver, chauffeur, merchant, …) : obligatoire / facultatif / désactivé, modes autorisés, mode par défaut, choix laissé ou non à l'utilisateur  |
| `idv_verifications`  | Le dossier : statuts du parcours, chemins des captures, extractions, scores, décision (+ index « un seul dossier actif par user+profil »)                  |
| `idv_checks`         | Résultat détaillé de chaque contrôle exécuté (par tentative)                                                                                               |
| `idv_audit_log`      | Journal APPEND-ONLY (trigger anti UPDATE/DELETE, sans FK) : qui, quoi, quand, pourquoi, scores                                                             |

Sécurité :

- `idv_verifications` / `idv_checks` / `idv_audit_log` : **aucune policy RLS**
  → service_role uniquement (server actions auto-gardées). Le client ne voit
  jamais scores/extractions bruts (anti-gaming des seuils).
- `idv_modes` : colonnes de **seuils exclues du GRANT** `authenticated`.
- Bucket `idv-captures` : privé, zéro policy storage, URLs signées serveur.
- Kill-switch global : `feature_flags.identity_verification` (défaut `hidden`
  = non publié), carte dans /admin/controle.

## Parcours (statuts)

`draft` → `doc_processing` → `doc_validated` (« Document validé ») →
`selfie_processing` → décision : `approved` / `pending_review` / `rejected`.
L'admin peut exiger `resubmit_document` / `resubmit_selfie`. Terminaux :
`approved`, `rejected`, `canceled`, `expired`.

## Décision automatique (lib/idv/decision.ts — pur, testé)

- `face_match ≥ face_match_approve` et rien d'anormal → **approbation auto** ;
- `face_match < face_match_reject` → **refus auto** ;
- entre les deux, ou liveness/qualité douteuse selon la `policy` du mode →
  **revue humaine** (`pending_review`) ;
- **panne technique d'un contrôle → revue humaine, jamais un refus auto.**

## Étapes du chantier

1. ✅ **Socle** : mig 0367, lib/idv (types, config, décision, audit), flag,
   test `npm run test:idv`.
2. ✅ **Console super-admin — pilotage** : `/admin/identite` (onglet Identité
   du hub Confiance) : publication (flag, éditable si domaine plateforme),
   règles par profil, modes & seuils (zones de décision visualisées), policy
   d'échec, journal d'audit des réglages. Toute écriture : adminCan(confiance)
   - validation pure (lib/idv/settings-validation) + diff audité.
3. ✅ **Fondations du pipeline ML sur Vercel** : onnxruntime-node + sharp ;
   modèles YuNet + SFace épinglés SHA-256 (`npm run idv:models`) et embarqués
   (`outputFileTracingIncludes`, binaires ORT non-linux exclus — 259 Mo → 37) ;
   lib/idv/pipeline/ (sessions par instance, letterbox 640 YuNet validé sur
   vrai visage, SFace RGB brut + L2 conformes à la source OpenCV) ; route
   sonde `POST /api/idv/selftest` (Bearer `INTERNAL_IDV_SECRET`, timings +
   cold start) ; `THIRD-PARTY-LICENSES.md` ; bench `npm run test:idv:pipeline`.
   PIÈGES appris : entrée YuNet FIXE 640×640 ; les poids SFace apparaissent
   comme inputs du graphe (export MXNet) → ne nourrir que « data » ;
   **le postinstall Linux d'onnxruntime-node télécharge ~240 Mo de CUDA**
   (invisible depuis Windows) → `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` (env
   Vercel) + élagage GPU dans scripts/prune-onnx-vercel.mjs, lancé avant
   `next build` ; `outputFileTracingExcludes` est IGNORÉ pour les paquets
   `serverExternalPackages` ; le cache de build Vercel réutilise des traces
   .nft périmées (taille identique à l'octet entre builds) → en cas de
   mystère de taille, rebuild avec `VERCEL_FORCE_NO_BUILD_CACHE=1` +
   `VERCEL_ANALYZE_BUILD_OUTPUT=1` (retirées ensuite).
   **Vérifié en PROD** (13/07) : cold start 903 ms (chargement + inférences),
   instance chaude 207 ms, 401 sans Bearer.
4. ✅ **Parcours client — capture document** (`/driver/identite`, surface
   pilote livreur ; les autres profils à l'étape 9). Intro pas-à-pas avec
   illustrations ANIMÉES (SVG + CSS locales, prefers-reduced-motion géré,
   exigence UX proprio du 13/07), capture caméra plein écran : gabarit du
   document en surimpression (ratio ID-1 / passeport), analyse temps réel de
   la zone du gabarit (netteté Laplacien, lumière, reflets, stabilité) →
   guidage + AUTO-CAPTURE, torche, déclencheur manuel, repli « choisir une
   photo » ; la photo envoyée = CROP du gabarit. Serveur : magic bytes,
   check `doc_quality` (lib/idv/pipeline/quality.ts — mêmes métriques que le
   client mais SEUL verdict qui fait foi), tentatives bornées par le mode
   (au-delà → pending_review), statuts draft → doc_validated (« Document
   validé »), audit complet. L'étape 5 branchera OCR/MRZ/authenticité au
   même endroit avant `doc_validated`.
5. ✅ **Pipeline document** : route interne `POST /api/idv/analyze-document`
   (Bearer, dans la fonction aux modèles) appelée par l'action AVANT
   `doc_validated` — contrat typé versionné (analyze-contract.ts).
   Contrôles : `doc_face` (portrait sur le recto, YuNet, seuil 0.6),
   `mrz` (tesseract.js autohébergé, whitelist A-Z0-9<, bande basse →
   parseur PUR lib/idv/mrz.ts : TD1/TD3 + CHECKSUMS ICAO 9303, réparation
   O→0 sur zones numériques UNIQUEMENT, validé sur les spécimens officiels
   ERIKSSON), `doc_expiry` (date MRZ), `ocr_extract` (PP-OCR : SKIPPED —
   étape 5b pour le permis). Extraction structurée → `extracted` +
   `document_expires_at`. Décision au stade document : échec REPRENABLE
   (MRZ illisible, portrait absent) → reprise photo ; échec DUR (expiré,
   checksums invalides) → policy du mode (refus auto / revue) ; panne
   technique → revue humaine ; pipeline injoignable → revue humaine.
   PIÈGES appris : normalise/sharpen DÉGRADENT tesseract (gris + resize
   1600 seul, mesuré conf 43 vs 0) ; les fillers '<' de fin se perdent à
   l'OCR (tolérance de longueur 36-48/26-34) ; la réparation O→0 ne doit
   JAMAIS toucher les champs alphanumériques (bug attrapé par « ZE184226B »).
   5b ✅ (étape 11) : le **permis** (seul document sans MRZ) est lu par
   **tesseract `fra`** (tessdata autohébergée, Apache-2.0) — PP-OCR s'est
   révélé inutile. `lib/idv/doc-ocr.ts` (pur) extrait les dates (naissance =
   la plus ancienne, expiration = la plus tardive) et le n° de document ; le
   contrôle `doc_expiry` devient RÉEL pour le permis. Quand une MRZ existe,
   elle reste prioritaire (checksums) et l'OCR visuel est sauté.
   Vérifié en PROD : expiration 2032-04-15, naissance 1990-05-12,
   n° 16DZ0034521 extraits d'un permis simulé (4,2 s).
6. ✅ **Selfie + liveness ACTIF** : défis aléatoires (centre → tourner la tête
   à gauche OU à droite → se rapprocher) **tirés et signés par le serveur**
   (`startIdvSelfie`, jeton HMAC lié au dossier + TTL 5 min = anti-rejeu).
   L'app ne fait qu'afficher la consigne, compter, capturer (caméra frontale,
   aperçu miroir mais **frames non-miroir** — la géométrie serveur en dépend ;
   pas de repli fichier : ce serait la négation du contrôle).
   `POST /api/idv/analyze-selfie` (Bearer) calcule par frame : meilleur visage
   YuNet (boîte + 5 repères) + embedding SFace. Le JUGEMENT vit dans
   `lib/idv/liveness.ts` (pur, testé) : yaw = décalage nez ↔ milieu des yeux
   normalisé par l'écart inter-yeux → une vraie rotation 3D produit la
   parallaxe, une **photo inclinée écrase l'écart inter-yeux** (détecté :
   `eye_distance_collapsed`) ; « closer » = grossissement ≥ 18 % ; cohérence
   SFace entre frames (anti-échange de visage). Score vs `liveness_min` du
   mode ; échec reprenable → coaching + reprise (tentatives bornées) ;
   incohérence de visage / tentatives épuisées → policy `liveness_fail` du
   mode (refus auto ou revue) ; pipeline injoignable → revue humaine.
   6b ✅ (étape 11) : **anti-spoof PASSIF** branché — MiniFASNetV2 (ONNX,
   Apache-2.0, SHA-256 épinglé, 1,7 Mo) détecte photo imprimée / écran / rejeu
   **sans rien demander** à l'utilisateur. Conventions **vérifiées au banc**
   (la carte du modèle tiers était FAUSSE) : entrée **BGR BRUT 0-255** (le
   `/255` classait tout en attaque), **crop contextuel carré ×2.7** (c'est le
   contexte — bord d'écran, cadre — qui trahit l'attaque), **classe 1 =
   vivant**. PIÈGE : un crop rogné près du bord est redimensionné avec
   DÉFORMATION et fait chuter un vrai visage (0.99 → 0.23) → on réduit le
   rayon pour garder un carré entier. Seuil `ANTISPOOF_LIVE_MIN = 0.2` (marge
   large : les attaques mesurent 0.000 ; un faux positif coûterait une revue
   humaine inutile) — **à recalibrer sur des captures d'appareils réels**.
   Suspicion ⇒ **revue humaine, jamais un refus automatique**.
   Vérifié en PROD : selfie plein cadre p(vivant) = 0.987 ; photo présentée à
   la caméra p(vivant) = 0.000.
7. ✅ **Face match + DÉCISION AUTOMATIQUE** : `POST /api/idv/face-match`
   re-localise le portrait sur le recto (YuNet), embarque les deux visages
   (SFace) et renvoie le cosinus + un score NORMALISÉ [0,1]
   (`lib/idv/face-match.ts`, ancres **calibrées sur mesures réelles** :
   imposteurs cos 0.166-0.187 → score 0.03-0.07 ; même personne, portrait
   « carte » dégradé ↔ selfie cos 0.742-0.766 → score 1 ; la frontière
   « même identité » d'OpenCV, cos 0.363, tombe à 0.387 = **zone de revue
   humaine** ⇒ on n'approuve automatiquement qu'au-dessus). L'action appelle
   ensuite `decideIdv` (moteur pur de l'étape 1) avec les seuils + la policy
   du mode : **approbation auto / revue humaine / refus auto**, décision +
   raisons écrites sur le dossier, auditées, et l'utilisateur **notifié**
   (cloche `user_notifications` + push FCM). Panne du pipeline, visage non
   comparable, document expiré : jamais de refus « par accident » — revue
   humaine ou policy explicite. Le banc rejoue la calibration : toute dérive
   du modèle casse le test.
8. ✅ **Console super-admin — file de revue** : sous-onglets du domaine
   Identité (Pilotage / **Dossiers à vérifier**, badge du nombre en attente).
   `/admin/identite/dossiers` : file FIFO avec nom, téléphone, document, mode
   et pastilles de score (visage / présence) colorées par zone de décision.
   `/admin/identite/dossiers/[id]` : **selfie et document côte à côte** (URLs
   signées 15 min sur le bucket privé, jamais public), verso + étapes du
   liveness, informations extraites de la MRZ (avec alerte si expiré),
   **tous les contrôles avec leur score et leur statut** (y compris les
   `skipped` — honnêteté sur ce qui n'a pas tourné), panneau de décision
   (approuver / refuser avec **motif obligatoire** / redemander un document
   ou un selfie avec message envoyé au livreur / commentaire interne) et
   **journal d'audit complet**. Transitions gardées (un dossier clos ne se
   re-décide pas), tout est tracé et l'utilisateur est notifié.
9. ✅ **Les trois profils + gating d'accès** : actions IDV déplacées dans
   `app/idv/actions.ts` (partagées), profil transmis par le client mais
   **VALIDÉ serveur** (`resolveProfile` : l'utilisateur doit réellement
   posséder une ligne dans `drivers` / `chauffeurs` / `merchants` — impossible
   d'ouvrir le dossier d'un autre profil). Parcours disponibles sur
   `/driver/identite`, `/chauffeur/identite`, `/identite` (commerçant), avec
   bannière d'appel dans les comptes des trois espaces (variante serveur +
   variante client pour le compte chauffeur, rendu client par perf) — elle
   s'efface d'elle-même si la fonctionnalité n'est pas publiée, si le profil
   n'est pas concerné ou si l'identité est déjà vérifiée.
   **Gating** : `lib/idv/compliance.ts` (`idvBlocksAccess`) branché dans le
   layout livreur, `ChauffeurGateGuard` et le layout commerçant — il ne bloque
   QUE si le super-admin a mis le profil sur « obligatoire » et que l'identité
   n'est pas confirmée. Fail-safe : une panne de lecture ne verrouille jamais
   un partenaire dehors. La file admin résout les noms des trois profils.
   ⚠️ **PIÈGE VÉCU (mesuré en prod)** : la 1ʳᵉ version _redirigeait_ vers le
   parcours → **erreur React #310 sur TOUTES les pages** de l'espace
   (`redirect()` depuis une page streamée sous `loading.tsx`). Corrigé en
   **RENDANT un écran bloquant** (`IdvRequiredScreen`), comme le font déjà
   `DriverBlockedScreen` / `DFrozen` ; le middleware expose `x-pathname` pour
   que les layouts laissent passer la page du parcours elle-même. Vérifié en
   prod : blocage sur /driver, /driver/gains, /driver/parametres,
   /driver/tournees, parcours accessible — **zéro erreur d'hydratation**.
   i18n : les espaces partenaires ne sont pas traduits (next-intl n'y est pas
   utilisé) — les libellés AR restent portés par la DB (`label_ar`,
   `description_ar` des modes et documents), prêts pour le jour où ces espaces
   passeront en bilingue.
10. ✅ **Durcissement** :
    - **E2E `npm run test:idv:e2e`** (16/16 contre la PROD) : fabrique une
      carte réaliste (portrait imprimé + MRZ TD1 aux checksums valides), joue
      les 3 routes, applique le moteur de décision. Il prouve : document lu et
      extrait, même personne → approbation auto, imposteur → refus auto,
      **attaque par photo → liveness refusé**, document expiré → refus,
      routes internes → 401 sans secret. Nettoie le bucket.
      **Il a immédiatement trouvé un vrai bug** : sur une photo de carte
      compressée (JPEG), l'OCR lisait « D231458907 » comme « DZ3VA5O904 » →
      MRZ jugée illisible. Corrigé : **binarisation + passes multiples**
      (zones × prétraitements, sortie dès checksums valides) et **réparation
      OCR symétrique** dans le parseur (« 1<DZA » → « I<DZA », fillers `<`
      de fin perdus tolérés).
    - **Monitoring d'intégrité (mig 0368)** : 7 invariants IDV branchés sur
      `integrity_violations()` (cron quotidien + alerte super-admin) — identité
      approuvée sans face match réussi, décision sans date / sans audit /
      (manuelle) sans admin, dossier clos sans décision, deux dossiers vivants
      pour un même (user, profil), approbation d'un document expiré.
      Exécuté en prod : **0 violation**.
    - **Revue sécurité** (ancrée dans `npm run test:idv`, 46/46, avec sondes
      ANON réelles) : `anon` n'a **aucun** privilège sur les tables `idv_*`
      (401 en REST), les **seuils de décision** restent invisibles même à un
      utilisateur connecté (anti-gaming), le bucket des captures n'est pas
      public (400), les routes internes exigent le secret, l'audit est
      append-only, les tentatives sont bornées par mode.
