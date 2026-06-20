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

// 8 trajets témoins FIXES (multi-villes, court+moyen) — toujours les mêmes.
const WITNESS = [
  ["alg_centre", "alg_bab_ezzouar"],
  ["alg_centre", "alg_aeroport"],
  ["alg_kouba", "alg_el_harrach"],
  ["centre", "tichy"],
  ["centre", "gare"],
  ["oran_centre", "oran_aeroport"],
  ["cst_centre", "cst_ali_mendjeli"],
  ["stf_centre", "stf_univ"],
];

const now = new Date();
const algH = (now.getUTCHours() + 1) % 24; // Alger = UTC+1
const dow = ((new Date(now.getTime() + 3600e3).getUTCDay() + 6) % 7) + 1; // ISODOW
const band =
  (algH >= 7 && algH <= 9) || (algH >= 16 && algH <= 19)
    ? "pointe"
    : algH >= 22 || algH <= 5
      ? "nuit"
      : "base";
console.log(`Heure Alger ~${algH}h | jour ${dow} | bande=${band}`);

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
    /(Classique|Confort)\s*\n\s*(\d[\d\s]*)\s*DZD(?:\s*\n\s*(\d[\d\s]*)\s*DZD)?/g;
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
        expression: `(() => { const inps=[...document.querySelectorAll('input')].map(i=>i.value).filter(Boolean); return JSON.stringify({inps, txt:document.body.innerText}); })()`,
        returnByValue: true,
      })
    ).result.value
  );

const all = existsSync("scripts/yassir/surge-data.json")
  ? JSON.parse(readFileSync("scripts/yassir/surge-data.json", "utf8"))
  : [];
let got = 0,
  consec = 0;
for (const [ak, bk] of WITNESS) {
  const a = geo[ak],
    b = geo[bk];
  await cdp.send("Page.navigate", { url: buildUrl(a, b) });
  let p = {},
    st = { inps: [], txt: "" };
  for (let w = 0; w < 12; w++) {
    await sleep(2400);
    st = await probe();
    p = parsePrices(st.txt);
    if (Object.keys(p).length) break;
  }
  if (!Object.keys(p).length) {
    await cdp.send("Page.navigate", {
      url: "https://mobility-app.yassir.com/fr",
    });
    await sleep(7000);
    for (let w = 0; w < 12; w++) {
      await sleep(2400);
      st = await probe();
      p = parsePrices(st.txt);
      if (Object.keys(p).length) break;
    }
  }
  const o = await osrm(a, b);
  const ok = !!p.Classique;
  if (ok) {
    all.push({
      ts: now.toISOString(),
      algH,
      dow,
      band,
      from: ak,
      to: bk,
      km: o?.km ?? null,
      classique: p.Classique,
      confort: p.Confort ?? null,
    });
    got++;
    consec = 0;
  } else consec++;
  console.log(
    `${ak}→${bk} ${o ? o.km.toFixed(0) + "km" : "?"} ${ok ? "C " + p.Classique.low + "-" + p.Classique.high : "—"}`
  );
  writeFileSync("scripts/yassir/surge-data.json", JSON.stringify(all, null, 2));
  if (consec >= 3) {
    console.log("THROTTLE — reconnexion nécessaire");
    break;
  }
  await sleep(8000 + Math.random() * 3000);
}
appendFileSync(
  "scripts/yassir/surge.log",
  `${now.toISOString()} bande=${band} algH=${algH} got=${got}/${WITNESS.length}\n`
);
console.log(
  `\n[surge-data.json] bande ${band} : +${got} mesures (total ${all.length})`
);
cdp.close();
process.exit(0);
