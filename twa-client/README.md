# Coligo — TWA client (`app.coligo.client`)

App Android **Trusted Web Activity** qui ouvre `https://coligo.app` (espace
client) en plein écran, sans barre Chrome, à condition que les Digital Asset
Links soient vérifiés (`public/.well-known/assetlinks.json` côté site).

Projet généré par **Bubblewrap** depuis `twa-manifest.json` — ne pas éditer
les fichiers Android à la main : modifier `twa-manifest.json` puis régénérer.

## Build

```powershell
# Depuis coligo/twa-client/ — JDK 17 + Android SDK configurés dans ~/.bubblewrap/config.json
npx @bubblewrap/cli update --skipVersionUpgrade   # régénère le projet après un changement de twa-manifest.json
$env:BUBBLEWRAP_KEYSTORE_PASSWORD = "<mdp keystore>"
$env:BUBBLEWRAP_KEY_PASSWORD = "<mdp keystore>"
npx @bubblewrap/cli build --skipPwaValidation
```

Sorties : `app-release-signed.apk` (test direct / sideload) et
`app-release-bundle.aab` (upload Play Console).

## Signature

Signé avec le keystore partagé `../android/coligo-release.keystore`
(alias `coligo`, hors git). Son empreinte SHA-256 est déjà dans
`assetlinks.json`. Après le premier upload sur la Play Console (Play App
Signing), ajouter AUSSI l'empreinte « clé de signature d'application » de la
console dans `assetlinks.json` (elle remplace le placeholder restant).

## Nouvelle version

Incrémenter `appVersionCode` (+ `appVersionName`) dans `twa-manifest.json`,
puis `update --skipVersionUpgrade` et `build`.
