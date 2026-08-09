// Captures d'états : feuille de filtres, liste Promos (cartes compactes), fiche.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const TAG = process.argv[2] ?? "shot";
const OUT = process.env.OUT ?? "./shots";
const SLUG = process.env.SLUG ?? "";
mkdirSync(OUT, { recursive: true });

const LOC = {
  latitude: 36.7538,
  longitude: 3.0588,
  wilaya_code: "16",
  commune: "Alger Centre",
  address: "Alger Centre",
};

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: "fr-DZ",
});
await ctx.addCookies([
  { name: "NEXT_LOCALE", value: "fr", url: BASE },
  {
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
  },
]);
await ctx.addInitScript(
  ([loc]) => {
    try {
      localStorage.setItem("coligo:customer:location", JSON.stringify(loc));
    } catch {}
  },
  [LOC]
);
const p = await ctx.newPage();

// 1) Feuille de filtres ouverte (bouton dans la ligne de recherche).
await p.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 120000 });
await p.waitForTimeout(8000);
const btn = p.getByRole("button", { name: "Filtres" });
if (await btn.count()) {
  await btn.first().click();
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/${TAG}-filtres.png`, timeout: 30000 });
  console.log("ok filtres");
  await p.keyboard.press("Escape");
} else {
  console.log("skip filtres (bouton absent — pilules ?)");
  await p.screenshot({ path: `${OUT}/${TAG}-filtres.png`, timeout: 30000 });
}

// 2) Liste Promos → cartes COMPACTES.
await p.goto(BASE + "/?promo=1", {
  waitUntil: "domcontentloaded",
  timeout: 120000,
});
await p.waitForTimeout(8000);
await p.screenshot({ path: `${OUT}/${TAG}-promos.png`, timeout: 30000 });
console.log("ok promos");

// 3) Fiche commerce — les infos déplacées doivent y être.
if (SLUG) {
  await p.goto(BASE + "/m/" + SLUG, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await p.waitForTimeout(8000);
  await p.screenshot({
    path: `${OUT}/${TAG}-fiche.png`,
    fullPage: false,
    timeout: 30000,
  });
  console.log("ok fiche");
}

await ctx.close();
await b.close();
