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
 * rien à committer, seulement à régénérer avant chaque build/pod install.)
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "ios", "App", "App", "capacitor.config.json");

// Surchargable pour tester contre une preview Vercel, comme build-client-aab.mjs.
const SERVER_URL =
  process.env.COLIGO_CLIENT_URL?.trim() ||
  "https://coligo.app/api/start/client";

writeFileSync(
  OUT,
  JSON.stringify(
    {
      appId: "app.coligo.client",
      appName: "Coligo",
      webDir: "capacitor-webroot",
      server: {
        url: SERVER_URL,
        iosScheme: "https",
      },
      ios: {
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
  `✔ ios/App/App/capacitor.config.json (client) — server.url = ${SERVER_URL}`
);
