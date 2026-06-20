import { CDP, findYassirPage } from "./cdp.mjs";
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
} from "node:fs";
const geo = JSON.parse(readFileSync("scripts/yassir/geo-cache.json", "utf8"));
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOG = "scripts/yassir/slow.log";

// cible : moyens + longs, variés en distance
const targets = [
  ["centre", "tichy"],
  ["aamriw", "oued_ghir"],
  ["centre", "boukhelifa"],
  ["gare", "tala_hamza"],
  ["centre", "amizour"],
  ["aeroport", "el_kseur"],
  ["centre", "aokas"],
  ["brise_mer", "tichy"],
  ["centre", "souk_tenine"],
  ["centre", "sidi_aich"],
  ["gare", "el_kseur"],
  ["centre", "seddouk"],
  ["centre", "kherrata"],
  ["aeroport", "tichy"],
  ["centre", "akbou"],
  ["centre", "tazmalt"],
  ["tichy", "aokas"],
  ["el_kseur", "amizour"],
  ["port", "tichy"],
  ["universite", "oued_ghir"],
  ["centre", "tala_hamza"],
  ["centre", "oued_ghir"],
  ["gare", "aokas"],
  ["aamriw", "tichy"],
];

async function osrm(a, b) {
  const u = `http://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`;
  const j = await (await fetch(u)).json();
  if (j.code !== "Ok") throw new Error("osrm");
  return { km: j.routes[0].distance / 1000, min: j.routes[0].duration / 60 };
}
function parsePrices(text) {
  const out = {};
  const re =
    /(Classique|Confort|Économique|Eco|Moto|Van|Standard|Premium|Intercity|Interville|XL)\s*\n\s*(\d[\d\s]*)\s*DZD(?:\s*\n\s*(\d[\d\s]*)\s*DZD)?/g;
  let m;
  while ((m = re.exec(text))) {
    const lo = +m[2].replace(/\s/g, "");
    const hi = m[3] ? +m[3].replace(/\s/g, "") : lo;
    out[m[1]] = { low: Math.min(lo, hi), high: Math.max(lo, hi) };
  }
  return out;
}

appendFileSync(
  LOG,
  `\nSLOW start ${new Date().toISOString()} — cooldown 600s\n`
);
await sleep(600000); // 10 min

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

const map = new Map();
if (existsSync("scripts/yassir/results.json"))
  for (const r of JSON.parse(
    readFileSync("scripts/yassir/results.json", "utf8")
  ))
    map.set(r.from + ">" + r.to, r);

async function fetchOnce(a, b) {
  await cdp.send("Page.navigate", { url: buildUrl(a, b) });
  let prices = {};
  for (let w = 0; w < 12; w++) {
    await sleep(2500);
    const txt = await innerText();
    prices = parsePrices(txt);
    if (Object.keys(prices).length) break;
  }
  return prices;
}

let consec = 0,
  got = 0;
for (let i = 0; i < targets.length; i++) {
  const [ak, bk] = targets[i];
  const a = geo[ak],
    b = geo[bk];
  if (map.get(ak + ">" + bk)?.ok) continue;
  const rec = { i, from: ak, to: bk, cat_from: a.cat, cat_to: b.cat };
  try {
    rec.osrm = await osrm(a, b);
  } catch {
    rec.osrm = null;
  }
  let prices = await fetchOnce(a, b);
  if (!Object.keys(prices).length) {
    await cdp.send("Page.navigate", {
      url: "https://mobility-app.yassir.com/fr",
    });
    await sleep(8000);
    prices = await fetchOnce(a, b);
  }
  rec.yassir = prices;
  rec.ok = Object.keys(prices).length > 0;
  map.set(ak + ">" + bk, rec);
  writeFileSync(
    "scripts/yassir/results.json",
    JSON.stringify([...map.values()], null, 2)
  );
  const line = `${i + 1}/${targets.length} ${ak}→${bk} ${rec.osrm ? rec.osrm.km.toFixed(1) + "km" : "?"} ${rec.ok ? "Classique " + prices.Classique?.low + "-" + prices.Classique?.high : "—"}`;
  console.log(line);
  appendFileSync(LOG, line + "\n");
  if (rec.ok) {
    got++;
    consec = 0;
    await sleep(20000 + Math.random() * 8000);
  } else {
    consec++;
    if (consec >= 5) {
      appendFileSync(LOG, "long cooldown 300s\n");
      await cdp.send("Page.navigate", {
        url: "https://mobility-app.yassir.com/fr",
      });
      await sleep(300000);
      consec = 0;
    } else await sleep(25000);
  }
}
appendFileSync(LOG, `SLOW done ${new Date().toISOString()} got ${got}\n`);
console.log("SLOW done got", got);
cdp.close();
process.exit(0);
