// Accueil client : à CHAQUE ouverture, la marketplace part de la position
// ACTUELLE — jamais de la zone choisie la fois d'avant.
//
//   BASE=http://localhost:3011 node scripts/_test-client-location-boot.mjs
//   BASE=https://coligo.app    node scripts/_test-client-location-boot.mjs
//
// Scénario : une position CHOISIE MANUELLEMENT à Oran est en mémoire (comme
// après une session précédente), le téléphone est réellement à Alger.
//
// Attendu, dans cet ordre :
//   1. À l'ouverture, l'accueil n'affiche NI l'ancienne adresse NI les
//      commerces d'Oran : il annonce la détection en cours (squelettes).
//   2. Dès le fix GPS, header ET liste basculent sur Alger.
//   3. Le basculement tient (pas de retour en arrière).
//
// ⚠ En LOCAL, lancer `next dev` avec les variables Supabase de PROD
// (`.env.development.local` pointe la base dev en pause). Cf. mémoire projet.
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3011";
const ALGER = { latitude: 36.7538, longitude: 3.0588 };
const ORAN = {
  wilaya_code: "31",
  commune: "Oran",
  latitude: 35.6971,
  longitude: -0.6308,
  address: "Rue Larbi Ben Mhidi, Oran",
  source: "manual",
};

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "KO  "} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: "fr-DZ",
  permissions: ["geolocation"],
  geolocation: ALGER,
});
await ctx.addCookies([
  { name: "NEXT_LOCALE", value: "fr", url: BASE },
  {
    name: "coligo_loc",
    value: encodeURIComponent(
      JSON.stringify({
        la: ORAN.latitude,
        lo: ORAN.longitude,
        w: ORAN.wilaya_code,
        c: ORAN.commune,
      })
    ),
    url: BASE,
  },
]);
await ctx.addInitScript(
  ([o]) => {
    try {
      localStorage.setItem(
        "coligo:customer:location",
        JSON.stringify({ ...o, updated_at: new Date(0).toISOString() })
      );
      // Session NEUVE = ouverture d'app : c'est ce marqueur qui déclenche la
      // détection bloquante côté client.
      sessionStorage.removeItem("coligo:geo:boot-done");
    } catch {}
  },
  [ORAN]
);

const page = await ctx.newPage();
await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 120000 });

// ── 1. Ouverture : l'ANCIENNE adresse ne doit jamais être affichée ────────
// On échantillonne tôt et souvent : c'est la fenêtre où le bug se voyait. La
// sonde porte sur le HEADER et sur l'adresse EXACTE d'avant — « Oran » tout
// court apparaîtrait légitimement dans le nom d'un commerce.
const OLD_LABEL = /Rue Larbi Ben Mhidi/i;
let leakedOldZone = null;
const startedAt = Date.now();
while (Date.now() - startedAt < 4000) {
  const h = (await page.locator("header").innerText()).replace(/\s+/g, " ");
  if (OLD_LABEL.test(h)) {
    leakedOldZone = h.slice(0, 120);
    break;
  }
  await page.waitForTimeout(200);
}
check("ouverture sans l'ancienne adresse", !leakedOldZone, leakedOldZone ?? "");

// ── 2. Bascule sur la position réelle ─────────────────────────────────────
let switched = false;
for (let i = 0; i < 30; i++) {
  const st = await page.evaluate(() => {
    const r = localStorage.getItem("coligo:customer:location");
    return r ? JSON.parse(r) : null;
  });
  if (st?.source === "gps" && st.wilaya_code === "16") {
    switched = true;
    break;
  }
  await page.waitForTimeout(1000);
}
check("position remplacée par le GPS réel (Alger)", switched);

// Le header suit la position : on lui laisse le temps de peindre le libellé
// (l'adresse lisible arrive avec le géocodage, juste après les coordonnées).
let header = "";
for (let i = 0; i < 15; i++) {
  header = (await page.locator("header").innerText()).replace(/\s+/g, " ");
  if (/Alger/i.test(header)) break;
  await page.waitForTimeout(1000);
}
check(
  "header sur la position actuelle",
  /Alger/i.test(header) && !/Oran/i.test(header),
  header.slice(0, 90)
);

// ── 3. Stabilité : on ne repart pas en arrière ────────────────────────────
// L'assertion porte sur le HEADER et sur la position stockée, pas sur toute la
// page : « Oran » peut légitimement apparaître dans le nom d'un commerce.
await page.waitForTimeout(6000);
const header2 = (await page.locator("header").innerText()).replace(/\s+/g, " ");
check(
  "pas de retour à l'ancienne zone",
  /Alger/i.test(header2) && !/Oran/i.test(header2),
  header2.slice(0, 90)
);
const stored = await page.evaluate(() => {
  const r = localStorage.getItem("coligo:customer:location");
  return r ? JSON.parse(r) : null;
});
check(
  "position stockée = GPS actuel",
  stored?.source === "gps" && stored?.wilaya_code === "16",
  JSON.stringify({ s: stored?.source, w: stored?.wilaya_code })
);

await page.screenshot({
  path:
    process.env.SHOT ??
    "C:/Users/gaci/AppData/Local/Temp/claude/C--Users-gaci-Desktop-noti-dz-coligo-v3-violet/25ac6e4c-ac0d-404f-96bb-d04e5a1d7281/scratchpad/client-boot.png",
});
await ctx.close();

// ── 4. NON-RÉGRESSION : géoloc REFUSÉE → l'accueil ne reste pas en attente ──
// Sans cette garantie, un client qui a dit non verrait des squelettes pendant
// tout le délai de garde à chaque ouverture.
const ctx2 = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: "fr-DZ",
  permissions: [], // Chromium refuse la géolocalisation
});
await ctx2.addCookies([{ name: "NEXT_LOCALE", value: "fr", url: BASE }]);
await ctx2.addInitScript(
  ([o]) => {
    try {
      localStorage.setItem(
        "coligo:customer:location",
        JSON.stringify({ ...o, updated_at: new Date(0).toISOString() })
      );
      sessionStorage.removeItem("coligo:geo:boot-done");
    } catch {}
  },
  [ORAN]
);
const page2 = await ctx2.newPage();
const t0 = Date.now();
await page2.goto(BASE + "/", {
  waitUntil: "domcontentloaded",
  timeout: 120000,
});
let released = false;
for (let i = 0; i < 30; i++) {
  const h = (await page2.locator("header").innerText()).replace(/\s+/g, " ");
  if (!/Localisation…/i.test(h)) {
    released = true;
    break;
  }
  await page2.waitForTimeout(500);
}
const waited = Math.round((Date.now() - t0) / 1000);
check(
  "géoloc refusée : accueil rendu vite (≤ 10 s)",
  released && waited <= 10,
  `${waited}s`
);
await ctx2.close();

await browser.close();

console.log(
  failures === 0
    ? "\n✅ l'accueil part de la position actuelle"
    : `\n❌ ${failures} cas KO`
);
process.exit(failures === 0 ? 0 : 1);
