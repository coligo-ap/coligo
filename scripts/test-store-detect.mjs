// =============================================================================
// Détection d'appareil pour le lien d'installation `/telecharger`.
//
// Le lien doit tomber juste depuis N'IMPORTE QUEL navigateur — y compris les
// navigateurs INTÉGRÉS aux réseaux sociaux, par lesquels arrive une grande
// partie du trafic quand un lien est partagé. On vérifie ici la fonction pure
// sur des User-Agents réels.
//
// Lancer : node --experimental-strip-types scripts/test-store-detect.mjs
// =============================================================================
import {
  detectPlatformFromUA,
  storeUrlFor,
  forcedPlatform,
  APP_STORE_URL,
  PLAY_URL,
} from "../lib/config/app-stores.ts";

let pass = 0,
  fail = 0;
const eq = (label, got, want) => {
  const p = got === want;
  console.log(
    `${p ? "✅" : "❌"} ${label} → ${got}${p ? "" : ` (attendu ${want})`}`
  );
  p ? pass++ : fail++;
};

// ── ANDROID : navigateurs courants + navigateurs intégrés ──────────────────
const ANDROID = {
  "Chrome Android":
    "Mozilla/5.0 (Linux; Android 10; SM-G970F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  "Samsung Internet":
    "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
  "Firefox Android":
    "Mozilla/5.0 (Android 13; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0",
  "Opera Mini Android":
    "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36 OPR/70.0",
  "UC Browser":
    "Mozilla/5.0 (Linux; U; Android 10; fr-DZ; Redmi Note 9) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/78.0 UCBrowser/13.4.0 Mobile Safari/537.36",
  "Facebook in-app (Android)":
    "Mozilla/5.0 (Linux; Android 12; SM-A125F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/440.0.0.30.115;]",
  "Instagram in-app (Android)":
    "Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36 Instagram 300.0.0.29.110",
  "TikTok in-app (Android)":
    "Mozilla/5.0 (Linux; Android 12; V2111) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/107.0.5304.105 Mobile Safari/537.36 trill_2022905030 BytedanceWebview/d8a21c6",
  "Tablette Android":
    "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

// ── iOS : Safari + navigateurs tiers (tous en WebKit) + intégrés ───────────
const IOS = {
  "Safari iPhone":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
  "Chrome iOS (CriOS)":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
  "Firefox iOS (FxiOS)":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15",
  "Edge iOS (EdgiOS)":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/119.0 Mobile/15E148 Safari/605.1.15",
  "iPad (mode iPad classique)":
    "Mozilla/5.0 (iPad; CPU OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1",
  "Facebook in-app (iOS)":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21A360 [FBAN/FBIOS;FBDV/iPhone14,3;]",
  "Instagram in-app (iOS)":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 302.0.0.23.113",
  "WhatsApp in-app (iOS)":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/WhatsApp",
};

// ── ORDINATEURS : aucune redirection, on montre les deux boutiques ─────────
const DESKTOP = {
  "Chrome Windows":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Safari macOS":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
  "Firefox Linux":
    "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Edge Windows":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  "En-tête absent": "",
};

console.log("── ANDROID ──");
for (const [name, ua] of Object.entries(ANDROID))
  eq(name, detectPlatformFromUA(ua), "android");
console.log("\n── iOS ──");
for (const [name, ua] of Object.entries(IOS))
  eq(name, detectPlatformFromUA(ua), "ios");
console.log("\n── ORDINATEUR ──");
for (const [name, ua] of Object.entries(DESKTOP))
  eq(name, detectPlatformFromUA(ua), "desktop");

console.log("\n── LIENS & PARAMÈTRE FORCÉ ──");
eq("iOS → App Store", storeUrlFor("ios"), APP_STORE_URL);
eq("Android → Google Play", storeUrlFor("android"), PLAY_URL);
eq("Ordinateur → aucune redirection", storeUrlFor("desktop"), null);
eq("?p=ios respecté", forcedPlatform("ios"), "ios");
eq("?p=android respecté", forcedPlatform("android"), "android");
eq("?p=bidon ignoré", forcedPlatform("windows"), null);
eq("?p absent ignoré", forcedPlatform(undefined), null);
eq(
  "fiche App Store bien formée",
  /^https:\/\/apps\.apple\.com\/app\/id\d+$/.test(APP_STORE_URL),
  true
);
eq(
  "fiche Play bien formée",
  /^https:\/\/play\.google\.com\/store\/apps\/details\?id=[\w.]+$/.test(
    PLAY_URL
  ),
  true
);

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
