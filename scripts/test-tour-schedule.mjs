/**
 * Vérifie le planning de tournée RÉCURRENT (mig 0204) : matérialisation des
 * créneaux datés depuis le planning hebdomadaire via ensure_tour_slots().
 *
 * Tout se déroule dans UNE transaction terminée par ROLLBACK → aucun impact
 * sur les données de prod, aucun nettoyage manuel.
 */
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

let pass = 0;
let fail = 0;
function check(label, cond) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`);
  }
}

const client = new pg.Client({ connectionString: getDbUrl() });
const q = (sql, args) => client.query(sql, args);

try {
  await client.connect();
  await q("BEGIN");

  const { rows: mrows } = await q(
    `SELECT id, name FROM public.merchants ORDER BY created_at LIMIT 1`
  );
  if (!mrows.length) throw new Error("Aucun commerçant.");
  const mid = mrows[0].id;
  console.log(`Commerçant test : ${mrows[0].name}`);

  // Isolation : mode tournée ON, horizon 7 j, table rase (rollback ensuite).
  await q(
    `UPDATE public.merchants SET tours_enabled = true, max_days_ahead = 7 WHERE id = $1`,
    [mid]
  );
  await q(`DELETE FROM public.merchant_tour_schedule WHERE merchant_id = $1`, [
    mid,
  ]);
  await q(`DELETE FROM public.delivery_slots WHERE merchant_id = $1`, [mid]);

  const { rows: tr } = await q(
    `SELECT to_char((now() AT TIME ZONE 'Africa/Algiers')::date, 'YYYY-MM-DD') AS today`
  );
  const today = tr[0].today;
  const dayPlus = (n) => {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  // Planning : TOUS les jours de la semaine, une plage 09:00–11:00, cap 5.
  await q(
    `INSERT INTO public.merchant_tour_schedule (merchant_id, weekday, start_time, end_time, max_orders)
     SELECT $1, w, '09:00', '11:00', 5 FROM generate_series(0,6) AS w`,
    [mid]
  );

  // ── 1. Matérialisation sur l'horizon ───────────────────────────────────────
  console.log("\n1) ensure_tour_slots — génération sur 7 jours");
  await q(`SELECT public.ensure_tour_slots($1)`, [mid]);
  const { rows: gen } = await q(
    `SELECT to_char(slot_date,'YYYY-MM-DD') d,
            to_char(start_time,'HH24:MI') st, to_char(end_time,'HH24:MI') et,
            max_orders, status
       FROM public.delivery_slots WHERE merchant_id = $1 ORDER BY slot_date`,
    [mid]
  );
  check("8 occurrences générées (aujourd'hui → J+7)", gen.length === 8);
  check("première = aujourd'hui", gen[0]?.d === today);
  check("dernière = J+7", gen[gen.length - 1]?.d === dayPlus(7));
  check(
    "aucune occurrence à J+8 (hors horizon)",
    !gen.some((r) => r.d === dayPlus(8))
  );
  check(
    "horaires/capacité corrects (09:00–11:00, cap 5, open)",
    gen.every(
      (r) =>
        r.st === "09:00" &&
        r.et === "11:00" &&
        r.max_orders === 5 &&
        r.status === "open"
    )
  );

  // ── 2. Idempotence : re-run ne duplique pas ────────────────────────────────
  console.log("\n2) Idempotence");
  await q(`SELECT public.ensure_tour_slots($1)`, [mid]);
  const { rows: c2 } = await q(
    `SELECT count(*)::int n FROM public.delivery_slots WHERE merchant_id = $1`,
    [mid]
  );
  check("re-run : toujours 8 (pas de doublon)", c2[0].n === 8);

  // ── 3. Maj capacité quand le planning change ───────────────────────────────
  console.log("\n3) Mise à jour de capacité");
  await q(
    `UPDATE public.merchant_tour_schedule SET max_orders = 9 WHERE merchant_id = $1`,
    [mid]
  );
  await q(`SELECT public.ensure_tour_slots($1)`, [mid]);
  const { rows: cap } = await q(
    `SELECT max_orders FROM public.delivery_slots WHERE merchant_id = $1 AND slot_date = $2 LIMIT 1`,
    [mid, dayPlus(1)]
  );
  check(
    "capacité d'une occurrence future passée à 9",
    cap[0]?.max_orders === 9
  );

  // ── 4. Nettoyage d'une plage retirée (sans commande) ───────────────────────
  console.log("\n4) Retrait d'une plage → occurrence future supprimée");
  const dow1 = new Date(dayPlus(1) + "T00:00:00Z").getUTCDay(); // 0=dim..6=sam
  await q(
    `DELETE FROM public.merchant_tour_schedule WHERE merchant_id = $1 AND weekday = $2`,
    [mid, dow1]
  );
  await q(`SELECT public.ensure_tour_slots($1)`, [mid]);
  const { rows: gone } = await q(
    `SELECT count(*)::int n FROM public.delivery_slots WHERE merchant_id = $1 AND slot_date = $2`,
    [mid, dayPlus(1)]
  );
  check("occurrence du jour retiré supprimée", gone[0].n === 0);

  // ── 5. Mode tournée désactivé → aucune génération ──────────────────────────
  console.log("\n5) Mode tournée désactivé");
  await q(`UPDATE public.merchants SET tours_enabled = false WHERE id = $1`, [
    mid,
  ]);
  await q(`DELETE FROM public.delivery_slots WHERE merchant_id = $1`, [mid]);
  await q(`SELECT public.ensure_tour_slots($1)`, [mid]);
  const { rows: off } = await q(
    `SELECT count(*)::int n FROM public.delivery_slots WHERE merchant_id = $1`,
    [mid]
  );
  check("aucune occurrence générée (tours_enabled = false)", off[0].n === 0);
} finally {
  await q("ROLLBACK");
  await client.end();
  console.log("\n   ↩️  ROLLBACK : aucune donnée modifiée en base.");
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} OK, ${fail} échec(s)\n`);
process.exit(fail === 0 ? 0 : 1);
