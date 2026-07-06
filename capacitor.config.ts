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
 *   $env:CAPACITOR_SERVER_URL = "https://coligo.app"
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

// URL de démarrage par défaut = app COMMERCE via la route d'indirection
// dynamique `/api/start/commerce` (redirige côté serveur → on peut changer la
// landing sans rebuild). Les variantes livreur/chauffeur écrivent leur propre
// `server.url` (/api/start/driver | /api/start/drive) au moment du build.
const DEFAULT_URL = "https://coligo.app/api/start/commerce";
const PROD_URL = "https://commercant.coligo.app/api/start/commerce";

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
