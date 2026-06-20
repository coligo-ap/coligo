import { CDP, findYassirPage } from "./cdp.mjs";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
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

// Béjaïa : courts → longs.
const PAIRS = [
  ["centre", "aamriw"],
  ["brise_mer", "gare"],
  ["centre", "gare"],
  ["sidi_ahmed", "edimco"],
  ["aeroport", "edimco"],
  ["oued_ghir", "centre"],
  ["centre", "tichy"],
  ["centre", "aokas"],
  ["centre", "el_kseur"],
  ["akbou", "centre"],
];

async function osrm(a, b) {
  try {
    const u = `http://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`;
    const j = await (await fetch(u)).json();
    if (j.code !== "Ok") return null;
    return j.routes[0].distance / 1000;
  } catch {
    return null;
  }
}

const t = await findYassirPage();
const cdp = await CDP.attach(t.webSocketDebuggerUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
const txt = async () =>
  (
    await cdp.send("Runtime.evaluate", {
      expression: "document.body.innerText",
      returnByValue: true,
    })
  ).result.value || "";

const out = [];
for (const [ak, bk] of PAIRS) {
  await cdp.send("Page.navigate", { url: mk(geo[ak], geo[bk]) });
  let lo = null,
    hi = null;
  for (let w = 0; w < 11; w++) {
    await sleep(2500);
    const m = (await txt()).match(
      /Classique\s*\n\s*([\d\s]+)DZD\s*\n\s*([\d\s]+)DZD/
    );
    if (m) {
      lo = +m[1].replace(/\s/g, "");
      hi = +m[2].replace(/\s/g, "");
      break;
    }
  }
  const km = await osrm(geo[ak], geo[bk]);
  const ok = lo != null;
  out.push({ from: ak, to: bk, km, promo: lo, normal: hi });
  console.log(
    `${ak}→${bk} ${km ? km.toFixed(1) + "km" : "?"}  promo ${lo ?? "—"}  normal ${hi ?? "—"}`
  );
  writeFileSync(
    "scripts/yassir/bejaia-live.json",
    JSON.stringify(out, null, 2)
  );
  if (!ok && out.filter((x) => x.promo == null).length >= 3) {
    console.log("THROTTLE — reconnexion");
    break;
  }
  await sleep(7000 + Math.random() * 3000);
}
appendFileSync(
  "scripts/yassir/remeasure.log",
  `${new Date().toISOString()} got ${out.filter((x) => x.promo != null).length}/${PAIRS.length}\n`
);
cdp.close();
process.exit(0);
