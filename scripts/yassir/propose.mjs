import { readFileSync, writeFileSync } from "node:fs";
const rows = JSON.parse(
  readFileSync("scripts/yassir/results.json", "utf8")
).filter((r) => r.ok && r.osrm && r.yassir?.Classique);
const mid = (o) => (o.low + o.high) / 2;
const pts = rows.map((r) => ({
  km: r.osrm.km,
  y: mid(r.yassir.Classique),
  ylo: r.yassir.Classique.low,
  yc: r.yassir.Confort ? mid(r.yassir.Confort) : null,
}));

function fit(P) {
  const n = P.length,
    sx = P.reduce((s, p) => s + p.km, 0),
    sy = P.reduce((s, p) => s + p.y, 0),
    sxx = P.reduce((s, p) => s + p.km * p.km, 0),
    sxy = P.reduce((s, p) => s + p.km * p.y, 0);
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return { a: (sy - b * sx) / n, b };
}
const urban = pts.filter((p) => p.km <= 8),
  inter = pts.filter((p) => p.km > 8);
const fAll = fit(pts),
  fU = fit(urban.map((p) => ({ km: p.km, y: p.y }))),
  fI = fit(inter.map((p) => ({ km: p.km, y: p.y })));

console.log(
  `Points: ${pts.length} (urbain≤8km: ${urban.length}, interville>8km: ${inter.length})`
);
console.log(
  `Yassir Classique — fit global : ${fAll.a.toFixed(0)} + ${fAll.b.toFixed(1)}/km`
);
console.log(
  `Yassir Classique — urbain     : ${fU.a.toFixed(0)} + ${fU.b.toFixed(1)}/km`
);
console.log(
  `Yassir Classique — interville : ${fI.a.toFixed(0)} + ${fI.b.toFixed(1)}/km`
);

// référence Yassir = max(plancher constaté, droite interville) ~ proxy de leur courbe réelle
const floorY = Math.min(...urban.map((p) => p.y));
const yref = (km) => Math.max(floorY, fI.a + fI.b * km);

const price = (km, base, perkm, min) =>
  Math.max(min, Math.round((base + perkm * km) / 5) * 5);
const CUR = { base: 100, perkm: 35, min: 200 };
// scénarios proposés (per_km calé sur ~Yassir interville, base/min ajustés)
const SC = {
  "ACTUEL          ": { base: 100, perkm: 35, min: 200 },
  "A · Aligné Yassir": { base: 120, perkm: Math.round(fI.b), min: 200 },
  "B · Agressif -7% ": {
    base: 110,
    perkm: Math.max(18, Math.round(fI.b) - 2),
    min: 190,
  },
  "C · Premium +8%  ": { base: 140, perkm: Math.round(fI.b) + 2, min: 220 },
};
const D = [3, 5, 8, 12, 18, 26, 40, 66];
let out = "Distance |" + D.map((d) => ` ${d}km`).join(" |") + "\n";
out +=
  "Yassir (réf) |" + D.map((d) => ` ${yref(d).toFixed(0)}`).join(" |") + "\n";
for (const [name, s] of Object.entries(SC)) {
  out +=
    `${name} (${s.base}+${s.perkm}/km,min${s.min}) |` +
    D.map((d) => {
      const p = price(d, s.base, s.perkm, s.min);
      const g = ((p - yref(d)) / yref(d)) * 100;
      return ` ${p} (${g >= 0 ? "+" : ""}${g.toFixed(0)}%)`;
    }).join(" |") +
    "\n";
}
console.log("\n=== Prix par distance (Δ% vs Yassir) ===\n" + out);
writeFileSync("scripts/yassir/baremes.txt", out);
