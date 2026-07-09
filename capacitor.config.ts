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
 *
 * FLAVOR CLIENT (Google Play, package app.coligo.client) : le flavor Android
 * `client` embarque SA PROPRE config dans `android/app/src/client/assets/
 * capacitor.config.json` (appName « Coligo », server.url = /api/start/client).
 * Ce fichier est régénéré par `node scripts/build-client-aab.mjs` — les assets
 * d'un flavor écrasent ceux de main à la fusion, donc `cap sync` (qui n'écrit
 * que dans src/main) ne le touche jamais.
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
    // PAS d'`errorPath` ici, volontairement.
    //
    // Sans connexion, la WebView affiche la page d'erreur de Chrome. Capacitor
    // sait charger une page embarquée à la place (`server.errorPath`, chargée
    // par BridgeWebViewClient.onReceivedError quand isForMainFrame). On le fait
    // — mais SEULEMENT pour le flavor client, dans scripts/build-client-aab.mjs.
    //
    // Raison : `capacitor-webroot/offline.html` renvoie vers
    // `/api/start/client` quand l'utilisateur réessaie. Cette config-ci sert
    // les APK commerçant / livreur / chauffeur, qui atterrissent ailleurs
    // (`/api/start/commerce`…) : ils repartiraient dans le mauvais espace.
    // Pour l'étendre : mémoriser la dernière URL du rôle (Preferences) et la
    // relire dans offline.html au lieu de l'URL client codée en dur.
  },
  android: {
    // Géré côté Android — pas d'override mode debug ici.
    allowMixedContent: false,
    // Fond de la WebView PENDANT le chargement de l'URL distante (~1 à 2,5 s de
    // SSR + réseau). C'est le blanc de l'écran de lancement natif ET de la
    // frame 0 de l'intro (scène façon Bolt, fond entièrement blanc) → une seule
    // couleur continue, du tap sur l'icône jusqu'à l'animation.
    //
    // Quatre endroits doivent rester d'accord :
    //   - ici (+ scripts/build-client-aab.mjs pour le flavor client) ;
    //   - android/app/src/main/res/values/colors.xml → @color/coligo_splash ;
    //   - android/.../intro/IntroSplashView.java → constante SEAM.
    // (L'intro WEB garde son dégradé violet : elle ne tourne que dans la PWA
    // installée, qui n'a ni ce thème ni cette WebView.)
    backgroundColor: "#FFFFFF",
  },
};

export default config;
