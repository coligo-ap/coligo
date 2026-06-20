import { CDP, findYassirPage } from "./cdp.mjs";
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
} from "node:fs";
const geo = JSON.parse(readFileSync("scripts/yassir/geo-cache3.json", "utf8"));
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
const LOG = "scripts/yassir/freq.log";

// Trajets les + fréquents (interleavés par ville) : centre↔aéroport / université / nouvelle ville / hops urbains
const PAIRS = [
  ["oran_centre", "oran_aeroport"],
  ["cst_centre", "cst_ali_mendjeli"],
  ["anb_centre", "anb_univ"],
  ["stf_centre", "stf_univ"],
  ["bld_centre", "bld_univ"],
  ["btn_centre", "btn_univ"],
  ["tlm_centre", "tlm_univ"],
  ["tizi_ouzou", "tizi_univ"],
  ["oran_centre", "oran_univ"],
  ["cst_centre", "cst_univ"],
  ["anb_centre", "anb_aeroport"],
  ["stf_centre", "stf_el_eulma"],
  ["bld_centre", "bld_boufarik"],
  ["tlm_centre", "tlm_mansourah"],
  ["tizi_nv", "tizi_ouzou"],
  ["oran_centre", "oran_bir_djir"],
  ["cst_centre", "cst_aeroport"],
  ["oran_usto", "oran_centre"],
  ["cst_ali_mendjeli", "cst_univ"],
  ["stf_univ", "stf_centre"],
  ["oran_centre", "oran_usto"],
  ["anb_univ", "anb_centre"],
  ["cst_ali_mendjeli", "cst_centre"],
  ["tlm_univ", "tlm_centre"],
  ["bld_univ", "bld_centre"],
  ["btn_univ", "btn_centre"],
  ["oran_bir_djir", "oran_aeroport"],
  ["stf_el_eulma", "stf_centre"],
];

async function osrm(a, b) {
  try {
    const u = `http://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`;
    const j = await (await fetch(u)).json();
    if (j.code !== "Ok") return null;
    return { km: j.routes[0].distance / 1000, min: j.routes[0].duration / 60 };
  } catch {
    return null;
  }
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
const probe = async () =>
  JSON.parse(
    (
      await cdp.send("Runtime.evaluate", {
        expression: `(() => { const inps=[...document.querySelectorAll('input')].map(i=>i.value).filter(Boolean); const txt=document.body.innerText; return JSON.stringify({inps, txt}); })()`,
        returnByValue: true,
      })
    ).result.value
  );
const map = new Map();
if (existsSync("scripts/yassir/results.json"))
  for (const r of JSON.parse(
    readFileSync("scripts/yassir/results.json", "utf8")
  ))
    map.set(r.from + ">" + r.to, r);
appendFileSync(
  LOG,
  `\nFREQ ${new Date().toISOString()} — ${PAIRS.length} paires\n`
);
async function fetchOne(a, b) {
  await cdp.send("Page.navigate", { url: buildUrl(a, b) });
  let p = {},
    st = { inps: [], txt: "" };
  for (let w = 0; w < 12; w++) {
    await sleep(2400);
    st = await probe();
    p = parsePrices(st.txt);
    if (Object.keys(p).length) break;
  }
  const filled = st.inps.filter(Boolean);
  const throttled =
    !Object.keys(p).length &&
    (filled.length < 2 || filled.some((v) => /undefined/.test(v)));
  return { p, throttled };
}

let consec = 0,
  cooldowns = 0,
  got = 0;
for (let i = 0; i < PAIRS.length; i++) {
  const [ak, bk] = PAIRS[i];
  const a = geo[ak],
    b = geo[bk];
  if (!a || !b) {
    appendFileSync(LOG, `skip ${ak}>${bk}\n`);
    continue;
  }
  if (map.get(ak + ">" + bk)?.ok) continue;
  const rec = {
    i,
    from: ak,
    to: bk,
    pair_cat: "frequent",
    region_from: a.region,
    region_to: b.region,
  };
  rec.osrm = await osrm(a, b);
  let { p, throttled } = await fetchOne(a, b);
  if (throttled) {
    await cdp.send("Page.navigate", {
      url: "https://mobility-app.yassir.com/fr",
    });
    await sleep(8000);
    ({ p, throttled } = await fetchOne(a, b));
  }
  rec.yassir = p;
  rec.ok = Object.keys(p).length > 0;
  if (!rec.ok && !throttled) rec.note = "no_service";
  map.set(ak + ">" + bk, rec);
  writeFileSync(
    "scripts/yassir/results.json",
    JSON.stringify([...map.values()], null, 2)
  );
  const line = `${String(i + 1).padStart(2)}/${PAIRS.length} [${a.region}] ${ak}→${bk} ${rec.osrm ? rec.osrm.km.toFixed(0) + "km" : "?"} ${rec.ok ? "C " + p.Classique?.low + "-" + p.Classique?.high : throttled ? "THROTTLE" : "NO_SERVICE"}`;
  console.log(line);
  appendFileSync(LOG, line + "\n");
  if (rec.ok) {
    got++;
    consec = 0;
    await sleep(9000 + Math.random() * 4000);
  } else if (rec.note === "no_service") {
    await sleep(4000);
  } else {
    consec++;
    if (consec >= 3) {
      cooldowns++;
      appendFileSync(LOG, `COOLDOWN ${cooldowns}\n`);
      await cdp.send("Page.navigate", {
        url: "https://mobility-app.yassir.com/fr",
      });
      await sleep(360000);
      consec = 0;
      if (cooldowns >= 2) {
        appendFileSync(LOG, "NEED_RELOGIN\n");
        break;
      }
    } else await sleep(15000);
  }
}
appendFileSync(LOG, `done got ${got}\n`);
console.log("FREQ done got", got);
cdp.close();
process.exit(0);
