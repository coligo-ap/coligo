// =============================================================================
// Test e2e (ROLLBACK) — exception « online/prépayé » du gating opérateur (0270).
// operator_gating ACTIVÉ + opérateur forcé sous le seuil :
//   COMMERÇANT  : commande online permise / cash bloquée
//   LIVREUR     : livraison online permise / express COD (cash) bloquée
//   CHAUFFEUR   : offre sur course coligo_pay permise / cash bloquée
// Tout en SAVEPOINTs + ROLLBACK final → aucune donnée prod modifiée.
// Lancer : node scripts/test-operator-online-exception.mjs
// =============================================================================
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const MERCHANT = "6a57ea14-40e3-47c6-9fc8-305d8bbb5bdd";
const CUST = "60eec155-fb82-4a8b-9223-8ac2dd24d922";
const DRIVER = "cc7944e2-4ac3-4fcd-8bec-af29466f04d4";
const CHAUFFEUR = "5a1471cd-13ea-4e5a-a4a1-79691e5859ef";
const LAT = 36.7558,
  LNG = 5.07;

let pass = 0,
  fail = 0;
const okTrue = (l, cond) => {
  console.log(`${cond ? "✅" : "❌"} ${l}`);
  cond ? pass++ : fail++;
};

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();
await c.query("BEGIN");

let spN = 0;
async function sp(fn) {
  const n = `sp${spN++}`;
  await c.query(`SAVEPOINT ${n}`);
  try {
    await fn();
    await c.query(`RELEASE SAVEPOINT ${n}`);
    return { ok: true };
  } catch (e) {
    await c.query(`ROLLBACK TO SAVEPOINT ${n}`);
    return { ok: false, err: e.message };
  }
}

const code = () => String(1000 + Math.floor(Math.random() * 9000));

// Commande RETRAIT (pickup) cash/online — pour le gate COMMERÇANT (7c).
const insPickup = (pm) =>
  c.query(
    `INSERT INTO orders (merchant_id,customer_id,customer_name,customer_phone,
       subtotal_da,discount_da,net_total_da,service_fee_da,delivery_fee_da,total_da,
       commission_da,pickup_code,pickup_slot_at,payment_method,payment_status,
       fulfillment_type,status)
     VALUES ($1,$2,'T','+213770000000',1000,0,1000,50,0,1050,0,$3,now(),
       $4,'pending','pickup','pending')`,
    [MERCHANT, CUST, code(), pm]
  );

// Commande LIVRAISON express assignée à un livreur — pour le gate LIVREUR (7a).
const insDeliveryAssigned = (pm) =>
  c.query(
    `INSERT INTO orders (merchant_id,customer_id,customer_name,customer_phone,
       subtotal_da,discount_da,net_total_da,service_fee_da,delivery_fee_da,total_da,
       commission_da,pickup_code,pickup_slot_at,payment_method,payment_status,
       fulfillment_type,status,delivery_mode,delivery_lat,delivery_lng,delivery_driver_id)
     VALUES ($1,$2,'T','+213770000000',1000,0,1000,50,200,1250,0,$3,now(),
       $4,'pending','delivery','pending','express',$5,$6,$7)`,
    [MERCHANT, CUST, code(), pm, LAT, LNG, DRIVER]
  );

const mkRide = async (pm) =>
  (
    await c.query(
      `INSERT INTO rides (customer_id,status,pickup_lat,pickup_lng,dest_lat,dest_lng,
         distance_km,suggested_price_da,proposed_price_da,payment_method)
       VALUES ($1,'completed',$2,$3,$4,$5,5,500,500,$6) RETURNING id`,
      [CUST, LAT, LNG, LAT + 0.05, LNG + 0.05, pm]
    )
  ).rows[0].id;

const insOffer = (rideId) =>
  c.query(
    "INSERT INTO ride_offers (ride_id, chauffeur_id, price_da) VALUES ($1,$2,500)",
    [rideId, CHAUFFEUR]
  );

async function forceBlocked(ownerType, ownerId) {
  const w = (
    await c.query("SELECT ensure_operator_wallet($1,$2) id", [
      ownerType,
      ownerId,
    ])
  ).rows[0].id;
  await c.query(
    "INSERT INTO operator_wallet_entries (wallet_id,type,amount_da,note) VALUES ($1,'adjustment',-100000000,'TEST blocage')",
    [w]
  );
}
const canOperate = async (t, id) =>
  (
    await c.query("SELECT can_operate FROM operator_wallet_state($1,$2)", [
      t,
      id,
    ])
  ).rows[0]?.can_operate;

try {
  await c.query(
    "UPDATE feature_flags SET status='active' WHERE key='operator_gating'"
  );

  // ───────────────── COMMERÇANT (gate 7c) ─────────────────
  console.log("── Commerçant ──");
  await c.query("SAVEPOINT m");
  await forceBlocked("merchant", MERCHANT);
  okTrue(
    "commerçant sous le seuil (can_operate=false)",
    (await canOperate("merchant", MERCHANT)) === false
  );
  okTrue("cmd ESPÈCES bloquée", !(await sp(() => insPickup("cash"))).ok);
  okTrue("cmd EN LIGNE permise", (await sp(() => insPickup("online"))).ok);
  await c.query("ROLLBACK TO SAVEPOINT m");

  // ───────────────── LIVREUR (gate 7a) ─────────────────
  console.log("── Livreur ──");
  await c.query("SAVEPOINT d");
  await forceBlocked("driver", DRIVER);
  okTrue(
    "livreur sous le seuil (can_operate=false)",
    (await canOperate("driver", DRIVER)) === false
  );
  const dCash = await sp(() => insDeliveryAssigned("cash"));
  okTrue("livraison COD espèces bloquée", !dCash.ok);
  okTrue(
    "livraison EN LIGNE permise",
    (await sp(() => insDeliveryAssigned("online"))).ok
  );
  await c.query("ROLLBACK TO SAVEPOINT d");

  // ───────────────── CHAUFFEUR (gate 7b) ─────────────────
  console.log("── Chauffeur ──");
  const rideCash = await mkRide("cash");
  const ridePrepaid = await mkRide("coligo_pay");
  await c.query("SAVEPOINT ch");
  await forceBlocked("chauffeur", CHAUFFEUR);
  okTrue(
    "chauffeur sous le seuil (can_operate=false)",
    (await canOperate("chauffeur", CHAUFFEUR)) === false
  );
  okTrue(
    "offre course ESPÈCES bloquée",
    !(await sp(() => insOffer(rideCash))).ok
  );
  okTrue(
    "offre course PRÉPAYÉE (coligo_pay) permise",
    (await sp(() => insOffer(ridePrepaid))).ok
  );
  await c.query("ROLLBACK TO SAVEPOINT ch");

  // ───────────────── Dormant : tout repasse ─────────────────
  console.log("── Gating dormant (hidden) ──");
  await c.query(
    "UPDATE feature_flags SET status='hidden' WHERE key='operator_gating'"
  );
  await c.query("SAVEPOINT off");
  await forceBlocked("merchant", MERCHANT);
  okTrue(
    "dormant → cmd espèces permise malgré le solde",
    (await sp(() => insPickup("cash"))).ok
  );
  await c.query("ROLLBACK TO SAVEPOINT off");
} finally {
  await c.query("ROLLBACK");
  await c.end();
}

console.log(`\n${pass} ✅  ${fail} ❌`);
process.exit(fail ? 1 : 0);
