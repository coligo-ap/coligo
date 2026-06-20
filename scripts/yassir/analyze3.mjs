import { readFileSync } from "node:fs";
const rows = JSON.parse(
  readFileSync("scripts/yassir/coligo-results.json", "utf8")
).filter((r) => r.ok && r.osrm && r.yassir?.Classique && r.coligo?.classic);
const mid = (o) => (o.low + o.high) / 2;
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const cat = (r) => r.pair_cat || "bejaia_urbain";

const recs = rows.map((r) => ({
  from: r.from,
  to: r.to,
  cat: cat(r),
  km: r.osrm.km,
  y: mid(r.yassir.Classique),
  c: r.coligo.classic.reco,
  yc: r.yassir.Confort ? mid(r.yassir.Confort) : null,
  cc: r.coligo.confort?.reco,
  pct:
    (r.coligo.classic.reco - mid(r.yassir.Classique)) / mid(r.yassir.Classique),
}));

console.log(
  "TOTAL exploitable:",
  recs.length,
  " | km min/max:",
  Math.min(...recs.map((r) => r.km)).toFixed(1),
  "→",
  Math.max(...recs.map((r) => r.km)).toFixed(0)
);

console.log("\n## Par catégorie (Classique, Coligo ACTUEL)");
console.log("cat | n | km(min-max) | Yassir méd | Coligo méd | écart méd");
const cats = [...new Set(recs.map((r) => r.cat))];
for (const c of cats) {
  const a = recs.filter((r) => r.cat === c);
  if (!a.length) continue;
  console.log(
    `${c} | ${a.length} | ${Math.min(...a.map((r) => r.km)).toFixed(0)}-${Math.max(...a.map((r) => r.km)).toFixed(0)} | ${median(a.map((r) => r.y)).toFixed(0)} | ${median(a.map((r) => r.c)).toFixed(0)} | ${median(a.map((r) => r.pct)) * 100 >= 0 ? "+" : ""}${(median(a.map((r) => r.pct)) * 100).toFixed(0)}%`
  );
}

console.log("\n## Par tranche de distance");
const bands = [
  [0, 5],
  [5, 10],
  [10, 25],
  [25, 50],
  [50, 100],
  [100, 999],
];
console.log(
  "tranche | n | Yassir méd | Coligo méd | écart méd | Yassir DA/km*"
);
for (const [lo, hi] of bands) {
  const a = recs.filter((r) => r.km >= lo && r.km < hi);
  if (!a.length) continue;
  const perkm = median(a.map((r) => r.y / r.km));
  console.log(
    `${lo}-${hi == 999 ? "+" : hi}km | ${a.length} | ${median(a.map((r) => r.y)).toFixed(0)} | ${median(a.map((r) => r.c)).toFixed(0)} | ${median(a.map((r) => r.pct)) * 100 >= 0 ? "+" : ""}${(median(a.map((r) => r.pct)) * 100).toFixed(0)}% | ${perkm.toFixed(0)}`
  );
}

// asymétrie centre<->akbou
const ca = recs.find((r) => r.from === "centre" && r.to === "akbou"),
  ac = recs.find((r) => r.from === "akbou" && r.to === "centre");
if (ca && ac)
  console.log(
    `\n## Asymétrie A→B vs B→A : Béjaïa→Akbou ${ca.km.toFixed(0)}km Yassir ${ca.y.toFixed(0)} | Akbou→Béjaïa ${ac.km.toFixed(0)}km Yassir ${ac.y.toFixed(0)}`
  );

// Confort dispo ?
const cf = recs.filter((r) => r.yc);
if (cf.length)
  console.log(
    `\n## Confort : ratio médian Yassir Confort/Classique = ${median(cf.map((r) => r.yc / r.y)).toFixed(2)} (n=${cf.length})`
  );
