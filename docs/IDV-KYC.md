# IDV — Vérification d'identité automatisée (KYC), 100 % open source

Chantier démarré le 13/07/2026. Module transverse `idv_*` (mig 0367+),
distinct du « dossier KYC livreur » (driver_documents, mig 0352) : IDV vérifie
**QUI est la personne** (document authentique + visage correspondant), pour
n'importe quel profil, entièrement piloté par le super-admin.

## Principe d'architecture : le client GUIDE, le serveur DÉCIDE

```
┌─ App (Next.js / Capacitor WebView) ─────────────────────────────┐
│ Capture guidée temps réel (cadrage, netteté, reflets, défis     │
│ liveness) — MediaPipe Tasks (WASM) + heuristiques canvas.       │
│ AUCUNE décision côté client (tout est falsifiable).             │
└──────────────┬──────────────────────────────────────────────────┘
               │ upload sécurisé (magic bytes, lib/security)
┌──────────────▼──────────────────────────────────────────────────┐
│ Next.js Server Actions — ORCHESTRATION + DÉCISION               │
│ • crée/gère le dossier (idv_verifications, service_role)        │
│ • appelle le service KYC (HMAC), stocke scores + extractions    │
│ • moteur de décision à seuils : lib/idv/decision.ts (pur)       │
│ • journal d'audit append-only (idv_audit_log)                   │
└───────┬──────────────────────────────┬──────────────────────────┘
        │                              │
┌───────▼───────────────┐   ┌──────────▼──────────────────────────┐
│ Supabase              │   │ Service KYC (Python FastAPI, Docker) │
│ • tables idv_* + RLS  │   │ • OCR PaddleOCR (AR+FR+latin)        │
│ • bucket privé        │   │ • MRZ : Tesseract OCR-B + checksums  │
│   idv-captures        │   │   ICAO 9303 (lib mrz)                │
│ • feature_flags       │   │ • Face : détection + embeddings      │
│   identity_           │   │   (InsightFace SCRFD/ArcFace ONNX)   │
│   verification        │   │ • Anti-spoof passif : MiniFASNet     │
└───────────────────────┘   │ • Fraude doc : cohérence MRZ↔OCR,    │
                            │   dates, qualité, écran/photocopie   │
                            │ Stateless, scores normalisés [0,1]   │
                            └──────────────────────────────────────┘
```

Pourquoi ce découpage :

- **Vercel ne peut pas héberger les modèles** (limites de taille des functions,
  cold starts) → un microservice Docker CPU auto-hébergé, déployable sur
  n'importe quel petit VPS. Contrat d'API versionné, authentifié par HMAC.
- **Les seuils vivent en DB** (idv_modes), la décision en TypeScript pur : le
  service Python ne renvoie QUE des scores bruts normalisés → changer un seuil
  ne redéploie rien.
- **Dégradé** : service KYC injoignable ⇒ le dossier part en revue humaine
  (`pending_review`), on ne bloque jamais un utilisateur sur une panne.

## Choix techniques (comparés)

| Besoin                          | Retenu                                                                                                                                                                                                                                      | Écarté et pourquoi                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| OCR (AR + FR)                   | **PaddleOCR** (Apache-2.0)                                                                                                                                                                                                                  | Tesseract : faible sur photos de terrain ; EasyOCR : lent, lourd |
| MRZ                             | **Tesseract OCR-B + lib `mrz`** (checksums ICAO 9303)                                                                                                                                                                                       | PaddleOCR généraliste moins fiable sur la police OCR-B           |
| Visage (détection + embeddings) | **InsightFace** SCRFD + ArcFace ONNX — ⚠️ poids pré-entraînés « recherche non commerciale » ; abstraction backend pour basculer sur **dlib/face_recognition** (licence permissive, LFW 99,38 %) si besoin — décision à trancher à l'étape 7 | face-api.js : abandonné ; DeepFace : wrapper lourd               |
| Liveness passif                 | **MiniFASNet** (Silent-Face-Anti-Spoofing, Apache-2.0)                                                                                                                                                                                      | modèles propriétaires = SaaS payant                              |
| Liveness actif                  | **MediaPipe Tasks** (Apache-2.0) côté client : défis aléatoires ÉMIS ET VÉRIFIÉS PAR LE SERVEUR sur les frames                                                                                                                              | reconnaissance dans le navigateur seul = falsifiable             |
| Guidage document                | Heuristiques canvas (netteté Laplacien, reflets) + OpenCV.js chargé à la demande, auto-hébergé (`public/vendor`, jamais de CDN)                                                                                                             | —                                                                |
| Service                         | **FastAPI + onnxruntime CPU + Docker**                                                                                                                                                                                                      | Node/onnxruntime-node : écosystème OCR/vision bien plus pauvre   |

Tous les **scores sont normalisés [0,1]** par le service (quel que soit le
backend) — les seuils en DB restent valides si on change de modèle.

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
2. Console super-admin — pilotage : `/admin/identite` (domaine Confiance) :
   règles par profil, modes, seuils, publication.
3. Service KYC Python : squelette FastAPI + Docker + HMAC + contrat d'API.
4. Parcours client — capture document guidée + upload sécurisé.
5. Pipeline document : OCR, MRZ, expiration, anti-fraude, extraction.
6. Selfie + liveness (défis actifs signés + anti-spoof passif).
7. Face match + branchement du moteur de décision + notifications.
8. Console super-admin — file de revue : côte à côte, approuver/refuser/
   redemander, commentaires internes, audit.
9. Intégration profils (livreur, chauffeur, commerçant) + i18n AR + gating.
10. Durcissement : tests E2E, monitoring d'intégrité, revue sécurité.
