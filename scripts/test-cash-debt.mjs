// Test PUR — seuils de la politique de dette espèces (B + A).
// Exécution : node --experimental-strip-types scripts/test-cash-debt.mjs
import { cashDebtStatus } from "../lib/finances/cash-debt.ts";

let pass = 0,
  fail = 0;
const ok = (c, l) =>
  c ? (pass++, console.log("  ✅", l)) : (fail++, console.log("  ❌", l));

const CAP = 5000; // soft = 4000 (80 %)

console.log("→ États selon la dette (cap 5000, soft 4000)");
ok(cashDebtStatus(0, CAP).state === "clear", "Dette 0 → clear");
ok(cashDebtStatus(3999, CAP).state === "clear", "Sous le seuil doux → clear");
ok(cashDebtStatus(4000, CAP).state === "warning", "Au seuil doux → warning");
ok(cashDebtStatus(4999, CAP).state === "warning", "Sous le cap → warning");
ok(cashDebtStatus(5000, CAP).state === "blocked", "Au cap → blocked");
ok(cashDebtStatus(8000, CAP).state === "blocked", "Au-dessus du cap → blocked");

console.log("→ Marge restante & seuil");
const s = cashDebtStatus(3200, CAP);
ok(s.remaining === 1800, "remaining = cap − dette (5000−3200)");
ok(s.softThreshold === 4000, "softThreshold = cap × 0,8");
ok(cashDebtStatus(6000, CAP).remaining === 0, "remaining jamais négatif");

console.log("→ Politique désactivée (cap 0) & solde positif");
ok(cashDebtStatus(9999, 0).state === "clear", "cap 0 → jamais bloqué");
ok(cashDebtStatus(-500, CAP).debt === 0, "Solde positif → dette ramenée à 0");
ok(cashDebtStatus(-500, CAP).state === "clear", "Solde positif → clear");

console.log("→ softRatio personnalisable");
ok(
  cashDebtStatus(3000, CAP, 0.5).state === "warning",
  "softRatio 0,5 → warning dès 2500"
);

console.log(`\n${pass} ✅  ${fail} ❌`);
process.exit(fail ? 1 : 0);
