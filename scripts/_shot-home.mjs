// Captures de l'accueil client : light/dark × FR/AR × 390px/360px.
// Usage : node shot-home.mjs <suffixe>   (ex. "avant" / "apres")
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const TAG = process.argv[2] ?? "shot";
const OUT = process.env.OUT ?? "./shots";
mkdirSync(OUT, { recursive: true });

// Alger — pour que la liste de commerces soit peuplée (position mémorisée par
// le store client + cookie miroir lu par le SSR pour les bannières).
const LOC = {
  latitude: 36.7538,
  longitude: 3.0588,
  wilaya_code: "16",
  commune: "Alger Centre",
  address: "Alger Centre",
};

const CASES = [
  { name: "fr-light", theme: "light", locale: "fr", width: 390 },
  { name: "fr-dark", theme: "dark", locale: "fr", width: 390 },
  { name: "ar-light", theme: "light", locale: "ar", width: 390 },
  { name: "fr-light-360", theme: "light", locale: "fr", width: 360 },
];

const b = await chromium.launch({ headless: true });
for (const c of CASES) {
  const ctx = await b.newContext({
    viewport: { width: c.width, height: 844 },
    deviceScaleFactor: 2,
    locale: c.locale === "ar" ? "ar-DZ" : "fr-DZ",
  });
  const cookies = [{ name: "NEXT_LOCALE", value: c.locale, url: BASE }];
  if (c.theme === "dark")
    cookies.push({ name: "coligo_theme", value: "dark", url: BASE });
  cookies.push({
    // Contrat de lib/customer/location-cookie.ts (clés courtes).
    name: "coligo_loc",
    value: encodeURIComponent(
      JSON.stringify({
        la: LOC.latitude,
        lo: LOC.longitude,
        w: LOC.wilaya_code,
        c: LOC.commune,
      })
    ),
    url: BASE,
  });
  await ctx.addCookies(cookies);
  await ctx.addInitScript(
    ([loc]) => {
      try {
        localStorage.setItem("coligo:customer:location", JSON.stringify(loc));
      } catch {}
    },
    [LOC]
  );
  const p = await ctx.newPage();
  await p
    .goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 120000 })
    .catch((e) => console.log("goto", e.message.split("\n")[0]));
  await p.waitForTimeout(9000);
  // 1) premier écran (le point du brief : voit-on un commerce sans défiler ?)
  await p
    .screenshot({ path: `${OUT}/${TAG}-${c.name}-fold.png`, timeout: 30000 })
    .catch((e) => console.log("shot", e.message.split("\n")[0]));
  // 2) page entière (hiérarchie + respiration)
  await p
    .screenshot({
      path: `${OUT}/${TAG}-${c.name}-full.png`,
      fullPage: true,
      timeout: 30000,
    })
    .catch((e) => console.log("shotfull", e.message.split("\n")[0]));
  console.log("ok", TAG, c.name);
  await ctx.close();
}
await b.close();
