import { readFileSync } from "node:fs";
const geo = JSON.parse(readFileSync("scripts/yassir/geo-cache3.json", "utf8"));
const rows = JSON.parse(
  readFileSync("scripts/yassir/coligo-results.json", "utf8")
).filter((r) => r.ok && r.osrm && r.yassir?.Classique && r.coligo?.classic);
const mid = (o) => (o.low + o.high) / 2;
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const reg = (k) => geo[k]?.region || "?";

const recs = rows.map((r) => ({
  from: r.from,
  to: r.to,
  km: r.osrm.km,
  y: mid(r.yassir.Classique),
  ylo: r.yassir.Classique.low,
  c: r.coligo.classic.reco,
  city: reg(r.from) === reg(r.to) ? reg(r.from) : "inter",
  pct:
    (r.coligo.classic.reco - mid(r.yassir.Classique)) / mid(r.yassir.Classique),
}));

const below = recs.filter((r) => r.c < r.y).length;
const belowLo = recs.filter((r) => r.c <= r.ylo).length;
console.log(`\n=== VÉRIF UNDERCUT — ${recs.length} trajets ===`);
console.log(
  `Coligo < Yassir (médiane) : ${below}/${recs.length} (${((below / recs.length) * 100).toFixed(0)}%)`
);
console.log(
  `Coligo ≤ Yassir prix BAS  : ${belowLo}/${recs.length} (${((belowLo / recs.length) * 100).toFixed(0)}%)`
);
console.log(
  `Écart médian global       : ${(median(recs.map((r) => r.pct)) * 100).toFixed(0)}%`
);

console.log(`\nPar tranche :`);
for (const [lo, hi] of [
  [0, 5],
  [5, 10],
  [10, 25],
  [25, 50],
  [50, 100],
  [100, 999],
]) {
  const a = recs.filter((r) => r.km >= lo && r.km < hi);
  if (!a.length) continue;
  const b = a.filter((r) => r.c < r.y).length;
  console.log(
    `  ${lo}-${hi == 999 ? "+" : hi}km : n=${a.length} | écart méd ${(median(a.map((r) => r.pct)) * 100).toFixed(0)}% | sous Yassir ${b}/${a.length}`
  );
}
console.log(`\nPar ville (intra) :`);
for (const c of [
  ...new Set(recs.filter((r) => r.city !== "inter").map((r) => r.city)),
]) {
  const a = recs.filter((r) => r.city === c);
  if (a.length < 3) continue;
  console.log(
    `  ${c.padEnd(12)} n=${a.length} | écart méd ${(median(a.map((r) => r.pct)) * 100).toFixed(0)}% | sous Yassir ${a.filter((r) => r.c < r.y).length}/${a.length}`
  );
}
// trajets où Coligo >= Yassir (à corriger en Phase 2 zones)
const over = recs.filter((r) => r.c >= r.y);
if (over.length) {
  console.log(
    `\n⚠️ ${over.length} trajets ENCORE ≥ Yassir (cibles Phase 2 zones) :`
  );
  over
    .slice(0, 12)
    .forEach((r) =>
      console.log(
        `   ${r.from}→${r.to} ${r.km.toFixed(0)}km [${r.city}] Yassir ${r.y.toFixed(0)} Coligo ${r.c} (+${(r.pct * 100).toFixed(0)}%)`
      )
    );
}
