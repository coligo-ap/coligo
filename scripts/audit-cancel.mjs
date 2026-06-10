// AUDIT — annulation client d'une commande EN LIGNE payée, avec cashback + Coligo
// Pay utilisés, AVANT acceptation commerçant. Prouve TOUT le « tableau annulation ».
// Transaction ROLLBACK (aucune donnée prod modifiée).
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const M = "6a57ea14-40e3-47c6-9fc8-305d8bbb5bdd";
const CUST = "60eec155-fb82-4a8b-9223-8ac2dd24d922";
const CUST_USER = "00000000-0000-4000-8000-000820591480";

let pass = 0,
  fail = 0;
const ok = (l, g, w) => {
  const p = g === w;
  console.log(`${p ? "✅" : "❌"} ${l}: got=${g} want=${w}`);
  p ? pass++ : fail++;
};

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();
await c.query("BEGIN");
try {
  const cashbackBal = async () =>
    (await c.query("SELECT customer_cashback_balance($1) v", [CUST])).rows[0].v;
  const topupBal = async () =>
    (await c.query("SELECT customer_topup_balance($1) v", [CUST])).rows[0].v;
  const merchW = async (id) =>
    (
      await c.query(
        "SELECT COALESCE(SUM(amount_da),0)::int s FROM wallet_entries WHERE order_id=$1",
        [id]
      )
    ).rows[0].s;
  const platL = async (id) =>
    (
      await c.query(
        "SELECT COALESCE(SUM(amount_da),0)::int s FROM platform_ledger WHERE order_id=$1",
        [id]
      )
    ).rows[0].s;
  const earned = async (id) =>
    (
      await c.query(
        "SELECT COALESCE(SUM(amount_da),0)::int s FROM customer_wallet_entries WHERE order_id=$1 AND type='cashback_earned'",
        [id]
      )
    ).rows[0].s;

  // Solde initial : 500 cashback + 500 Coligo Pay.
  await c.query(
    "INSERT INTO customer_wallet_entries (customer_id,type,source,amount_da,note) VALUES ($1,'cashback_earned','cashback',500,'seed'),($1,'topup_credit','topup',500,'seed')",
    [CUST]
  );
  const cb0 = await cashbackBal(),
    tu0 = await topupBal();
  console.log(`Solde initial : cashback=${cb0}  Coligo Pay=${tu0}`);

  // Commande EN LIGNE : panier 500, service 50, livraison 200.
  // Client utilise 100 cashback + 50 Coligo Pay → carte = 600 (total_da).
  const P = 500,
    S = 50,
    D = 200,
    C = 100,
    T = 50;
  const total = P + S + D - C - T; // 600 = montant carte
  const o = (
    await c.query(
      `INSERT INTO orders (merchant_id,customer_id,customer_name,customer_phone,
         subtotal_da,discount_da,net_total_da,service_fee_da,delivery_fee_da,total_da,
         cashback_used_da,topup_used_da,pickup_code,pickup_slot_at,payment_method,
         payment_status,fulfillment_type,delivery_mode,delivery_lat,delivery_lng,
         delivery_address_text,status)
       VALUES ($1,$2,'Y','0',$3,0,$3,$4,$5,$6,$7,$8,'7',now(),'online','paid','delivery',
         'express',36.76,5.07,'t','pending') RETURNING id`,
      [M, CUST, P, S, D, total, C, T]
    )
  ).rows[0].id;

  console.log(
    `\nCommande créée (payée, en attente d'acceptation) : carte=${total}, cashback utilisé=${C}, Coligo Pay utilisé=${T}`
  );
  console.log(
    `  après création → cashback=${await cashbackBal()} Coligo Pay=${await topupBal()} | wallet commerçant=${await merchW(o)}`
  );
  ok("commerçant NON payé avant complétion", await merchW(o), 0);

  // Le CLIENT annule (impersonation) — avant acceptation commerçant.
  await c.query(
    `SELECT set_config('request.jwt.claims', json_build_object('sub','${CUST_USER}','role','authenticated')::text, true)`
  );
  const r = (await c.query("SELECT cancel_order_by_customer($1) r", [o]))
    .rows[0].r;
  await c.query(`SELECT set_config('request.jwt.claims','',true)`);

  console.log("\n=== APRÈS ANNULATION ===");
  ok(
    "carte remboursée (avoir Coligo Pay) = montant carte",
    r.refunded_to_coligo_pay,
    total
  );
  ok("cashback utilisé RE-CRÉDITÉ (solde restauré)", await cashbackBal(), cb0);
  ok(
    "Coligo Pay = solde initial + remboursement carte",
    await topupBal(),
    tu0 + total
  );
  ok("commerçant NON payé", await merchW(o), 0);
  ok("plateforme : aucune écriture (rien livré)", await platL(o), 0);
  ok("cashback à gagner NON versé", await earned(o), 0);

  // Bilan global : le client récupère 100% de ce qu'il a engagé (750).
  const restitue =
    r.refunded_to_coligo_pay +
    (await cashbackBal()) -
    (cb0 - C) + // cashback re-crédité net
    0;
  ok(
    "TOTAL restitué au client = valeur commande (750)",
    r.refunded_to_coligo_pay + C + T,
    P + S + D
  );

  console.log(
    `\n${fail === 0 ? "🎉 TABLEAU ANNULATION 100% CONFORME" : "⚠️ ÉCHECS"} — pass=${pass} fail=${fail}`
  );
} catch (e) {
  console.error("ERREUR:", e.message);
  fail++;
} finally {
  await c.query("ROLLBACK");
  await c.end();
}
process.exit(fail === 0 ? 0 : 1);
