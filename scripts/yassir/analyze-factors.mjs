import { readFileSync } from "node:fs";
const geo = JSON.parse(readFileSync("scripts/yassir/geo-cache3.json", "utf8"));
const rows = JSON.parse(
  readFileSync("scripts/yassir/results.json", "utf8")
).filter((r) => r.ok && r.osrm && r.yassir?.Classique);
const mid = (o) => (o.low + o.high) / 2;
const reg = (k) => geo[k]?.region || "?";
const D = rows.map((r) => ({
  from: r.from,
  to: r.to,
  km: r.osrm.km,
  min: r.osrm.min,
  y: mid(r.yassir.Classique),
  ylo: r.yassir.Classique.low,
  yhi: r.yassir.Classique.high,
  cf: r.yassir.Confort ? mid(r.yassir.Confort) : null,
  cFrom: reg(r.from),
  cTo: reg(r.to),
}));

// ---------- utilitaires régression ----------
function ols1(P) {
  const n = P.length,
    sx = P.reduce((s, p) => s + p.x, 0),
    sy = P.reduce((s, p) => s + p.y, 0),
    sxx = P.reduce((s, p) => s + p.x * p.x, 0),
    sxy = P.reduce((s, p) => s + p.x * p.y, 0);
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const a = (sy - b * sx) / n;
  const yb = sy / n;
  let ssr = 0,
    sst = 0;
  for (const p of P) {
    const f = a + b * p.x;
    ssr += (p.y - f) ** 2;
    sst += (p.y - yb) ** 2;
  }
  return { a, b, r2: 1 - ssr / sst, n };
}
// régression multiple 2 variables (km, min) : résout 3x3
function ols2(P) {
  let Sk = 0,
    St = 0,
    Sy = 0,
    Skk = 0,
    Stt = 0,
    Skt = 0,
    Sky = 0,
    Sty = 0;
  const n = P.length;
  for (const p of P) {
    Sk += p.k;
    St += p.t;
    Sy += p.y;
    Skk += p.k * p.k;
    Stt += p.t * p.t;
    Skt += p.k * p.t;
    Sky += p.k * p.y;
    Sty += p.t * p.y;
  }
  // matrice normale [[n,Sk,St],[Sk,Skk,Skt],[St,Skt,Stt]] · [b0,bk,bt] = [Sy,Sky,Sty]
  const A = [
    [n, Sk, St, Sy],
    [Sk, Skk, Skt, Sky],
    [St, Skt, Stt, Sty],
  ];
  for (let i = 0; i < 3; i++) {
    let piv = A[i][i];
    let mx = i;
    for (let r = i + 1; r < 3; r++)
      if (Math.abs(A[r][i]) > Math.abs(piv)) {
        piv = A[r][i];
        mx = r;
      }
    [A[i], A[mx]] = [A[mx], A[i]];
    for (let r = 0; r < 3; r++)
      if (r !== i) {
        const f = A[r][i] / A[i][i];
        for (let c = i; c < 4; c++) A[r][c] -= f * A[i][c];
      }
  }
  const b0 = A[0][3] / A[0][0],
    bk = A[1][3] / A[1][1],
    bt = A[2][3] / A[2][2];
  const yb = Sy / n;
  let ssr = 0,
    sst = 0;
  for (const p of P) {
    const f = b0 + bk * p.k + bt * p.t;
    ssr += (p.y - f) ** 2;
    sst += (p.y - yb) ** 2;
  }
  return { b0, bk, bt, r2: 1 - ssr / sst, n };
}

console.log(
  "=== JEU : ",
  D.length,
  "trajets | km",
  Math.min(...D.map((d) => d.km)).toFixed(1),
  "→",
  Math.max(...D.map((d) => d.km)).toFixed(0),
  "| min",
  Math.min(...D.map((d) => d.min)).toFixed(0),
  "→",
  Math.max(...D.map((d) => d.min)).toFixed(0)
);

// 1) DISTANCE seule
const m1 = ols1(D.map((d) => ({ x: d.km, y: d.y })));
console.log(
  `\n[1] Prix ~ DISTANCE : ${m1.a.toFixed(0)} + ${m1.b.toFixed(2)}·km   (R²=${m1.r2.toFixed(3)})`
);
// 2) TEMPS seul
const m1t = ols1(D.map((d) => ({ x: d.min, y: d.y })));
console.log(
  `[2] Prix ~ TEMPS    : ${m1t.a.toFixed(0)} + ${m1t.b.toFixed(2)}·min  (R²=${m1t.r2.toFixed(3)})`
);
// 3) DISTANCE + TEMPS
const m2 = ols2(D.map((d) => ({ k: d.km, t: d.min, y: d.y })));
console.log(
  `[3] Prix ~ DIST+TEMPS : ${m2.b0.toFixed(0)} + ${m2.bk.toFixed(2)}·km + ${m2.bt.toFixed(2)}·min  (R²=${m2.r2.toFixed(3)})`
);

// 4) ZONE / VILLE (trajets intra-ville uniquement)
console.log("\n[4] EFFET VILLE/ZONE (intra-ville) — prix ~ base + DA/km :");
const cities = [
  ...new Set(D.filter((d) => d.cFrom === d.cTo).map((d) => d.cFrom)),
];
const cityFits = [];
for (const c of cities) {
  const P = D.filter((d) => d.cFrom === c && d.cTo === c);
  if (P.length < 4) continue;
  const f = ols1(P.map((d) => ({ x: d.km, y: d.y })));
  cityFits.push({ c, ...f });
}
cityFits.sort((a, b) => b.b - a.b);
for (const f of cityFits)
  console.log(
    `   ${f.c.padEnd(12)} n=${String(f.n).padStart(2)}  base ${f.a.toFixed(0).padStart(4)} + ${f.b.toFixed(1).padStart(5)}/km   (prix@5km ${(f.a + f.b * 5).toFixed(0)})`
  );

// 5) SUPPLÉMENT AÉROPORT : trajets avec aéroport vs modèle ville
console.log(
  "\n[5] SUPPLÉMENT AÉROPORT (prix réel vs attendu modèle global dist+temps) :"
);
for (const d of D.filter((d) => /aeroport|airport/.test(d.from + d.to))) {
  const exp = m2.b0 + m2.bk * d.km + m2.bt * d.min;
  console.log(
    `   ${(d.from + "→" + d.to).padEnd(34)} ${d.km.toFixed(0)}km  réel ${d.y.toFixed(0)}  attendu ${exp.toFixed(0)}  Δ ${((d.y - exp) / exp) * 100 >= 0 ? "+" : ""}${(((d.y - exp) / exp) * 100).toFixed(0)}%`
  );
}

// 6) Fourchette low-high = amplitude promo/surge potentielle
const amp = D.map((d) => (d.yhi - d.ylo) / d.ylo);
console.log(
  `\n[6] FOURCHETTE low→high Yassir : amplitude médiane ${(amp.sort((a, b) => a - b)[Math.floor(amp.length / 2)] * 100).toFixed(0)}% (proxy promo/variation affichée)`
);
// 7) Confort
const cf = D.filter((d) => d.cf);
console.log(
  `[7] CONFORT / Classique = ${cf
    .map((d) => d.cf / d.y)
    .sort((a, b) => a - b)
    [Math.floor(cf.length / 2)].toFixed(2)}× (n=${cf.length})`
);
