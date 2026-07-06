# Coligo iOS — préparer et publier sur l'App Store

> Ce guide explique comment produire les apps iOS (`.ipa`) des 3 applications
> Coligo et les déposer sur l'App Store. **Tout ce qui était faisable sous
> Windows est déjà fait** (dépendance `@capacitor/ios`, icônes App Store dans
> `ios-assets/`). Le reste **exige un Mac** (l'outillage Apple est macOS only).

## ⚠️ À savoir avant de commencer

- **Pas de sideload sur iOS.** Contrairement à l'APK Android, on ne distribue
  PAS un `.ipa` par lien. Les seules voies : **App Store** (public),
  **TestFlight** (beta), ou ad-hoc (appareils précis).
- **Prérequis obligatoires :**
  1. Un **Mac** avec **Xcode** (App Store du Mac, gratuit).
  2. Un compte **Apple Developer Program — 99 $/an** (signature + App Store +
     TestFlight). Sans lui, on ne peut RIEN soumettre.
  3. **CocoaPods** : `sudo gem install cocoapods`.
- **Risque de validation** : Apple (règle 4.2) refuse souvent les apps qui ne
  sont qu'une coquille autour d'un site web. Nos apps utilisent du natif (push,
  géolocalisation) → argumenter ça dans les notes de revue. L'imprimante
  **Sunmi est Android-only** : l'app commerçant iOS n'imprime pas en thermique
  (juste l'AirPrint éventuel) — son intérêt iOS est moindre.
- **En attendant** : sur iPhone, la **PWA** fonctionne déjà (Safari →
  Partager → « Sur l'écran d'accueil »). C'est l'option iOS gratuite immédiate.

## Les 3 apps iOS (mêmes choix que l'Android)

| App        | Bundle ID (iOS)       | Nom affiché     | Ouvre sur    | Icône source            |
| ---------- | --------------------- | --------------- | ------------ | ----------------------- |
| Commerçant | `com.coligo.commerce` | Coligo COMMERCE | `/dashboard` | `ios-assets/commerce/…` |
| Livreur    | `com.coligo.livreur`  | Coligo Livreur  | `/driver`    | `ios-assets/livreur/…`  |
| Chauffeur  | `com.coligo.drive`    | Coligo Drive    | `/chauffeur` | `ios-assets/drive/…`    |

> Sur iOS, le push passe par **APNs** (Apple), pas par le package Android. On
> peut donc donner un **bundle ID distinct** à chaque app (recommandé). Chaque
> bundle ID = un App ID à créer dans le portail Apple Developer (avec la
> capability Push Notifications) + un app dans App Store Connect + (pour le
> push Firebase) un `GoogleService-Info.plist` propre + une clé APNs chargée
> dans Firebase.

## Étapes sur le Mac (à répéter pour chaque app)

Cloner le repo et installer :

```bash
git clone <repo> && cd coligo
npm install
```

### 1. Générer le projet iOS (une fois par variante)

`cap add ios` génère le dossier `ios/` (projet Xcode). Comme pour Android, on
règle le **nom**, le **bundle ID** et l'**URL de démarrage** avant chaque build.

Exemple pour **Livreur** :

```bash
# URL de démarrage de la variante (idem Android)
export CAPACITOR_SERVER_URL="https://coligo.app/driver"

# (re)génère ios/ avec cette config
rm -rf ios
npx cap add ios
npx cap sync ios
```

Puis dans **Xcode** (`npx cap open ios`) :

- **Signing & Capabilities** → choisir ton équipe Apple Developer.
- **Bundle Identifier** → `com.coligo.livreur`.
- **Display Name** (onglet General, ou `CFBundleDisplayName` dans Info.plist) →
  `Coligo Livreur`.
- **+ Capability → Push Notifications** (et Background Modes → Remote
  notifications) si le push est voulu.

### 2. Icône App Store

Remplace l'icône par celle de la variante :

```bash
# ex. livreur — copie l'AppIcon prêt à l'emploi
cp -R ios-assets/livreur/AppIcon.appiconset/* \
   ios/App/App/Assets.xcassets/AppIcon.appiconset/
```

(Le 1024×1024 sans transparence est déjà conforme aux exigences App Store.
Xcode 15+ accepte cette icône « single size » et décline les autres tailles.)

### 3. Push Firebase (optionnel mais recommandé pour livreur/chauffeur)

- Dans la console Firebase (projet `coligo-c04b0`) → Ajouter une app iOS avec
  le bundle ID (`com.coligo.livreur`), télécharger le `GoogleService-Info.plist`
  et le glisser dans `ios/App/App/`.
- Créer une clé APNs (Apple Developer → Keys) et la charger dans Firebase →
  Cloud Messaging → Apple app configuration.

### 4. Archiver et envoyer à l'App Store

```bash
npx cap sync ios
npx cap open ios
```

Dans Xcode : **Product → Archive** → **Distribute App → App Store Connect →
Upload**. Puis sur **App Store Connect** : créer la fiche (captures, description,
confidentialité), rattacher le build, soumettre à la revue.

### Répéter pour Commerçant et Chauffeur

Même procédure en changeant les 3 valeurs :

| Variante   | `CAPACITOR_SERVER_URL`         | Bundle ID             | Nom             | Icône `ios-assets/…` |
| ---------- | ------------------------------ | --------------------- | --------------- | -------------------- |
| Commerçant | `https://coligo.app/dashboard` | `com.coligo.commerce` | Coligo COMMERCE | `commerce/`          |
| Livreur    | `https://coligo.app/driver`    | `com.coligo.livreur`  | Coligo Livreur  | `livreur/`           |
| Chauffeur  | `https://coligo.app/chauffeur` | `com.coligo.drive`    | Coligo Drive    | `drive/`             |

> Astuce : comme `cap add ios` régénère `ios/`, build **une app à la fois**
> (génère → configure dans Xcode → archive → upload), puis passe à la suivante.
> Quand l'URL prod (`commercant.coligo.app`…) sera achetée, mettre à jour
> `CAPACITOR_SERVER_URL` et re‑builder.

## Ce qui est déjà prêt dans le repo (fait sous Windows)

- `@capacitor/ios` ajouté à `package.json`.
- `ios-assets/{commerce,livreur,drive}/AppIcon.appiconset/` — icônes App Store
  1024×1024 sans transparence + `Contents.json`.
- La config `capacitor.config.ts` lit déjà `CAPACITOR_SERVER_URL` (commune
  Android/iOS).
- Le code applicatif (push, géoloc) est cross‑platform via Capacitor.

Il ne reste donc, sur le Mac, qu'à générer `ios/`, poser bundle ID + nom +
icône, et soumettre.
