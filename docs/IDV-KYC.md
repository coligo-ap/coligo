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
4. Parcours client — capture document guidée + upload sécurisé.
   **Exigence UX (proprio, 13/07)** : expliquer CHAQUE étape pas-à-pas avec
   illustrations ANIMÉES soignées (Lottie locales + repli CSS, jamais de CDN,
   pas d'emojis en dur), gabarit visuel du document en surimpression pendant
   le scan (template carte/passeport), micro-animations de transition,
   textes courts style Bolt — niveau frontend « grande app ».
5. Pipeline document : PP-OCR, MRZ + checksums, expiration, anti-fraude,
   extraction structurée.
6. Selfie + liveness (défis actifs signés + MiniFASNet passif — conversion
   ONNX maison des poids Apache-2.0).
7. Face match (YuNet + SFace) + calibration des seuils + branchement du
   moteur de décision + notifications.
8. Console super-admin — file de revue : côte à côte, approuver/refuser/
   redemander, commentaires internes, audit.
9. Intégration profils (livreur, chauffeur, commerçant) + i18n AR + gating.
10. Durcissement : tests E2E, monitoring d'intégrité, revue sécurité.
