// Garde anti-fraude commerçant (mig 0166) : un commerçant ne peut PAS modifier
// les colonnes financières de SES commandes via une écriture PostgREST directe
// (contournement de l'UI), mais le changement de `status` reste autorisé et les
// fonctions internes (definer/service_role) écrivent normalement.
// Transaction ROLLBACK → aucune donnée prod modifiée.
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const M = "6a57ea14-40e3-47c6-9fc8-305d8bbb5bdd";
const CUST = "60eec155-fb82-4a8b-9223-8ac2dd24d922";

let pass = 0,
  fail = 0;
const ok = (l, g, w) => {
  const p = String(g) === String(w);
  console.log(`${p ? "✅" : "❌"} ${l}: got=${g} want=${w}`);
  p ? pass++ : fail++;
};

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();
await c.query("BEGIN");
try {
  const mu = (await c.query("SELECT user_id FROM merchants WHERE id=$1", [M]))
    .rows[0].user_id;

  // Commande CASH = visible au commerçant (online non payée serait masquée par
  // le gating 0068 → non modifiable de toute façon).
  const o = (
    await c.query(
      `INSERT INTO orders (merchant_id,customer_id,customer_name,customer_phone,
         subtotal_da,discount_da,net_total_da,service_fee_da,delivery_fee_da,total_da,
         commission_da,pickup_code,pickup_slot_at,payment_method,payment_status,
         fulfillment_type,status)
       VALUES ($1,$2,'T','+213770000000',1000,0,1000,50,0,1050,0,'1234',now(),
         'cash','pending','pickup','pending') RETURNING id`,
      [M, CUST]
    )
  ).rows[0];

  // --- Contexte COMMERÇANT (rôle authenticated + son JWT) ---
  await c.query(
    `SELECT set_config('request.jwt.claims', json_build_object('sub','${mu}','role','authenticated')::text, true)`
  );
  await c.query("SET LOCAL ROLE authenticated");

  // Tentative de fraude : gonfler/baisser les montants, forcer le paiement,
  // falsifier code/méthode.
  await c.query(
    `UPDATE orders SET total_da=999999, net_total_da=999999, commission_da=0,
       service_fee_da=0, payment_status='paid', pickup_code='0000',
       payment_method='online' WHERE id=$1`,
    [o.id]
  );
  // Changement de statut = SEUL write légitime du commerçant.
  const leg = await c.query("UPDATE orders SET status='accepted' WHERE id=$1", [
    o.id,
  ]);
  ok("status modifiable par le commerçant (flux légitime)", leg.rowCount, 1);
  await c.query("RESET ROLE");

  const r = (
    await c.query(
      `SELECT total_da,net_total_da,commission_da,service_fee_da,payment_status,
         payment_method,pickup_code,status FROM orders WHERE id=$1`,
      [o.id]
    )
  ).rows[0];
  ok("total_da neutralisé", r.total_da, 1050);
  ok("net_total_da neutralisé", r.net_total_da, 1000);
  ok("service_fee_da neutralisé", r.service_fee_da, 50);
  ok(
    "payment_status neutralisé (gating préservé)",
    r.payment_status,
    "pending"
  );
  ok("payment_method neutralisé", r.payment_method, "cash");
  ok("pickup_code neutralisé", r.pickup_code, "1234");
  ok("status bien appliqué", r.status, "accepted");

  // Les fonctions internes (rôle postgres/service_role) écrivent normalement :
  // la complétion calcule la commission sur le VRAI net (1000), jamais 999999.
  await c.query("UPDATE orders SET status='completed' WHERE id=$1", [o.id]);
  const comm = (
    await c.query(
      "SELECT COALESCE(SUM(amount_da),0)::int s FROM wallet_entries WHERE order_id=$1 AND type='commission'",
      [o.id]
    )
  ).rows[0].s;
  ok(
    "commission wallet basée sur le vrai net (≈-80, pas -80000)",
    comm <= -1 && comm > -1000,
    true
  );

  console.log(
    `\n${fail === 0 ? "🎉 GARDE COMMERÇANT OK" : "⚠️ ÉCHECS"} — pass=${pass} fail=${fail}`
  );
} catch (e) {
  console.error("ERREUR:", e.message);
  fail++;
} finally {
  await c.query("ROLLBACK");
  await c.end();
}
process.exit(fail === 0 ? 0 : 1);
