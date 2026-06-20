import { CDP, findYassirPage } from "./cdp.mjs";
import { PLACES } from "./places.mjs";
import { writeFileSync } from "node:fs";

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
    throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200));
  return r.result.value;
}

const cache = {};
for (const [key, { q, cat }] of Object.entries(PLACES)) {
  try {
    const raw = await ev(`(async () => {
      const g = new google.maps.Geocoder();
      const res = await g.geocode({ address: ${JSON.stringify(q)}, region: "dz" });
      const r = res.results[0];
      return JSON.stringify({ place_id: r.place_id, lat: r.geometry.location.lat(), lng: r.geometry.location.lng(), addr: r.formatted_address });
    })()`);
    const r = JSON.parse(raw);
    cache[key] = { ...r, cat, q };
    console.log(
      `${key.padEnd(12)} ${r.lat.toFixed(5)},${r.lng.toFixed(5)}  ${r.addr}`
    );
  } catch (e) {
    console.log(`${key.padEnd(12)} ERREUR: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 400));
}
writeFileSync("scripts/yassir/geo-cache.json", JSON.stringify(cache, null, 2));
console.log("\n[geo-cache.json] lieux résolus:", Object.keys(cache).length);
cdp.close();
process.exit(0);
