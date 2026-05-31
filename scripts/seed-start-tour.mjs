#!/usr/bin/env node
/**
 * Crée une TOURNÉE en cours (delivery_tours + tour_stops) pour le livreur Yaxine
 * chez Superette el sar, à partir des 5 commandes `tour` du créneau du jour —
 * réplique exactement l'effet de l'action startTour (ordre greedy nearest +
 * status in_progress + assignation des commandes au livreur). Le livreur voit
 * alors une tournée à continuer (5 arrêts).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv() {
  let content;
  try {
    content = readFileSync(join(ROOT, ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv();

const { getDbUrl } = await import("./_supabase.mjs");
const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();

const MERCHANT = "9192b8e4-31d3-4490-8c9e-0826cc2cdcd2"; // Superette el sar
const DRIVER = "cc7944e2-4ac3-4fcd-8bec-af29466f04d4"; // Yaxine livreur
const MERCHANT_POS = { lat: 36.750974, lng: 5.064746 };

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// Greedy nearest-neighbor depuis le commerçant (comme orderByNearest).
function orderByNearest(start, points) {
  const remaining = [...points];
  const out = [];
  let cur = start;
  while (remaining.length) {
    let bi = 0;
    let bd = Infinity;
    remaining.forEach((p, i) => {
      const d = haversineKm(cur, p);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    const [nx] = remaining.splice(bi, 1);
    out.push(nx);
    cur = nx;
  }
  return out;
}

// Créneau du jour (le plus récent ouvert).
const slot = (
  await c.query(
    "select id from delivery_slots where merchant_id=$1 and slot_date='2026-05-30' and status='open' order by created_at desc limit 1",
    [MERCHANT]
  )
).rows[0];
if (!slot) {
  console.error("Aucun créneau du jour trouvé.");
  process.exit(1);
}

// Tournée déjà existante pour ce livreur/créneau ?
const ex = (
  await c.query(
    "select id,status from delivery_tours where slot_id=$1 and driver_id=$2",
    [slot.id, DRIVER]
  )
).rows[0];
if (ex && ex.status !== "cancelled") {
  console.log(
    `Tournée déjà existante (${ex.id}, ${ex.status}) — rien à faire.`
  );
  await c.end();
  process.exit(0);
}

const orders = (
  await c.query(
    `select id, delivery_lat lat, delivery_lng lng from orders
     where delivery_slot_id=$1 and delivery_mode='tour'
       and status not in ('cancelled','completed')`,
    [slot.id]
  )
).rows.map((o) => ({ id: o.id, lat: Number(o.lat), lng: Number(o.lng) }));

if (!orders.length) {
  console.error("Aucune commande tournée sur ce créneau.");
  process.exit(1);
}

const ordered = orderByNearest(MERCHANT_POS, orders);

const tour = (
  await c.query(
    `insert into delivery_tours (merchant_id, driver_id, slot_id, status, started_at)
     values ($1,$2,$3,'in_progress', now()) returning id`,
    [MERCHANT, DRIVER, slot.id]
  )
).rows[0];

for (let i = 0; i < ordered.length; i++) {
  await c.query(
    `insert into tour_stops (tour_id, order_id, stop_order, status)
     values ($1,$2,$3,'pending')`,
    [tour.id, ordered[i].id, i + 1]
  );
}

await c.query(
  `update orders set delivery_driver_id=$1 where id = any($2::uuid[])`,
  [DRIVER, ordered.map((o) => o.id)]
);

console.log(`✅ Tournée créée : ${tour.id}`);
console.log(`   ${ordered.length} arrêts (ordre optimisé) :`);
ordered.forEach((o, i) => console.log(`   ${i + 1}. ${o.id}`));
console.log(`   Créneau : ${slot.id}`);
console.log(
  `   Lien livreur : /driver/m/6bebce4b-7559-4a83-a194-a6168af44602/tours/${tour.id}`
);

await c.end();
