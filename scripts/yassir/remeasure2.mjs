import { CDP, findYassirPage } from "./cdp.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { getDbUrl } from "../_supabase.mjs";
import pg from "pg";

const geo = JSON.parse(readFileSync("scripts/yassir/geo-cache3.json", "utf8"));
const enc = (lat, lng) => `${lat}%2C${lng}`;
const mk = (a, b) =>
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

const ROUTES = [
  ["brise_mer", "gare"],
  ["centre", "tichy"],
  ["akbou", "centre"],
  ["alg_centre", "alg_bab_ezzouar"],
  ["alg_kouba", "alg_el_harrach"],
  ["oran_centre", "oran_aeroport"],
  ["cst_centre", "cst_ali_mendjeli"],
];

async function osrm(a, b) {
  try {
    const j = await (
      await fetch(
        `http://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`
      )
    ).json();
    return j.code === "Ok" ? j.routes[0].distance / 1000 : null;
  } catch {
    return null;
  }
}

console.log("Attente throttle ~4 min…");
await sleep(240000);

const t = await findYassirPage();
const cdp = await CDP.attach(t.webSocketDebuggerUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");

// Capture, pour Classique : prix BARRÉ (normal) + prix NON barré (promo affichée).
const grab = async () =>
  JSON.parse(
    (
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
    const items=[...document.querySelectorAll('*')]
      .filter(e=>e.children.length===0 && e.offsetParent!==null)
      .map(e=>({t:e.textContent.trim().replace(/\\s+/g,' '), s:getComputedStyle(e).textDecorationLine}))
      .filter(x=>/^(Classique|Confort|Économique|Moto)$/.test(x.t) || /^\\d[\\d ]*DZD$/.test(x.t));
    // bloc Classique = du label Classique jusqu'au prochain label
    let i=items.findIndex(x=>x.t==='Classique'); if(i<0) return JSON.stringify(null);
    const prices=[];
    for(let j=i+1;j<items.length;j++){ if(/^(Confort|Économique|Moto)$/.test(items[j].t)) break;
      if(/DZD/.test(items[j].t)) prices.push({v:+items[j].t.replace(/[^\\d]/g,''), strike:/line-through/.test(items[j].s)}); }
    const normal=prices.find(p=>p.strike)?.v ?? null;
    const promo=prices.find(p=>!p.strike)?.v ?? null;
    return JSON.stringify({normal, promo, all:prices});
  })()`,
        returnByValue: true,
      })
    ).result.value
  );

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();
const out = [];
for (const [ak, bk] of ROUTES) {
  await cdp.send("Page.navigate", { url: mk(geo[ak], geo[bk]) });
  let r = null;
  for (let w = 0; w < 11; w++) {
    await sleep(2500);
    r = await grab();
    if (r && (r.normal || r.promo)) break;
  }
  const km = await osrm(geo[ak], geo[bk]);
  let coligo = null;
  if (km)
    coligo = (
      await c.query("select reco_da from drive_smart_quote($1,$2,$3,$4)", [
        km,
        "classic",
        geo[ak].lat,
        geo[ak].lng,
      ])
    ).rows[0].reco_da;
  const rec = {
    route: ak + "→" + bk,
    km: km ? +km.toFixed(1) : null,
    normal: r?.normal ?? null,
    promo: r?.promo ?? null,
    coligo,
  };
  out.push(rec);
  const vsN =
    rec.normal && coligo
      ? (((coligo - rec.normal) / rec.normal) * 100).toFixed(0) + "%"
      : "—";
  const vsP =
    rec.promo && coligo
      ? (((coligo - rec.promo) / rec.promo) * 100).toFixed(0) + "%"
      : "—";
  console.log(
    `${rec.route.padEnd(26)} ${String(rec.km).padStart(5)}km | Yassir normal ${String(rec.normal).padStart(5)} / promo ${String(rec.promo).padStart(5)} | Coligo ${String(coligo).padStart(5)} | vs normal ${vsN} · vs promo ${vsP}`
  );
  writeFileSync("scripts/yassir/remeasure2.json", JSON.stringify(out, null, 2));
  if (
    !r?.normal &&
    !r?.promo &&
    out.filter((x) => !x.normal && !x.promo).length >= 3
  ) {
    console.log("THROTTLE");
    break;
  }
  await sleep(8000 + Math.random() * 4000);
}
await c.end();
cdp.close();
process.exit(0);
