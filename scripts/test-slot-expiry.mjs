/**
 * Vérifie le masquage des créneaux de tournée déjà écoulés.
 *
 *  1. Tests déterministes de isSlotExpired (réplique exacte de lib/delivery/slots.ts).
 *  2. Aller-retour réel en base : insère un créneau PASSÉ (aujourd'hui, heure de
 *     fin dépassée) + un créneau FUTUR pour un commerçant, rejoue la requête
 *     exacte du checkout (.gte slot_date = today) + le filtre, et confirme que
 *     seul le créneau passé disparaît. Nettoyage en fin de test.
 */
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

// ── Réplique EXACTE de lib/delivery/slots.ts (logique testée) ───────────────
function nowInAlgiers() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(
    fmt.formatToParts(new Date()).map((x) => [x.type, x.value])
  );
  return new Date(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour === "24" ? "0" : p.hour),
    Number(p.minute),
    Number(p.second)
  );
}
function algiersDateAndTime() {
  const d = nowInAlgiers();
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}
function isSlotExpired(slot, ref = algiersDateAndTime()) {
  if (slot.slot_date < ref.date) return true;
  if (slot.slot_date > ref.date) return false;
  return slot.end_time.slice(0, 5) <= ref.time;
}

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

// ── 1. Tests déterministes ──────────────────────────────────────────────────
console.log("\n1) Logique isSlotExpired (ref = 2026-06-19 14:30)");
const ref = { date: "2026-06-19", time: "14:30" };
check(
  "date passée → expiré",
  isSlotExpired({ slot_date: "2026-06-18", end_time: "20:00:00" }, ref)
);
check(
  "aujourd'hui, fin 09:00 < 14:30 → expiré",
  isSlotExpired({ slot_date: "2026-06-19", end_time: "09:00:00" }, ref)
);
check(
  "aujourd'hui, fin 14:30 == 14:30 → expiré (>=)",
  isSlotExpired({ slot_date: "2026-06-19", end_time: "14:30:00" }, ref)
);
check(
  "aujourd'hui, fin 18:00 > 14:30 → actif",
  !isSlotExpired({ slot_date: "2026-06-19", end_time: "18:00:00" }, ref)
);
check(
  "date future → actif",
  !isSlotExpired({ slot_date: "2026-06-20", end_time: "08:00:00" }, ref)
);

// ── 2. Aller-retour réel en base ────────────────────────────────────────────
const client = new pg.Client({ connectionString: getDbUrl() });
const created = [];
try {
  await client.connect();
  console.log("\n2) Aller-retour DB (insertion créneau passé + futur)");

  const { rows: mrows } = await client.query(
    `SELECT id, name FROM public.merchants ORDER BY created_at LIMIT 1`
  );
  if (mrows.length === 0) throw new Error("Aucun commerçant en base.");
  const merchant = mrows[0];
  console.log(`   Commerçant : ${merchant.name} (${merchant.id})`);

  const now = algiersDateAndTime();
  const today = now.date;

  // Créneau PASSÉ : aujourd'hui, fin = il y a 5 min (si trop tôt dans la
  // journée, repli sur hier pour garantir un créneau réellement écoulé).
  let pastDate = today;
  let pastStart = "06:00";
  let pastEnd;
  const [h, m] = now.time.split(":").map(Number);
  const endMin = h * 60 + m - 5;
  if (endMin <= 6 * 60 + 1) {
    // trop tôt : on prend hier 06:00–07:00
    const y = new Date(nowInAlgiers().getTime() - 86400000);
    const pad = (n) => String(n).padStart(2, "0");
    pastDate = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;
    pastEnd = "07:00";
  } else {
    pastEnd = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
  }

  // Créneau FUTUR : demain 10:00–12:00.
  const tmr = new Date(nowInAlgiers().getTime() + 86400000);
  const pad = (n) => String(n).padStart(2, "0");
  const futureDate = `${tmr.getFullYear()}-${pad(tmr.getMonth() + 1)}-${pad(tmr.getDate())}`;

  const ins = await client.query(
    `INSERT INTO public.delivery_slots
        (merchant_id, slot_date, start_time, end_time, max_orders, status)
     VALUES ($1,$2,$3,$4,10,'open'), ($1,$5,'10:00','12:00',10,'open')
     RETURNING id, slot_date, end_time`,
    [merchant.id, pastDate, pastStart, pastEnd, futureDate]
  );
  for (const r of ins.rows) created.push(r.id);
  console.log(`   Inséré PASSÉ  : ${pastDate} ${pastStart}–${pastEnd}`);
  console.log(`   Inséré FUTUR  : ${futureDate} 10:00–12:00`);

  // Requête EXACTE du checkout : status='open' + slot_date >= today.
  const { rows: queried } = await client.query(
    `SELECT id, to_char(slot_date,'YYYY-MM-DD') AS slot_date,
            to_char(end_time,'HH24:MI') AS end_time
       FROM public.delivery_slots
      WHERE merchant_id = $1 AND status = 'open' AND slot_date >= $2
      ORDER BY slot_date, start_time`,
    [merchant.id, today]
  );

  const mine = queried.filter((r) => created.includes(r.id));
  const sqlReturnsPast = mine.some(
    (r) => r.slot_date === pastDate && r.end_time === pastEnd
  );
  check(
    "SQL (.gte date) renvoie ENCORE le créneau passé (sans le filtre)",
    pastDate === today ? sqlReturnsPast : true
  );

  const visible = queried.filter((r) => !isSlotExpired(r, now));
  const pastStillVisible = visible.some(
    (r) =>
      created.includes(r.id) &&
      r.slot_date === pastDate &&
      r.end_time === pastEnd
  );
  const futureVisible = visible.some(
    (r) => created.includes(r.id) && r.slot_date === futureDate
  );

  check("après filtre isSlotExpired : créneau PASSÉ masqué", !pastStillVisible);
  check("après filtre isSlotExpired : créneau FUTUR conservé", futureVisible);
} finally {
  if (created.length) {
    await client.query(`DELETE FROM public.delivery_slots WHERE id = ANY($1)`, [
      created,
    ]);
    console.log(
      `\n   🧹 Nettoyage : ${created.length} créneau(x) de test supprimé(s).`
    );
  }
  await client.end();
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} OK, ${fail} échec(s)\n`);
process.exit(fail === 0 ? 0 : 1);
