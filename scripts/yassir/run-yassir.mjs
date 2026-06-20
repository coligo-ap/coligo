import { CDP, findYassirPage } from "./cdp.mjs";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

const geo = JSON.parse(readFileSync("scripts/yassir/geo-cache.json", "utf8"));
const keys = Object.keys(geo);
const byCat = (c) => keys.filter((k) => geo[k].cat === c);
const CENTRE = byCat("centre");
const ALENT = byCat("alentours");
const LONG = byCat("long");

// PRNG déterministe (reproductible)
let seed = 42;
const rnd = () =>
  (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const pairKey = (a, b) => `${a}>${b}`;

// Génère ~100 paires équilibrées et uniques
const pairs = [];
const seen = new Set();
const addPair = (a, b) => {
  if (a === b) return;
  const k = pairKey(a, b);
  if (seen.has(k)) return;
  seen.add(k);
  pairs.push([a, b]);
};
// 1) intra-centre (courts) ~34
let guard = 0;
while (
  pairs.filter((p) => geo[p[0]].cat === "centre" && geo[p[1]].cat === "centre")
    .length < 34 &&
  guard++ < 2000
)
  addPair(pick(CENTRE), pick(CENTRE));
// 2) centre <-> alentours ~34
guard = 0;
while (
  pairs.filter(
    (p) =>
      (geo[p[0]].cat === "centre" && geo[p[1]].cat === "alentours") ||
      (geo[p[0]].cat === "alentours" && geo[p[1]].cat === "centre")
  ).length < 34 &&
  guard++ < 2000
) {
  if (rnd() < 0.5) addPair(pick(CENTRE), pick(ALENT));
  else addPair(pick(ALENT), pick(CENTRE));
}
// 3) centre/alentours <-> longs ~32
guard = 0;
while (
  pairs.filter((p) => geo[p[0]].cat === "long" || geo[p[1]].cat === "long")
    .length < 32 &&
  guard++ < 3000
) {
  const r = rnd();
  if (r < 0.4) addPair(pick(CENTRE), pick(LONG));
  else if (r < 0.7) addPair(pick(LONG), pick(CENTRE));
  else if (r < 0.85) addPair(pick(ALENT), pick(LONG));
  else addPair(pick(LONG), pick(ALENT));
}
console.log("paires générées:", pairs.length);

// OSRM distance/durée (route réelle)
async function osrm(a, b) {
  const url = `http://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`;
  const r = await fetch(url);
  const j = await r.json();
  if (j.code !== "Ok") throw new Error("osrm " + j.code);
  const rt = j.routes[0];
  return { km: rt.distance / 1000, min: rt.duration / 60 };
}

function buildUrl(a, b) {
  const enc = (lat, lng) => `${lat}%2C${lng}`;
  return (
    "https://mobility-app.yassir.com/fr?%2F%3Fpickup=" +
    enc(a.lat, a.lng) +
    "&pickup=" +
    enc(a.lat, a.lng) +
    "&pickupPlaceid=" +
    a.place_id +
    "&destination=" +
    enc(b.lat, b.lng) +
    "&destinationPlaceid=" +
    b.place_id
  );
}

function parsePrices(text) {
  const out = {};
  const re =
    /(Classique|Confort|Économique|Eco|Moto|Van|Standard|Premium|Intercity|Interville|XL)\s*\n\s*(\d[\d\s]*)\s*DZD(?:\s*\n\s*(\d[\d\s]*)\s*DZD)?/g;
  let m;
  while ((m = re.exec(text))) {
    const lo = parseInt(m[2].replace(/\s/g, ""), 10);
    const hi = m[3] ? parseInt(m[3].replace(/\s/g, ""), 10) : lo;
    out[m[1]] = { low: Math.min(lo, hi), high: Math.max(lo, hi) };
  }
  return out;
}

const t = await findYassirPage();
const cdp = await CDP.attach(t.webSocketDebuggerUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");

async function innerText() {
  const r = await cdp.send("Runtime.evaluate", {
    expression: "document.body.innerText",
    returnByValue: true,
  });
  return r.result.value || "";
}

const results = [];
const LOG = "scripts/yassir/progress.log";
writeFileSync(
  LOG,
  `START ${new Date().toISOString()} — ${pairs.length} routes\n`
);
let consecFail = 0;

for (let i = 0; i < pairs.length; i++) {
  const [ak, bk] = pairs[i];
  const a = geo[ak],
    b = geo[bk];
  const rec = { i, from: ak, to: bk, cat_from: a.cat, cat_to: b.cat };
  try {
    rec.osrm = await osrm(a, b);
  } catch (e) {
    rec.osrm = null;
    rec.osrm_err = e.message;
  }

  try {
    await cdp.send("Page.navigate", { url: buildUrl(a, b) });
    let text = "",
      prices = {};
    for (let w = 0; w < 9; w++) {
      await new Promise((r) => setTimeout(r, 2500));
      text = await innerText();
      if (/captcha|robot|vérifiez que vous/i.test(text)) {
        rec.captcha = true;
        break;
      }
      prices = parsePrices(text);
      if (Object.keys(prices).length > 0) break;
    }
    rec.yassir = prices;
    rec.ok = Object.keys(prices).length > 0;
    if (
      !rec.ok &&
      /Aucun|indisponible|not available|no service|hors zone|range/i.test(text)
    )
      rec.note = "no_service";
  } catch (e) {
    rec.ok = false;
    rec.err = e.message;
  }

  results.push(rec);
  const yStr =
    rec.yassir && rec.yassir.Classique
      ? `Classique ${rec.yassir.Classique.low}-${rec.yassir.Classique.high}`
      : rec.captcha
        ? "CAPTCHA"
        : rec.note || "—";
  const line = `${String(i + 1).padStart(3)}/${pairs.length}  ${ak}→${bk}  ${rec.osrm ? rec.osrm.km.toFixed(1) + "km/" + rec.osrm.min.toFixed(0) + "min" : "no-osrm"}  ${yStr}`;
  console.log(line);
  appendFileSync(LOG, line + "\n");
  writeFileSync(
    "scripts/yassir/results.json",
    JSON.stringify(results, null, 2)
  );

  consecFail = rec.ok ? 0 : consecFail + 1;
  if (rec.captcha || consecFail >= 8) {
    appendFileSync(
      LOG,
      `ABORT consecFail=${consecFail} captcha=${!!rec.captcha}\n`
    );
    break;
  }
  await new Promise((r) => setTimeout(r, 1200 + rnd() * 1500));
}

appendFileSync(
  LOG,
  `DONE ${new Date().toISOString()} — ok=${results.filter((r) => r.ok).length}/${results.length}\n`
);
console.log(
  "FINI. ok =",
  results.filter((r) => r.ok).length,
  "/",
  results.length
);
cdp.close();
process.exit(0);
