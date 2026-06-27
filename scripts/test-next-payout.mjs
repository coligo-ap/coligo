// Test PUR (sans DB) — calcul de la prochaine échéance de versement auto.
// Vérifie que computeNextPayout reflète generate_scheduled_payouts (mig 0102) :
// cadence, fenêtre échue, minimum, coordonnées, gel, passage cron 06:00 UTC.
//
// Exécution : node --experimental-strip-types scripts/test-next-payout.mjs
import { computeNextPayout } from "../lib/finances/next-payout.ts";

let pass = 0,
  fail = 0;
const ok = (c, l) =>
  c ? (pass++, console.log("  ✅", l)) : (fail++, console.log("  ❌", l));

const NOW = new Date("2026-06-27T10:00:00Z"); // après 06:00 UTC
const base = {
  payoutAuto: "weekly",
  lastAutoPayoutAt: null,
  method: "ccp",
  details: "CCP 00799999 clé 25",
  isFrozen: false,
  available: 5000,
};

console.log("→ États de base");
ok(
  computeNextPayout({ ...base, payoutAuto: "none" }, NOW).kind === "manual",
  "Auto désactivé → manual"
);
ok(
  computeNextPayout({ ...base, isFrozen: true }, NOW).kind === "frozen",
  "Compte gelé → frozen"
);
ok(
  computeNextPayout({ ...base, details: "  " }, NOW).kind === "needs_setup",
  "Coordonnées vides → needs_setup"
);
ok(
  computeNextPayout({ ...base, available: 800 }, NOW).kind ===
    "waiting_balance",
  "Solde < 1000 → waiting_balance"
);

console.log("→ Programmation & dates (cron 06:00 UTC)");
// Jamais versé + après 06:00 → dû maintenant → prochain cron = demain 06:00 UTC.
const r1 = computeNextPayout(base, NOW);
ok(r1.kind === "scheduled", "Jamais versé + solde OK → scheduled");
ok(
  r1.kind === "scheduled" && r1.date === "2026-06-28T06:00:00.000Z",
  `Prochain cron = 28/06 06:00 UTC (got ${r1.kind === "scheduled" ? r1.date : "-"})`
);

// Jamais versé mais AVANT 06:00 → cron du jour même.
const early = new Date("2026-06-27T03:00:00Z");
const r2 = computeNextPayout(base, early);
ok(
  r2.kind === "scheduled" && r2.date === "2026-06-27T06:00:00.000Z",
  "Avant 06:00 → cron le jour même 06:00 UTC"
);

// Hebdo, versé il y a 3 jours → échéance dans 4 j → cron suivant.
const r3 = computeNextPayout(
  { ...base, lastAutoPayoutAt: "2026-06-24T06:00:00Z" },
  NOW
);
ok(
  r3.kind === "scheduled" && r3.date === "2026-07-01T06:00:00.000Z",
  `Hebdo +7j depuis 24/06 → 01/07 06:00 (got ${r3.kind === "scheduled" ? r3.date : "-"})`
);

// Mensuel, versé il y a 10 jours → échéance dans 20 j.
const r4 = computeNextPayout(
  { ...base, payoutAuto: "monthly", lastAutoPayoutAt: "2026-06-17T06:00:00Z" },
  NOW
);
ok(
  r4.kind === "scheduled" && r4.date === "2026-07-17T06:00:00.000Z",
  `Mensuel +30j depuis 17/06 → 17/07 06:00 (got ${r4.kind === "scheduled" ? r4.date : "-"})`
);

// Hebdo échu depuis longtemps → dû maintenant → demain.
const r5 = computeNextPayout(
  { ...base, lastAutoPayoutAt: "2026-06-01T06:00:00Z" },
  NOW
);
ok(
  r5.kind === "scheduled" && r5.date === "2026-06-28T06:00:00.000Z",
  "Fenêtre échue depuis longtemps → prochain cron (demain)"
);

console.log(`\n${pass} ✅  ${fail} ❌`);
process.exit(fail ? 1 : 0);
