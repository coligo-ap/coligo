import { CDP, findYassirPage } from "./cdp.mjs";
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
} from "node:fs";
const geo = JSON.parse(readFileSync("scripts/yassir/geo-cache2.json", "utf8"));
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
const LOG = "scripts/yassir/collect3.log";

// Paires typées (interleavées pour couvrir toutes les catégories tôt)
const PAIRS = [
  // commune Béjaïa -> grande ville Béjaïa
  ["akbou", "centre", "bj_commune_ville"],
  ["br_chorfa", "tazmalt", "frontiere"],
  ["alg_centre", "alg_bab_ezzouar", "alger"],
  ["centre", "tizi_ouzou", "interwilaya"],
  ["tazmalt", "centre", "bj_commune_ville"],
  ["br_mchedallah", "akbou", "frontiere"],
  ["alg_centre", "alg_aeroport", "alger"],
  ["centre", "alg_centre", "interwilaya"],
  ["sidi_aich", "centre", "bj_commune_ville"],
  ["br_chorfa", "akbou", "frontiere"],
  ["alg_centre", "alg_zeralda", "alger"],
  ["centre", "bouira_ville", "interwilaya"],
  ["kherrata", "centre", "bj_commune_ville"],
  ["bouira_ville", "tazmalt", "frontiere"],
  ["alg_centre", "alg_bab_el_oued", "alger"],
  ["akbou", "bouira_ville", "interwilaya"],
  ["aokas", "centre", "bj_commune_ville"],
  ["br_mchedallah", "tazmalt", "frontiere"],
  ["alg_kouba", "alg_el_harrach", "alger"],
  ["sidi_aich", "tizi_ouzou", "interwilaya"],
  ["el_kseur", "centre", "bj_commune_ville"],
  ["alg_centre", "alg_rouiba", "alger"],
  ["alg_hydra", "alg_bmr", "alger"],
  ["amizour", "centre", "bj_commune_ville"],
  ["alg_centre", "alg_kouba", "alger"],
  ["alg_draria", "alg_reghaia", "alger"],
  ["bj_barbacha", "centre", "bj_commune_ville"],
  ["alg_centre", "alg_cheraga", "alger"],
  ["alg_cheraga", "alg_baraki", "alger"],
  ["bj_darguina", "centre", "bj_commune_ville"],
  ["alg_centre", "alg_hydra", "alger"],
  ["alg_el_harrach", "alg_hussein_dey", "alger"],
  ["bj_timezrit", "centre", "bj_commune_ville"],
  ["alg_centre", "alg_draria", "alger"],
  ["alg_ain_benian", "alg_baraki", "alger"],
  ["bj_melbou", "centre", "bj_commune_ville"],
  ["bj_ouzellaguen", "centre", "bj_commune_ville"],
  ["alg_centre", "alg_bmr", "alger"],
  // --- extras lot 2 (intra-Alger varié + inter-wilaya + asymétrie sens inverse) ---
  ["alg_bab_ezzouar", "alg_aeroport", "alger"],
  ["alg_draria", "alg_zeralda", "alger"],
  ["alg_kouba", "alg_bab_el_oued", "alger"],
  ["alg_hydra", "alg_cheraga", "alger"],
  ["alg_centre", "alg_baraki", "alger"],
  ["tizi_ouzou", "alg_centre", "interwilaya"],
  ["bouira_ville", "alg_centre", "interwilaya"],
  ["akbou", "tizi_ouzou", "interwilaya"],
  ["centre", "akbou", "bj_commune_ville"],
  ["br_chorfa", "bouira_ville", "frontiere"],
  // --- lot 3 : enrichissement (nouveaux trajets, sens inverses) ---
  ["alg_bab_ezzouar", "alg_kouba", "alger"],
  ["alg_el_harrach", "alg_centre", "alger"],
  ["alg_zeralda", "alg_cheraga", "alger"],
  ["alg_rouiba", "alg_bab_ezzouar", "alger"],
  ["alg_baraki", "alg_hydra", "alger"],
  ["alg_aeroport", "alg_centre", "alger"],
  ["alg_reghaia", "alg_centre", "alger"],
  ["alg_ain_benian", "alg_cheraga", "alger"],
  ["souk_tenine", "centre", "bj_commune_ville"],
  ["oued_ghir", "centre", "bj_commune_ville"],
  ["centre", "sidi_aich", "bj_commune_ville"],
  ["centre", "kherrata", "bj_commune_ville"],
  ["centre", "tazmalt", "bj_commune_ville"],
  ["tizi_ouzou", "centre", "interwilaya"],
  ["akbou", "alg_centre", "interwilaya"],
  ["sidi_aich", "alg_centre", "interwilaya"],
  ["kherrata", "bouira_ville", "interwilaya"],
  ["br_chorfa", "sidi_aich", "frontiere"],
  ["bouira_ville", "akbou", "frontiere"],
  ["br_mchedallah", "bouira_ville", "frontiere"],
  ["br_chorfa", "centre", "frontiere"],
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
  `\nCOLLECT3 ${new Date().toISOString()} — ${PAIRS.length} paires\n`
);

async function fetchOne(a, b) {
  await cdp.send("Page.navigate", { url: buildUrl(a, b) });
  let prices = {},
    st = { inps: [], txt: "" };
  for (let w = 0; w < 12; w++) {
    await sleep(2400);
    st = await probe();
    prices = parsePrices(st.txt);
    if (Object.keys(prices).length) break;
  }
  const filled = st.inps.filter(Boolean);
  const throttled =
    Object.keys(prices).length === 0 &&
    (filled.length < 2 || filled.some((v) => /undefined/.test(v)));
  return { prices, throttled };
}

let consec = 0,
  cooldowns = 0,
  got = 0,
  noServ = 0;
for (let i = 0; i < PAIRS.length; i++) {
  const [ak, bk, cat] = PAIRS[i];
  const a = geo[ak],
    b = geo[bk];
  if (!a || !b) {
    appendFileSync(LOG, `skip ${ak}>${bk} (lieu manquant)\n`);
    continue;
  }
  if (map.get(ak + ">" + bk)?.ok) continue;
  const rec = {
    i,
    from: ak,
    to: bk,
    pair_cat: cat,
    region_from: a.region,
    region_to: b.region,
  };
  rec.osrm = await osrm(a, b);
  let { prices, throttled } = await fetchOne(a, b);
  if (throttled) {
    await cdp.send("Page.navigate", {
      url: "https://mobility-app.yassir.com/fr",
    });
    await sleep(8000);
    ({ prices, throttled } = await fetchOne(a, b));
  }
  rec.yassir = prices;
  rec.ok = Object.keys(prices).length > 0;
  if (!rec.ok && !throttled) rec.note = "no_service";
  map.set(ak + ">" + bk, rec);
  writeFileSync(
    "scripts/yassir/results.json",
    JSON.stringify([...map.values()], null, 2)
  );
  const tag = rec.ok
    ? `C ${prices.Classique?.low}-${prices.Classique?.high}`
    : throttled
      ? "THROTTLE"
      : "NO_SERVICE";
  const line = `${String(i + 1).padStart(2)}/${PAIRS.length} [${cat}] ${ak}→${bk} ${rec.osrm ? rec.osrm.km.toFixed(0) + "km" : "?"} ${tag}`;
  console.log(line);
  appendFileSync(LOG, line + "\n");

  if (rec.ok) {
    got++;
    consec = 0;
    await sleep(9000 + Math.random() * 4000);
  } else if (rec.note === "no_service") {
    await sleep(4000);
  } // pas un throttle : on continue normalement
  else {
    // throttle
    consec++;
    if (consec >= 3) {
      cooldowns++;
      appendFileSync(LOG, `COOLDOWN ${cooldowns} (360s) — throttle\n`);
      await cdp.send("Page.navigate", {
        url: "https://mobility-app.yassir.com/fr",
      });
      await sleep(360000);
      consec = 0;
      if (cooldowns >= 2) {
        appendFileSync(
          LOG,
          `NEED_RELOGIN — throttle persistant, reconnexion requise\n`
        );
        console.log("NEED_RELOGIN");
        break;
      }
    } else await sleep(15000);
  }
}
appendFileSync(
  LOG,
  `done got ${got}, no_service ${[...map.values()].filter((r) => r.note === "no_service").length}\n`
);
console.log("COLLECT3 done. nouveaux ok:", got);
cdp.close();
process.exit(0);
