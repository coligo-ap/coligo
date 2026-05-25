# Coligo Android (Capacitor)

App Android native qui embarque le site Coligo (commerçant) dans un WebView
Capacitor. Approche **Remote URL** : le WebView charge directement
`https://commercant.coligo.app` (prod) ou `https://coligo-liart.vercel.app`
(test). Aucun export statique — le serveur Next.js reste actif sur Vercel.

## Pré-requis (à installer côté machine)

- **Node ≥ 20** + **npm** (déjà installés)
- **JDK 17** (déjà installé — Temurin 17)
- **Android Studio** (Giraffe ou ≥) — fournit le SDK Android, les emulateurs
  et le build Gradle.
  - Téléchargement : <https://developer.android.com/studio>
  - Au premier lancement, l'assistant installe le **Android SDK Platform 34**
    et les **Android SDK Build-Tools** — accepter par défaut.
- **`adb`** (livré avec le SDK platform-tools, dans `…/Android/Sdk/platform-tools`).
  L'ajouter au `PATH` Windows pour pouvoir taper `adb` partout.

> Vérif rapide après install :
>
> ```powershell
> $env:ANDROID_HOME            # devrait pointer vers ...\Android\Sdk
> adb version                  # doit répondre
> ```

## Étapes — Phase 1 : générer et installer un APK debug

### 1. Sync de la config (toujours après un changement de capacitor.config.ts)

```powershell
# Depuis coligo/
npm run cap:sync              # URL = preview Vercel (coligo-liart.vercel.app)
# ou
npm run cap:sync:prod         # URL = commercant.coligo.app
```

`cap sync` recopie la config dans `android/app/src/main/assets/capacitor.config.json`
— c'est ce fichier que le WebView lit au démarrage.

### 2. Ouvrir le projet dans Android Studio

```powershell
npm run cap:open
# équivaut à : npx cap open android
```

> Si Capacitor ne trouve pas Android Studio automatiquement, ouvrir Android
> Studio manuellement puis : `File → Open…` → sélectionner le dossier
> `coligo/android/`.

Au premier ouvrage, Android Studio :

- télécharge la version de Gradle requise (5–10 min) ;
- déclenche un **Gradle Sync** (l'icône d'éléphant clignote en bas). Attendre
  qu'il finisse — c'est lui qui prépare le build.

Si une popup demande « Install missing platform/build-tools », accepter.

### 3. Brancher l'appareil Android (mode debug)

Sur le téléphone :

- **Paramètres → À propos du téléphone → Numéro de build** : tapoter 7 fois
  pour activer le mode développeur.
- **Paramètres → Options pour les développeurs → Débogage USB** : activer.
- Brancher le téléphone en USB, accepter le prompt « Autoriser le débogage ».

Vérif côté machine :

```powershell
adb devices
# liste devrait contenir un device en "device" (pas "unauthorized")
```

### 4. Générer + installer l'APK debug

**Option A — depuis Android Studio (recommandé en Phase 1) :**

1. Sélectionner l'appareil dans la barre du haut.
2. Cliquer le **bouton Play vert** (`Run 'app'`).
3. Android Studio compile, installe et lance l'app.

L'APK debug est ensuite disponible à :
`coligo/android/app/build/outputs/apk/debug/app-debug.apk`

**Option B — en ligne de commande (Gradle wrapper) :**

```powershell
cd android
.\gradlew assembleDebug                   # build APK
.\gradlew installDebug                    # build + install sur device branché
```

L'APK debug atterrit dans `app/build/outputs/apk/debug/app-debug.apk`.

### 5. Distribuer l'APK debug à un appareil non branché

```powershell
adb -s <serial-de-l-appareil> install -r android\app\build\outputs\apk\debug\app-debug.apk
```

Ou copier le fichier `.apk` sur le téléphone (USB / Drive) et le lancer ; Android
demandera d'autoriser l'install depuis cette source (à n'autoriser que pour le
debug).

## Changer l'URL distante (test ↔ prod)

L'URL est figée dans `capacitor.config.ts` (lue via `CAPACITOR_ENV` ou
`CAPACITOR_SERVER_URL`). Pour basculer :

```powershell
# Test (par défaut)
npm run cap:sync

# Prod
npm run cap:sync:prod

# URL custom one-shot
$env:CAPACITOR_SERVER_URL = "https://feature-xyz.coligo-liart.vercel.app"
npm run cap:sync
```

Toujours **re-builder l'APK** après un sync — la config est embarquée dans
l'APK au moment du build.

## Régénérer icônes / splash

Si la couleur de marque ou l'icône PWA changent dans `public/` :

```powershell
npm run android:assets
npm run cap:sync
```

## Phase 2 — Impression Sunmi (V1 / V2 / T2 / T2 Mini / V3)

L'app embarque un plugin Capacitor local `SunmiPrinter` qui parle directement
au service AIDL système Sunmi (`woyou.aidlservice.jiuiv5`). Le service est
pré-installé sur tous les terminaux Sunmi — aucun JAR/AAR Sunmi à
télécharger.

### Fichiers concernés (côté natif)

- `app/src/main/aidl/woyou/aidlservice/jiuiv5/IWoyouService.aidl`
- `app/src/main/aidl/woyou/aidlservice/jiuiv5/ICallback.aidl`
- `app/src/main/java/com/coligo/app/sunmi/SunmiService.java`
- `app/src/main/java/com/coligo/app/sunmi/SunmiPrinterPlugin.java`
- `app/src/main/java/com/coligo/app/MainActivity.java`
  (enregistre le plugin via `registerPlugin(SunmiPrinterPlugin.class)`)
- `app/build.gradle` — `buildFeatures { aidl true }`

### Vérifier que le service Sunmi est bien dispo

Sur l'appareil Sunmi, après installation de l'APK :

```powershell
adb shell pm list packages | findstr woyou
# Attendu : package:woyou.aidlservice.jiuiv5
```

Si la ligne est absente, l'appareil n'est pas un Sunmi (ou son firmware
n'embarque pas le service d'impression). Le plugin retournera
`{ available: false }` et l'app retombera silencieusement sur
`window.print()` (= dialogue système, peu utile sans imprimante).

### Tester l'impression

1. Brancher le Sunmi en USB, autoriser le débogage.
2. `npm run cap:sync` (ou `cap:sync:prod`) puis builder un APK debug et
   l'installer comme en Phase 1.
3. Ouvrir l'app, se connecter en commerçant, et valider une commande.
4. Vérifier dans les logs runtime :
   ```powershell
   adb logcat -s SunmiService:I SunmiPrinterPlugin:W
   ```
   Au démarrage, attendu : `Sunmi printer service connected`.
5. Le ticket doit sortir sans dialogue, avec : bandeau noir, #ID en gros,
   articles, total, QR du code de retrait, coupe papier finale.

### Forcer le format papier

Par défaut, le ticket est rendu en 58 mm (configurable côté commerçant dans
`/settings`). Le builder Sunmi (`lib/ticket/build-ticket-sunmi.ts`) supporte
58 et 80 mm.

### Régression — appareil non-Sunmi (test rapide)

Sur un téléphone Android lambda :

- `Capacitor.Plugins.SunmiPrinter.isAvailable()` → `{ available: false }`.
- L'app retombe sur `window.print()` du HTML (dialogue système).
  Comportement attendu et conservé pour compatibilité.

## Dépannage

- **`adb devices` montre « unauthorized »** : déverrouiller le téléphone et
  ré-accepter le prompt « Autoriser le débogage ».
- **L'app s'ouvre sur écran blanc** : vérifier que l'URL Vercel répond
  correctement et que le téléphone a une connexion internet. Le WebView a
  besoin du réseau au tout premier lancement (et à chaque navigation).
- **Erreur Gradle « SDK location not found »** : ouvrir le projet via Android
  Studio au moins une fois ; il crée `android/local.properties` avec le bon
  `sdk.dir`.
- **Le splash reste indéfiniment violet** : le WebView a un problème de
  chargement (DNS / certificat / 404). Brancher `chrome://inspect` côté
  desktop pour debugger le WebView.
