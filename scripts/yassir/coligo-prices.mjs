import { readFileSync, writeFileSync } from "node:fs";
import { getDbUrl } from "../_supabase.mjs";
import pg from "pg";

const rows = JSON.parse(readFileSync("scripts/yassir/results.json", "utf8"));
const geo = JSON.parse(readFileSync("scripts/yassir/geo-cache3.json", "utf8"));
const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();

async function quote(km, gamme, lat, lng) {
  const sq = await c.query("select * from drive_smart_quote($1,$2,$3,$4)", [
    km,
    gamme,
    lat,
    lng,
  ]);
  const sr = await c.query("select * from drive_similar_range($1,$2)", [
    km,
    gamme,
  ]);
  const q = sq.rows[0] || {};
  const r = sr.rows[0] || {};
  return {
    reco: q.reco_da ?? null,
    floor: q.floor_da ?? null,
    mini: q.mini_da ?? null,
    fast: q.fast_da ?? null,
    low: r.low_da ?? null,
    high: r.high_da ?? null,
  };
}

let done = 0;
for (const rec of rows) {
  if (!rec.osrm) continue;
  const a = geo[rec.from];
  const km = rec.osrm.km;
  rec.coligo = {
    classic: await quote(km, "classic", a.lat, a.lng),
    confort: await quote(km, "confort", a.lat, a.lng),
  };
  done++;
}
writeFileSync(
  "scripts/yassir/coligo-results.json",
  JSON.stringify(rows, null, 2)
);
console.log("Coligo prix calculés pour", done, "trajets → coligo-results.json");
await c.end();
process.exit(0);
