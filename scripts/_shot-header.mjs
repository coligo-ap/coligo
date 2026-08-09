// Captures + géométrie du header client — cas limites (adresse longue, 320px,
// desktop, RTL, mode sombre). Usage : node scripts/_shot-header.mjs
//
// La mesure vérifie l'INVARIANT du header : le bouton de zone est CENTRÉ sur
// la barre (écart au centre ≤ 2 px) et rien ne déborde horizontalement.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3010";
const OUT = process.env.OUT ?? "./shots";
mkdirSync(OUT, { recursive: true });

const base = {
  latitude: 36.7538,
  longitude: 3.0588,
  wilaya_code: "16",
  commune: "Alger Centre",
};
const LONG = "Cité des 1200 Logements, Bâtiment C3, Bab Ezzouar";

const CASES = [
  { name: "320-court", width: 320, loc: { ...base, address: "" } },
  { name: "320-long", width: 320, loc: { ...base, address: LONG } },
  { name: "360-long", width: 360, loc: { ...base, address: LONG } },
  { name: "390-moyen", width: 390, loc: { ...base, address: "" } },
  { name: "390-vide", width: 390, loc: null },
  {
    name: "390-dark",
    width: 390,
    loc: { ...base, address: LONG },
    theme: "dark",
  },
  { name: "390-ar", width: 390, loc: { ...base, address: LONG }, locale: "ar" },
  { name: "desktop-long", width: 1440, loc: { ...base, address: LONG } },
  { name: "desktop-court", width: 1440, loc: { ...base, address: "" } },
  { name: "desktop-1280", width: 1280, loc: { ...base, address: LONG } },
  {
    name: "desktop-ar",
    width: 1440,
    loc: { ...base, address: LONG },
    locale: "ar",
  },
];

const b = await chromium.launch({ headless: true });
let bad = 0;
for (const c of CASES) {
  const ctx = await b.newContext({
    viewport: { width: c.width, height: 800 },
    deviceScaleFactor: 2,
    locale: c.locale === "ar" ? "ar-DZ" : "fr-DZ",
  });
  const cookies = [
    { name: "NEXT_LOCALE", value: c.locale ?? "fr", url: BASE },
    { name: "coligo_theme", value: c.theme ?? "light", url: BASE },
  ];
  if (c.loc) {
    cookies.push({
      name: "coligo_loc",
      value: encodeURIComponent(
        JSON.stringify({
          la: base.latitude,
          lo: base.longitude,
          w: base.wilaya_code,
          c: base.commune,
        })
      ),
      url: BASE,
    });
  }
  await ctx.addCookies(cookies);
  await ctx.addInitScript(
    ([loc]) => {
      try {
        if (loc)
          localStorage.setItem("coligo:customer:location", JSON.stringify(loc));
        else localStorage.removeItem("coligo:customer:location");
      } catch {}
    },
    [c.loc]
  );
  const p = await ctx.newPage();
  await p.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 120000 });
  await p.waitForTimeout(6000);

  const header = p.locator("header").first();
  await header.screenshot({ path: `${OUT}/hdr-${c.name}.png` });

  // Géométrie : le bouton de zone VISIBLE est-il centré, et rien ne déborde ?
  const geo = await p.evaluate(() => {
    const h = document.querySelector("header");
    if (!h) return null;
    const visible = (el) => el.getBoundingClientRect().width > 0;
    // Le tiroir de navigation porte lui aussi `aria-haspopup="dialog"` : on
    // prend le PLUS LARGE des deux, c'est toujours le bouton de zone.
    const zone = [...h.querySelectorAll('button[aria-haspopup="dialog"]')]
      .filter(visible)
      .sort(
        (a, b) =>
          b.getBoundingClientRect().width - a.getBoundingClientRect().width
      )[0];
    if (!zone) return { error: "zone introuvable" };
    const zr = zone.getBoundingClientRect();
    const hr = h.getBoundingClientRect();
    // Le bloc de zone déborde-t-il sur un voisin (logo / actions) ?
    const others = [...h.querySelectorAll("a,button")]
      .filter((el) => el !== zone && !zone.contains(el) && visible(el))
      .map((el) => el.getBoundingClientRect());
    const overlap = others.some(
      (r) => r.left < zr.right - 0.5 && r.right > zr.left + 0.5
    );
    return {
      h: Math.round(hr.height),
      zone: { l: Math.round(zr.left), r: Math.round(zr.right) },
      offCenter: Math.round((zr.left + zr.right) / 2 - hr.width / 2),
      overlap,
      overflowX:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    };
  });
  const ok =
    geo &&
    !geo.error &&
    Math.abs(geo.offCenter) <= 2 &&
    !geo.overlap &&
    !geo.overflowX;
  if (!ok) bad++;
  console.log(ok ? "OK  " : "KO  ", c.name.padEnd(14), JSON.stringify(geo));
  await ctx.close();
}
await b.close();
console.log(bad === 0 ? "\n✅ header centré partout" : `\n❌ ${bad} cas KO`);
process.exit(bad === 0 ? 0 : 1);
