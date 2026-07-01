// =============================================================================
// AUDIT D'INTÉGRITÉ LIVE (CLI) — invariants financiers & d'état sur la VRAIE base.
// -----------------------------------------------------------------------------
// LECTURE SEULE. Délègue à la fonction SQL `integrity_violations()` (mig 0298) —
// SOURCE UNIQUE des invariants, partagée avec le cron /api/cron/integrity (aucune
// dérive possible entre le CLI et la surveillance en prod). Elle ne renvoie que
// les invariants VIOLÉS (0 ligne = base saine).
//
// Invariants couverts (cf. 0298) : gating paiement en ligne (0068), soldes
// Coligo Pay / cashback non négatifs, SUM(ledger)==RPC, double-entrée SUM=0
// (P2P, paiement marchand, transferts opérateur), cohérence d'état.
//
// Exit 1 si une violation → utilisable en garde CI. Usage : `npm run audit:integrity`.
// =============================================================================
import { getDbUrl } from "./_supabase.mjs";
import pg from "pg";

const c = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});
await c.connect();

try {
  const { rows } = await c.query(
    "SELECT code, severity, cnt, detail FROM public.integrity_violations() ORDER BY severity, code"
  );
  if (rows.length === 0) {
    console.log("\n🎉 INTÉGRITÉ OK — aucun invariant violé.\n");
    process.exit(0);
  }
  console.log(`\n🚨 ${rows.length} INVARIANT(S) VIOLÉ(S) :\n`);
  for (const r of rows) {
    console.log(`  ❌ [${r.severity}] ${r.code} ×${r.cnt} — ${r.detail}`);
  }
  console.log();
  process.exit(1);
} finally {
  await c.end();
}
