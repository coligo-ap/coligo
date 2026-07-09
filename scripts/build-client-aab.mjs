#!/usr/bin/env node
/**
 * Build du .aab RELEASE de l'app CLIENT Google Play (flavor `client`,
 * package app.coligo.client).
 *
 *   node scripts/build-client-aab.mjs            # build complet
 *   node scripts/build-client-aab.mjs --assets   # regénère aussi icônes/splash
 *
 * Étapes :
 *  1. (ré)écrit android/app/src/client/assets/capacitor.config.json —
 *     l'identité client (nom « Coligo », server.url /api/start/client).
 *     Les assets d'un flavor ÉCRASENT ceux de main à la fusion : `cap sync`
 *     (qui n'écrit que src/main) ne peut pas désynchroniser ce fichier.
 *  2. npx cap sync android (plugins natifs à jour).
 *  3. préflight : google-services.json doit contenir app.coligo.client
 *     (sinon FCM mort et le plugin google-services fait échouer le build).
 *  4. gradlew bundleClientRelease, signé via android/keystore.properties
 *     (keystore coligo-release — le MÊME que l'assetlinks.json du site).
 *
 * Sortie : android/app/build/outputs/bundle/clientRelease/app-client-release.aab
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ANDROID = join(ROOT, "android");
const CLIENT_ASSETS = join(ANDROID, "app", "src", "client", "assets");
const AAB = join(
  ANDROID,
  "app",
  "build",
  "outputs",
  "bundle",
  "clientRelease",
  "app-client-release.aab"
);

// URL de démarrage — surchargable pour tester contre une preview Vercel :
//   COLIGO_CLIENT_URL=https://<preview>.vercel.app/api/start/client node scripts/build-client-aab.mjs
const SERVER_URL =
  process.env.COLIGO_CLIENT_URL?.trim() ||
  "https://coligo.app/api/start/client";

// JDK 21 (JBR d'Android Studio) — le JDK 17 système ne suffit plus pour
// certaines toolchains AGP récentes ; le JBR est toujours aligné.
const JBR = "C:\\Program Files\\Android\\Android Studio\\jbr";

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...(opts.env ?? {}) },
    shell: opts.shell ?? false,
  });
  if (res.status !== 0) {
    console.error(`\n✖ ${cmd} ${args.join(" ")} → exit ${res.status}`);
    process.exit(res.status ?? 1);
  }
}

// 1. Config Capacitor du flavor client.
writeFileSync(
  join(CLIENT_ASSETS, "capacitor.config.json"),
  JSON.stringify(
    {
      appId: "app.coligo.client",
      appName: "Coligo",
      webDir: "capacitor-webroot",
      server: { url: SERVER_URL, androidScheme: "https" },
      android: {
        allowMixedContent: false,
        // Fond de la WebView PENDANT le chargement de l'URL distante. Sans lui
        // elle est blanche : l'écran de lancement violet laissait place à un
        // flash blanc de ~1 à 2,5 s avant la première frame web. Doit rester
        // égal à @color/coligo_splash (android/.../values/colors.xml) et à la
        // frame 0 de l'intro (components/brand/intro-splash.module.css).
        backgroundColor: "#4C1B9B",
      },
    },
    null,
    "\t"
  ) + "\n"
);
console.log(`✔ capacitor.config.json (client) — server.url = ${SERVER_URL}`);

// 1b. Icônes/splash du flavor (optionnel — sources rarement changées).
if (process.argv.includes("--assets")) {
  run(
    process.platform === "win32" ? "node.exe" : "node",
    [join(ROOT, "scripts", "android-assets.mjs")],
    {
      env: {
        COLIGO_RES_DIR: "src/client/res",
        COLIGO_ICON_FULLBLEED: "1",
        COLIGO_ICON_LOGO: "icons/client-maskable-512.png",
        COLIGO_BRAND_HEX: "#47168B",
      },
    }
  );
}

// 2. Sync Capacitor (plugins + config main/commerce, sans toucher au client).
run(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["cap", "sync", "android"],
  {
    shell: process.platform === "win32",
  }
);

// 3. Préflight Firebase : le flavor client DOIT exister dans google-services.json.
const gs = JSON.parse(
  readFileSync(join(ANDROID, "app", "google-services.json"), "utf8")
);
const clientEntry = (gs.client ?? []).find(
  (c) =>
    c.client_info?.android_client_info?.package_name === "app.coligo.client"
);
const packages = (gs.client ?? []).map(
  (c) => c.client_info?.android_client_info?.package_name
);
// Rejette aussi un mobilesdk_app_id placeholder (que des zéros) — FCM mort.
if (
  clientEntry &&
  /:0{10,}/.test(clientEntry.client_info?.mobilesdk_app_id ?? "")
) {
  console.error(
    "✖ google-services.json : l'entrée app.coligo.client est un PLACEHOLDER (app id à zéros) — remplacer par la vraie config Firebase."
  );
  process.exit(1);
}
if (!packages.includes("app.coligo.client")) {
  console.error(`
✖ google-services.json ne contient pas app.coligo.client (trouvé : ${packages.join(", ")}).

  Sans lui, les notifications push FCM de l'app Play seraient MORTES.
  → Console Firebase (projet coligo-c04b0) → Paramètres du projet →
    Ajouter une application → Android → package « app.coligo.client » →
    télécharger le nouveau google-services.json (il contiendra LES DEUX apps)
    et remplacer android/app/google-services.json.
`);
  process.exit(1);
}
console.log("✔ google-services.json contient app.coligo.client");

// 4. Bundle release signé.
if (!existsSync(join(ANDROID, "keystore.properties"))) {
  console.error(
    "✖ android/keystore.properties absent — le .aab sortirait NON signé."
  );
  process.exit(1);
}
run(
  join(ANDROID, process.platform === "win32" ? "gradlew.bat" : "gradlew"),
  ["bundleClientRelease"],
  {
    cwd: ANDROID,
    env: existsSync(JBR) ? { JAVA_HOME: JBR } : {},
    // .bat → exécution via cmd.exe obligatoire (spawnSync sans shell = ENOENT).
    shell: process.platform === "win32",
  }
);

const sizeMb = (statSync(AAB).size / (1024 * 1024)).toFixed(1);
console.log(`\n✔ Bundle prêt : ${AAB} (${sizeMb} Mo)`);
console.log(
  "  → Play Console (fiche app.coligo.client) → Tests internes → Importer."
);
