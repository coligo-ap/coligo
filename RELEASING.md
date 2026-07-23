# Publier Coligo — web, Android, iOS

Modèle retenu : **tests automatiques à chaque push, mise en production sur signal
explicite (tag)**. Sûr, sans build à chaque commit, sans saturer la revue Apple.

---

## 1. Web (client, commerçant, admin…) — 100 % automatique

Les apps mobiles sont des **coques Capacitor** qui chargent une URL distante
(`server.url` → Vercel). **Tout changement web (pages, composants, logique
serveur, correctifs) part en prod automatiquement à chaque push sur `main`** via
Vercel. Aucune action, aucun rebuild d'app. C'est le canal de mise à jour
principal.

Un nouveau **binaire natif** n'est nécessaire QUE pour un changement natif :
plugin Capacitor, entitlements, splash, manifest, config `capacitor.config.ts`,
`lib/native/**`.

---

## 2. iOS — TestFlight auto, App Store sur tag

Piloté par Codemagic (`codemagic.yaml`).

- **TestFlight (auto)** : un push sur `main` touchant du natif
  (`ios/`, `capacitor.config.ts`, `scripts/ios-client-config.mjs`,
  `lib/native/`, `package.json`) déclenche le workflow `ios-client-app-store` →
  build signé → **TestFlight** (testeurs internes, sans revue).
  ⚠️ Exige que le **webhook GitHub soit connecté** dans Codemagic
  (Team → Applications → coligo). Sinon, lancer à la main :
  `node scripts/codemagic-build.mjs trigger`.

- **App Store / PRODUCTION (sur tag)** :

  ```
  git tag release-2026-07-23      # nom libre, préfixe release-
  git push origin release-2026-07-23
  ```

  → workflow `ios-client-release` → build → **soumission App Store**, publication
  **automatique à l'approbation** (`AFTER_APPROVAL`).

  Points MANUELS incontournables (côté Apple, aucune automatisation ne les
  contourne) :
  - **Revue Apple** ~24–48 h par version.
  - **MARKETING_VERSION** doit être **strictement supérieure** à la dernière
    version approuvée. Quand une version est approuvée, son « train » se ferme
    (erreurs `90186` / `90062` au publish). Bumper les **2 occurrences**
    (Debug + Release) de `MARKETING_VERSION` dans
    `ios/App/App.xcodeproj/project.pbxproj` avant de taguer.
  - Renseigner le **« What's New »** de la nouvelle version dans App Store
    Connect (ou le laisser hériter).

Sonde d'état (lecture seule) : workflow Codemagic `asc-status`, ou
`node scripts/codemagic-build.mjs logs <buildId>`.

---

## 3. Android — une commande, prod quand Google débloque

L'Android se build et se signe **sur la machine de dev** (keystore
`coligo-release`, JDK 21). Une seule commande fait tout :

- **Tests (alpha + interne)** :

  ```
  npm run release:android
  ```

  Bump auto du `versionCode`/`versionName` (flavor client), build de l'AAB,
  upload sur **alpha + interne**.

- **Production** :

  ```
  npm run release:android:prod
  ```

  Idem + tentative de mise en **production**.

  ⚠️ **La production Google est VERROUILLÉE aujourd'hui** (`400
FAILED_PRECONDITION`, vérifié). Il faut d'abord, dans la Play Console :
  1. satisfaire le **test fermé 14 jours consécutifs / 12 testeurs** ;
  2. **« Demander l'accès à la production »** (Google examine) ;
  3. lever le rejet **financial-services** (déclarer « aucune fonctionnalité
     financière » — le P2P Coligo Pay est déjà masqué en prod).
     Tant que ce n'est pas accordé, `release:android:prod` publie quand même les
     pistes de test et signale clairement l'échec prod, sans rien casser.

État des pistes à tout moment : `npm run play:status`.

### Android auto sur push (optionnel, plus tard)

Rendre l'Android auto-buildé en CI (comme iOS) est possible en ajoutant à
Codemagic un workflow Android + 3 secrets (keystore, `google-services.json`,
`play-service-account.json`). Non fait pour l'instant : les changements natifs
Android sont rares, la prod est de toute façon bloquée, et `build-client-aab.mjs`
est déjà portable (Java système hors Windows). À activer sur demande.

---

## Résumé

| Cible          | Déclencheur                    | Résultat                               |
| -------------- | ------------------------------ | -------------------------------------- |
| Web (prod)     | push `main`                    | Vercel déploie, auto                   |
| iOS TestFlight | push `main` (natif)            | build → TestFlight, auto               |
| iOS App Store  | `git tag release-*`            | build → revue Apple → publication auto |
| Android test   | `npm run release:android`      | alpha + interne                        |
| Android prod   | `npm run release:android:prod` | prod **si Google a débloqué**          |
