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
const LOG = "scripts/yassir/collect.log";

// moyens + longs, variés (8–70 km)
const targets = [
  ["centre", "tichy"],
  ["centre", "oued_ghir"],
  ["aamriw", "oued_ghir"],
  ["universite", "oued_ghir"],
  ["centre", "boukhelifa"],
  ["gare", "tala_hamza"],
  ["brise_mer", "tichy"],
  ["port", "tichy"],
  ["aeroport", "tichy"],
  ["aamriw", "tichy"],
  ["gare", "el_kseur"],
  ["centre", "el_kseur"],
  ["aeroport", "el_kseur"],
  ["centre", "amizour"],
  ["centre", "aokas"],
  ["tichy", "aokas"],
  ["gare", "aokas"],
  ["centre", "souk_tenine"],
  ["centre", "sidi_aich"],
  ["el_kseur", "amizour"],
  ["centre", "kherrata"],
  ["centre", "seddouk"],
  ["centre", "tazmalt"],
  ["centre", "akbou"],
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
appendFileSync(LOG, `\nCOLLECT ${new Date().toISOString()}\n`);

async function fetchOnce(a, b) {
  await cdp.send("Page.navigate", { url: buildUrl(a, b) });
  let p = {};
  for (let w = 0; w < 11; w++) {
    await sleep(2400);
    p = parsePrices(await innerText());
    if (Object.keys(p).length) break;
  }
  return p;
}

let consec = 0,
  got = 0;
for (let i = 0; i < targets.length; i++) {
  const [ak, bk] = targets[i];
  const a = geo[ak],
    b = geo[bk];
  if (map.get(ak + ">" + bk)?.ok) {
    continue;
  }
  const rec = { i, from: ak, to: bk, cat_from: a.cat, cat_to: b.cat };
  try {
    rec.osrm = await osrm(a, b);
  } catch {
    rec.osrm = null;
  }
  let p = await fetchOnce(a, b);
  if (!Object.keys(p).length) {
    await cdp.send("Page.navigate", {
      url: "https://mobility-app.yassir.com/fr",
    });
    await sleep(7000);
    p = await fetchOnce(a, b);
  }
  rec.yassir = p;
  rec.ok = Object.keys(p).length > 0;
  map.set(ak + ">" + bk, rec);
  writeFileSync(
    "scripts/yassir/results.json",
    JSON.stringify([...map.values()], null, 2)
  );
  const line = `${i + 1}/${targets.length} ${ak}→${bk} ${rec.osrm ? rec.osrm.km.toFixed(1) + "km" : "?"} ${rec.ok ? "C " + p.Classique?.low + "-" + p.Classique?.high + (p.Confort ? " / Cf " + p.Confort.low + "-" + p.Confort.high : "") : "—"}`;
  console.log(line);
  appendFileSync(LOG, line + "\n");
  if (rec.ok) {
    got++;
    consec = 0;
    await sleep(9000 + Math.random() * 4000);
  } else {
    consec++;
    if (consec >= 3) {
      appendFileSync(LOG, "STOP throttle\n");
      break;
    }
    await sleep(12000);
  }
}
appendFileSync(LOG, `done got ${got}\n`);
console.log("COLLECT done got", got);
cdp.close();
process.exit(0);
