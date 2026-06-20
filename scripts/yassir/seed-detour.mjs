// Mesure le DÉTOUR RÉEL moyen (route OSRM / ligne droite) par ville à partir de
// plusieurs vrais trajets, et seed public.drive_detour_zone (mig 0235) pour la
// zone d'ancre correspondante. Apprentissage renforcé = médiane multi-trajets,
// pas un point unique. Re-jouable (UPSERT). Usage : node scripts/yassir/seed-detour.mjs
import { getDbUrl } from "../_supabase.mjs";
import { readFileSync } from "node:fs";
import pg from "pg";

const geo = JSON.parse(readFileSync("scripts/yassir/geo-cache3.json", "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const crowKm = (a, b) => {
  const R = 6371,
    dLat = ((b.lat - a.lat) * Math.PI) / 180,
    dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
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
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Groupe par région.
const byRegion = {};
for (const k in geo) {
  const r = geo[k].region;
  if (!r) continue;
  (byRegion[r] = byRegion[r] || []).push(geo[k]);
}

const c = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const MAX_PAIRS = 9;
for (const region of Object.keys(byRegion).sort()) {
  const pts = byRegion[region];
  if (pts.length < 3) continue;
  // Paires intra-ville représentatives (ligne droite 0,8–15 km = trajets urbains).
  const pairs = [];
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const ck = crowKm(pts[i], pts[j]);
      if (ck >= 0.8 && ck <= 15) pairs.push([pts[i], pts[j], ck]);
    }
  pairs.sort(() => Math.random() - 0.5);
  const sample = pairs.slice(0, MAX_PAIRS);
  const ratios = [];
  for (const [a, b, ck] of sample) {
    const road = await osrm(a, b);
    await sleep(250);
    if (!road) continue;
    const ratio = road / ck;
    if (ratio >= 1.0 && ratio <= 3.0) ratios.push(ratio);
  }
  if (ratios.length < 3) {
    console.log(region.padEnd(12), "skip (échantillon insuffisant)");
    continue;
  }
  const med = +median(ratios).toFixed(3);
  // Zone d'ancre correspondante (centroïde de la région).
  const cen = {
    lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
    lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
  };
  const zone = (
    await c.query("select drive_nearest_zone($1,$2) as z", [cen.lat, cen.lng])
  ).rows[0].z;
  if (!zone) {
    console.log(
      region.padEnd(12),
      `médiane ${med} · n=${ratios.length} · PAS d'ancre → national (skip)`
    );
    continue;
  }
  await c.query(
    `insert into drive_detour_zone(zone, ratio_ema, n, updated_at) values($1,$2,$3,now())
     on conflict (zone) do update set ratio_ema=excluded.ratio_ema, n=greatest(drive_detour_zone.n, excluded.n), updated_at=now()`,
    [zone, med, ratios.length]
  );
  console.log(
    region.padEnd(12),
    `→ zone ${zone.padEnd(12)} détour médian ${med}  (n=${ratios.length})`
  );
}
console.log("\nTable drive_detour_zone :");
for (const r of (
  await c.query(
    "select zone, ratio_ema, n from drive_detour_zone order by zone"
  )
).rows)
  console.log("  ", r.zone.padEnd(12), "ratio", r.ratio_ema, "n", r.n);
await c.end();
