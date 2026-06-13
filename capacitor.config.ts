import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Configuration Capacitor — Coligo Android (commerçant).
 *
 * Approche « Remote URL » : le WebView ne charge PAS un export statique
 * (impossible : Next.js a besoin du serveur — Server Actions, middleware, RLS).
 * Il pointe sur l'URL Vercel/prod et reste synchronisé avec le web.
 *
 * Pour basculer l'URL (test ↔ prod), définir CAPACITOR_SERVER_URL avant
 * `npx cap sync` :
 *
 *   # Test (par défaut)
 *   $env:CAPACITOR_SERVER_URL = "https://coligo-liart.vercel.app"
 *
 *   # Prod
 *   $env:CAPACITOR_SERVER_URL = "https://commercant.coligo.app"
 *
 *   npx cap sync android
 *
 * La valeur est figée dans `android/app/src/main/assets/capacitor.config.json`
 * au moment du `cap sync` — il faut donc re-sync (et re-build l'APK) après
 * changement.
 */

const DEFAULT_URL = "https://coligo-liart.vercel.app";
const PROD_URL = "https://commercant.coligo.app";

const serverUrl =
  process.env.CAPACITOR_SERVER_URL?.trim() ||
  (process.env.CAPACITOR_ENV === "prod" ? PROD_URL : DEFAULT_URL);

const config: CapacitorConfig = {
  appId: "com.coligo.app",
  appName: "Coligo COMMERCE",
  webDir: "capacitor-webroot",
  server: {
    url: serverUrl,
    // HTTPS uniquement (Vercel + prod). Pas besoin de cleartext en prod.
    // Si un jour on teste contre un dev server local en HTTP, ajouter ici :
    //   cleartext: true,
    // et autoriser dans network_security_config.xml.
    androidScheme: "https",
  },
  android: {
    // Géré côté Android — pas d'override mode debug ici.
    allowMixedContent: false,
  },
};

export default config;
