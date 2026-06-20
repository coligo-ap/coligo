import { CDP, findYassirPage } from "./cdp.mjs";
import { PLACES2 } from "./places2.mjs";
import { readFileSync, writeFileSync } from "node:fs";

const t = await findYassirPage();
const cdp = await CDP.attach(t.webSocketDebuggerUrl);
await cdp.send("Runtime.enable");
async function ev(expr) {
  const r = await cdp.send("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails)
    throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 160));
  return r.result.value;
}

// repartir de l'ancien cache (Béjaïa) en lui ajoutant region=bejaia
const old = JSON.parse(readFileSync("scripts/yassir/geo-cache.json", "utf8"));
const cache = {};
for (const [k, v] of Object.entries(old))
  cache[k] = {
    ...v,
    region: "bejaia",
    role: v.cat === "centre" ? "ville" : v.cat,
  };

for (const [key, { q, region, role }] of Object.entries(PLACES2)) {
  try {
    const raw = await ev(
      `(async () => { const g=new google.maps.Geocoder(); const res=await g.geocode({address:${JSON.stringify(q)},region:"dz"}); const r=res.results[0]; return JSON.stringify({place_id:r.place_id,lat:r.geometry.location.lat(),lng:r.geometry.location.lng(),addr:r.formatted_address}); })()`
    );
    const r = JSON.parse(raw);
    cache[key] = { ...r, region, role, q };
    console.log(
      `${key.padEnd(16)} ${r.lat.toFixed(4)},${r.lng.toFixed(4)}  ${r.addr}`
    );
  } catch (e) {
    console.log(`${key.padEnd(16)} ERREUR ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 350));
}
writeFileSync("scripts/yassir/geo-cache2.json", JSON.stringify(cache, null, 2));
console.log("\n[geo-cache2.json] total lieux:", Object.keys(cache).length);
cdp.close();
process.exit(0);
