import { readFileSync, writeFileSync } from "node:fs";
const rows = JSON.parse(
  readFileSync("scripts/yassir/coligo-results.json", "utf8")
).filter((r) => r.ok && r.osrm && r.yassir?.Classique && r.coligo?.classic);

const mid = (o) => (o ? (o.low + o.high) / 2 : null);
function fit(points) {
  // [{x,y}] -> {a,b} y=a+b*x
  const n = points.length,
    sx = points.reduce((s, p) => s + p.x, 0),
    sy = points.reduce((s, p) => s + p.y, 0);
  const sxx = points.reduce((s, p) => s + p.x * p.x, 0),
    sxy = points.reduce((s, p) => s + p.x * p.y, 0);
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const a = (sy - b * sx) / n;
  return { a, b };
}
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const recs = rows.map((r) => {
  const y = mid(r.yassir.Classique);
  const c =
    r.coligo.classic.reco ??
    mid({ low: r.coligo.classic.low, high: r.coligo.classic.high });
  return {
    from: r.from,
    to: r.to,
    cat:
      r.cat_from === "long" || r.cat_to === "long"
        ? "long"
        : r.cat_from === "alentours" || r.cat_to === "alentours"
          ? "alentours"
          : "centre",
    km: r.osrm.km,
    min: r.osrm.min,
    y,
    c,
    yC: r.yassir.Confort ? mid(r.yassir.Confort) : null,
    cC: r.coligo.confort?.reco,
    pct: (c - y) / y,
  };
});

let out = "# Comparaison Coligo vs Yassir — Béjaïa\n\n";
out += `Trajets exploitables (prix des deux côtés) : **${recs.length}**\n\n`;
out +=
  "| # | Trajet | km | min | Yassir Classique | Coligo classic | Écart Coligo |\n|--|--|--|--|--|--|--|\n";
recs
  .sort((a, b) => a.km - b.km)
  .forEach((r, i) => {
    out += `| ${i + 1} | ${r.from}→${r.to} | ${r.km.toFixed(1)} | ${r.min.toFixed(0)} | ${r.y.toFixed(0)} DA | ${r.c} DA | ${r.pct * 100 >= 0 ? "+" : ""}${(r.pct * 100).toFixed(0)}% |\n`;
  });

const byCat = {};
for (const r of recs) (byCat[r.cat] ??= []).push(r);
out +=
  "\n## Synthèse par catégorie (Classique)\n\n| Catégorie | n | km moyen | Yassir médian | Coligo médian | Écart médian |\n|--|--|--|--|--|--|\n";
for (const cat of ["centre", "alentours", "long"]) {
  const a = byCat[cat];
  if (!a?.length) continue;
  out += `| ${cat} | ${a.length} | ${(a.reduce((s, r) => s + r.km, 0) / a.length).toFixed(1)} | ${median(a.map((r) => r.y)).toFixed(0)} DA | ${median(a.map((r) => r.c)).toFixed(0)} DA | ${median(a.map((r) => r.pct)) * 100 >= 0 ? "+" : ""}${(median(a.map((r) => r.pct)) * 100).toFixed(0)}% |\n`;
}

const fy = fit(recs.map((r) => ({ x: r.km, y: r.y })));
const fc = fit(recs.map((r) => ({ x: r.km, y: r.c })));
out += `\n## Régression prix = base + (DA/km)·km\n\n`;
out += `- **Yassir Classique** : base ≈ ${fy.a.toFixed(0)} DA, ${fy.b.toFixed(1)} DA/km\n`;
out += `- **Coligo classic**  : base ≈ ${fc.a.toFixed(0)} DA, ${fc.b.toFixed(1)} DA/km (barème déclaré : 100 + 35/km, plancher 200)\n`;
const cheaper = recs.filter((r) => r.c < r.y).length;
out += `\n- Coligo moins cher que Yassir sur **${cheaper}/${recs.length}** trajets (${((cheaper / recs.length) * 100).toFixed(0)}%).\n`;
out += `- Écart médian global : **${(median(recs.map((r) => r.pct)) * 100).toFixed(0)}%**.\n`;

writeFileSync("scripts/yassir/RAPPORT.md", out);
console.log(out);
