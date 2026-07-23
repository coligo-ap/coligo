#!/usr/bin/env node
/**
 * Réécrit ios/App/App/capacitor.config.json avec l'identité CLIENT
 * (appId app.coligo.client, server.url /api/start/client).
 *
 * `npx cap sync ios` régénère ce fichier À PARTIR de capacitor.config.ts
 * (identité COMMERCE) à chaque appel — il n'y a pas de flavor iOS comme sur
 * Android. Ce script s'exécute donc TOUJOURS APRÈS `cap sync ios`, en local
 * comme en CI (Codemagic) :
 *
 *   npx cap sync ios && node scripts/ios-client-config.mjs
 *
 * (ios/App/App/capacitor.config.json est gitignored par Capacitor lui-même —
 * rien à committer, seulement à régénérer avant chaque build.)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "ios", "App", "App", "capacitor.config.json");

// Surchargable pour tester contre une preview Vercel, comme build-client-aab.mjs.
const SERVER_URL =
  process.env.COLIGO_CLIENT_URL?.trim() ||
  "https://coligo.app/api/start/client";

// ⚠️ FUSION, jamais ÉCRASEMENT : `cap sync ios` génère dans ce fichier des
// clés VITALES — surtout `packageClassList`, la liste qui ENREGISTRE les
// plugins natifs côté iOS (SPM). L'ancienne version réécrivait l'objet
// complet sans elle → AUCUN plugin natif enregistré → « plugin is not
// implemented on iOS » sur Google, Stripe, push… (bug vécu builds ≤ 24).
// On lit donc le fichier généré et on ne surcharge QUE l'identité client.
const generated = JSON.parse(readFileSync(OUT, "utf8"));
if (!Array.isArray(generated.packageClassList)) {
  throw new Error(
    "packageClassList absent du capacitor.config.json généré — lancer " +
      "`npx cap sync ios` AVANT ce script (cf. codemagic.yaml)."
  );
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      ...generated,
      appId: "app.coligo.client",
      appName: "Coligo",
      // Marqueur d'identification APP dans le user-agent : contrairement à
      // Android (« ; wv) » ajouté par Chrome), le WKWebView iOS est
      // indiscernable de Safari → le serveur ne posait jamais le cookie
      // coligo_native et servait les bannières WEB (installer la PWA, mise à
      // jour) DANS l'app. /api/start/<role> reconnaît ce marqueur.
      appendUserAgent: "ColigoApp",
      server: {
        url: SERVER_URL,
        // ⚠️ PAS de `iosScheme: "https"` : interdit par Capacitor sur iOS
        // (WKWebView gère déjà http/https). Avec, le pont calcule son origine
        // interne en `capacitor://coligo.app` et traite https://coligo.app
        // comme un site EXTERNE → ouverture dans Safari + WebView blanche
        // (bug vécu build 21). `androidScheme: "https"` reste valide côté
        // Android — c'est un cas spécial Android uniquement.
        // Garde-fou : les navigations restent bornées au domaine + aux hôtes de
        // PAIEMENT (Chargily / SATIM / Stripe), qui doivent s'ouvrir DANS l'app
        // et non dans Safari. Le paiement passe d'abord par le navigateur
        // intégré (@capacitor/browser) ; ceci couvre le repli (window.location).
        allowNavigation: [
          "coligo.app",
          "*.coligo.app",
          "pay.chargily.net",
          "*.chargily.net",
          "*.chargily.com",
          "*.chargily.dz",
          "*.satim.dz",
          "*.stripe.com",
        ],
      },
      ios: {
        ...(generated.ios ?? {}),
        // Doit rester égal au blanc de l'écran de lancement natif (Splash.imageset)
        // et à android.backgroundColor de capacitor.config.ts — fond continu du tap
        // sur l'icône jusqu'à l'intro CSS de la page.
        backgroundColor: "#FFFFFF",
        contentInset: "always",
      },
    },
    null,
    "\t"
  ) + "\n"
);
console.log(
  `✔ ios/App/App/capacitor.config.json (client) — server.url = ${SERVER_URL} — ` +
    `${generated.packageClassList.length} plugins natifs enregistrés`
);
