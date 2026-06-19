/**
 * Vérifie que les créneaux de RETRAIT n'exposent jamais un créneau passé.
 *
 * Contrairement à la tournée (lignes `delivery_slots` filtrées par date), les
 * créneaux de retrait sont GÉNÉRÉS à la volée à partir de `now + prep` — un
 * créneau passé n'est donc jamais produit. Ce test exerce le VRAI générateur
 * (lib/customer/pickup-slots.ts, importé via le strip-types de Node) + réplique
 * la règle de validation serveur (checkout/actions.ts : « Ce créneau est passé »).
 *
 * Lancer : node --experimental-strip-types scripts/test-pickup-slot-expiry.mjs
 */
import {
  generateTodaySlots,
  generateSlotsForRange,
  ymdKey,
} from "../lib/customer/pickup-slots.ts";

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

// Commerce ouvert 08:00–20:00 tous les jours.
const HOURS = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [
    d,
    [{ open: "08:00", close: "20:00" }],
  ])
);

// ── 1. Génération en milieu de journée : rien avant now + prep ───────────────
console.log("\n1) Génération à 14:07 (prep 20 min, créneaux 15 min)");
{
  const now = new Date("2026-06-19T14:07:00"); // vendredi après-midi
  const earliest = new Date(now.getTime() + 20 * 60_000); // 14:27
  const slots = generateTodaySlots(HOURS, {
    slotMinutes: 15,
    prepMinutes: 20,
    now,
  });
  check("au moins un créneau généré", slots.length > 0);
  check(
    "aucun créneau ne démarre avant maintenant",
    slots.every((s) => s.start.getTime() > now.getTime())
  );
  check(
    "aucun créneau avant 'now + prep' (14:27)",
    slots.every((s) => s.start.getTime() >= earliest.getTime())
  );
  check(
    "premier créneau = 14h30 (aligné sur 15 min après 14:27)",
    slots[0]?.label === "14h30"
  );
  check(
    "aucun créneau du matin passé (08h00) proposé",
    !slots.some((s) => s.label.startsWith("08h"))
  );
}

// ── 2. Commerce déjà fermé aujourd'hui : zéro créneau pour aujourd'hui ────────
console.log("\n2) Génération à 21:30 (après la fermeture 20:00)");
{
  const now = new Date("2026-06-19T21:30:00");
  const slots = generateTodaySlots(HOURS, {
    slotMinutes: 15,
    prepMinutes: 20,
    now,
  });
  check("aucun créneau aujourd'hui (commerce fermé)", slots.length === 0);
}

// ── 3. Programmation J+N : jours futurs OK, démarrent à l'ouverture ──────────
console.log("\n3) generateSlotsForRange à 14:07 (daysAhead = 2)");
{
  const now = new Date("2026-06-19T14:07:00");
  const map = generateSlotsForRange(HOURS, {
    slotMinutes: 15,
    prepMinutes: 20,
    daysAhead: 2,
    now,
  });
  const todayKey = ymdKey(now);
  const tmrKey = ymdKey(new Date(now.getTime() + 86400000));
  check("aujourd'hui présent dans la map", map.has(todayKey));
  check("demain présent dans la map", map.has(tmrKey));
  check(
    "1er créneau d'aujourd'hui = 14h30 (pas le matin)",
    map.get(todayKey)?.[0]?.label === "14h30"
  );
  check(
    "1er créneau de demain = 08h00 (ouverture pleine)",
    map.get(tmrKey)?.[0]?.label === "08h00"
  );

  // Tous les créneaux, tous jours confondus, sont strictement dans le futur.
  const allFuture = [...map.values()]
    .flat()
    .every((s) => s.start.getTime() > now.getTime());
  check("tous les créneaux (tous jours) sont dans le futur", allFuture);
}

// ── 4. Validation serveur : un créneau passé est rejeté ──────────────────────
// Réplique EXACTE de checkout/actions.ts:511 — instants absolus, donc sûr en
// timezone (pickup_slot_start est un ISO complet).
console.log("\n4) Validation serveur « Ce créneau est passé »");
{
  const isRejectedAsPast = (startISO) =>
    new Date(startISO).getTime() < Date.now() - 60_000;
  const past = new Date(Date.now() - 60 * 60_000).toISOString(); // -1 h
  const future = new Date(Date.now() + 60 * 60_000).toISOString(); // +1 h
  const justNow = new Date(Date.now()).toISOString();
  check("créneau il y a 1 h → rejeté", isRejectedAsPast(past));
  check("créneau dans 1 h → accepté", !isRejectedAsPast(future));
  check(
    "créneau ~maintenant → accepté (tolérance 60 s)",
    !isRejectedAsPast(justNow)
  );
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} OK, ${fail} échec(s)\n`);
process.exit(fail === 0 ? 0 : 1);
