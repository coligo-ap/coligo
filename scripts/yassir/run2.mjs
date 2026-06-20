import { CDP, findYassirPage } from "./cdp.mjs";
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
} from "node:fs";

const geo = JSON.parse(readFileSync("scripts/yassir/geo-cache.json", "utf8"));
const keys = Object.keys(geo);
const byCat = (c) => keys.filter((k) => geo[k].cat === c);
const CENTRE = byCat("centre"),
  ALENT = byCat("alentours"),
  LONG = byCat("long");

// même générateur déterministe que run-yassir.mjs → mêmes 100 paires
let seed = 42;
const rnd = () =>
  (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const pairs = [];
const seen = new Set();
const add = (a, b) => {
  if (a !== b && !seen.has(a + ">" + b)) {
    seen.add(a + ">" + b);
    pairs.push([a, b]);
  }
};
let g = 0;
while (
  pairs.filter((p) => geo[p[0]].cat === "centre" && geo[p[1]].cat === "centre")
    .length < 34 &&
  g++ < 2000
)
  add(pick(CENTRE), pick(CENTRE));
g = 0;
while (
  pairs.filter(
    (p) =>
      (geo[p[0]].cat === "centre" && geo[p[1]].cat === "alentours") ||
      (geo[p[0]].cat === "alentours" && geo[p[1]].cat === "centre")
  ).length < 34 &&
  g++ < 2000
) {
  if (rnd() < 0.5) add(pick(CENTRE), pick(ALENT));
  else add(pick(ALENT), pick(CENTRE));
}
g = 0;
while (
  pairs.filter((p) => geo[p[0]].cat === "long" || geo[p[1]].cat === "long")
    .length < 32 &&
  g++ < 3000
) {
  const r = rnd();
  if (r < 0.4) add(pick(CENTRE), pick(LONG));
  else if (r < 0.7) add(pick(LONG), pick(CENTRE));
  else if (r < 0.85) add(pick(ALENT), pick(LONG));
  else add(pick(LONG), pick(ALENT));
}

// résultats existants → map (garde les ok)
const map = new Map();
if (existsSync("scripts/yassir/results.json")) {
  for (const r of JSON.parse(
    readFileSync("scripts/yassir/results.json", "utf8")
  ))
    map.set(r.from + ">" + r.to, r);
}
// todo = paires pas encore ok ; ordre : longs d'abord, puis alentours, puis centre
const catRank = (p) =>
  geo[p[0]].cat === "long" || geo[p[1]].cat === "long"
    ? 0
    : geo[p[0]].cat === "alentours" || geo[p[1]].cat === "alentours"
      ? 1
      : 2;
const todo = pairs
  .filter(([a, b]) => !map.get(a + ">" + b)?.ok)
  .sort((x, y) => catRank(x) - catRank(y));
console.log(
  "paires:",
  pairs.length,
  "déjà ok:",
  [...map.values()].filter((r) => r.ok).length,
  "à faire:",
  todo.length
);

async function osrm(a, b) {
  const u = `http://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`;
  const j = await (await fetch(u)).json();
  if (j.code !== "Ok") throw new Error("osrm " + j.code);
  return { km: j.routes[0].distance / 1000, min: j.routes[0].duration / 60 };
}
const enc = (lat, lng) => `${lat}%2C${lng}`;
const buildUrl = (a, b) =>
  "https://mobility-app.yassir.com/fr?%2F%3Fpickup=" +
  enc(a.lat, a.lng) +
  "&pickup=" +
  enc(a.lat, a.lng) +
  "&pickupPlaceid=" +
  a.place_id +
  "&destination=" +
  enc(b.lat, b.lng) +
  "&destinationPlaceid=" +
  b.place_id;
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
const innerText = async () =>
  (
    await cdp.send("Runtime.evaluate", {
      expression: "document.body.innerText",
      returnByValue: true,
    })
  ).result.value || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOG = "scripts/yassir/progress2.log";
appendFileSync(
  LOG,
  `\nSTART2 ${new Date().toISOString()} — todo ${todo.length}\n`
);

async function fetchRoute(a, b) {
  await cdp.send("Page.navigate", { url: buildUrl(a, b) });
  let text = "",
    prices = {};
  for (let w = 0; w < 11; w++) {
    await sleep(2600);
    text = await innerText();
    if (/captcha|robot|vérifiez que vous/i.test(text))
      return { prices: {}, captcha: true };
    prices = parsePrices(text);
    if (Object.keys(prices).length) break;
  }
  return { prices, captcha: false };
}
async function recover() {
  await cdp.send("Page.navigate", {
    url: "https://mobility-app.yassir.com/fr",
  });
  await sleep(7000);
}

let consec = 0,
  cooldowns = 0,
  doneNew = 0;
for (let i = 0; i < todo.length; i++) {
  const [ak, bk] = todo[i];
  const a = geo[ak],
    b = geo[bk];
  const rec = { i, from: ak, to: bk, cat_from: a.cat, cat_to: b.cat };
  try {
    rec.osrm = await osrm(a, b);
  } catch {
    rec.osrm = null;
  }
  let { prices, captcha } = await fetchRoute(a, b);
  if (!Object.keys(prices).length && !captcha) {
    await recover();
    ({ prices, captcha } = await fetchRoute(a, b));
  } // 1 retry après reload
  rec.yassir = prices;
  rec.ok = Object.keys(prices).length > 0;
  if (captcha) rec.captcha = true;
  map.set(ak + ">" + bk, rec);
  writeFileSync(
    "scripts/yassir/results.json",
    JSON.stringify([...map.values()], null, 2)
  );
  const y = rec.ok
    ? `Classique ${prices.Classique?.low}-${prices.Classique?.high}`
    : captcha
      ? "CAPTCHA"
      : "—";
  const line = `${String(i + 1).padStart(3)}/${todo.length} ${ak}→${bk} ${rec.osrm ? rec.osrm.km.toFixed(1) + "km" : "?"} ${y}`;
  console.log(line);
  appendFileSync(LOG, line + "\n");
  if (captcha) {
    appendFileSync(LOG, "STOP captcha\n");
    break;
  }
  if (rec.ok) {
    consec = 0;
    doneNew++;
    await sleep(3500 + rnd() * 3000);
  } else {
    consec++;
    if (consec >= 4) {
      cooldowns++;
      appendFileSync(LOG, `COOLDOWN ${cooldowns} (45s)\n`);
      await recover();
      await sleep(45000);
      consec = 0;
      if (cooldowns >= 4) {
        appendFileSync(LOG, "ABORT cooldowns\n");
        break;
      }
    } else await sleep(6000);
  }
}
const ok = [...map.values()].filter((r) => r.ok).length;
appendFileSync(
  LOG,
  `DONE2 ${new Date().toISOString()} — nouveaux ${doneNew}, total ok ${ok}\n`
);
console.log("FINI2. nouveaux:", doneNew, "total ok:", ok);
cdp.close();
process.exit(0);
