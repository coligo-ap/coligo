// AUDIT — réconciliation du custodian livreur (COD) face au cashback gagné/dépensé.
// Transaction ROLLBACK. Prouve (ou réfute) une fuite quand cashback_cash>0 et/ou
// quand le client paie une partie en cashback/Coligo Pay sur une commande COD.
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const M = "6a57ea14-40e3-47c6-9fc8-305d8bbb5bdd";
const DRIVER = "cc7944e2-4ac3-4fcd-8bec-af29466f04d4";
const DRIVER_USER = "69120859-f3d4-4c24-9b1e-6ef6e518acde";
const CUST = "60eec155-fb82-4a8b-9223-8ac2dd24d922";

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();
await c.query("BEGIN");

async function dl(orderId, type) {
  const r = await c.query(
    "SELECT COALESCE(SUM(amount_da),0)::int s FROM delivery_ledger WHERE order_id=$1 AND type=$2",
    [orderId, type]
  );
  return r.rows[0].s;
}
async function cwe(orderId, type) {
  const r = await c.query(
    "SELECT COALESCE(SUM(amount_da),0)::int s FROM customer_wallet_entries WHERE order_id=$1 AND type=$2",
    [orderId, type]
  );
  return r.rows[0].s;
}
async function plat(orderId) {
  const r = await c.query(
    "SELECT COALESCE(SUM(amount_da),0)::int s FROM platform_ledger WHERE order_id=$1",
    [orderId]
  );
  return r.rows[0].s;
}
async function merchW(orderId) {
  const r = await c.query(
    "SELECT COALESCE(SUM(amount_da),0)::int s FROM wallet_entries WHERE order_id=$1",
    [orderId]
  );
  return r.rows[0].s;
}

async function scenario(label, { P, S, D, cashbackUsed, topupUsed }) {
  const total = P + S + D - cashbackUsed - topupUsed;
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  const prepaid = cashbackUsed > 0 || topupUsed > 0;
  const o = (
    await c.query(
      `INSERT INTO orders (merchant_id, customer_id, customer_name, customer_phone,
       subtotal_da, discount_da, net_total_da, service_fee_da, delivery_fee_da, total_da,
       cashback_used_da, topup_used_da, pickup_code, pickup_slot_at, payment_method,
       payment_status, fulfillment_type, delivery_mode, delivery_driver_id,
       delivery_lat, delivery_lng, delivery_address_text, status)
     VALUES ($1,$2,'Yasmine','+213770900203',$3,0,$3,$4,$5,$6,$7,$8,$9, now(),'cash','pending',
       'delivery','express',$10, 36.76,5.07,'Test', 'preparing') RETURNING id`,
      [M, CUST, P, S, D, total, cashbackUsed, topupUsed, code, DRIVER]
    )
  ).rows[0];

  // marquer arrivé/pickup (pas requis par validate_delivery 0116, mais réaliste)
  await c.query("UPDATE orders SET delivery_picked_up_at=now() WHERE id=$1", [
    o.id,
  ]);

  // impersonation livreur pour validate_delivery
  await c.query(
    `SELECT set_config('request.jwt.claims', json_build_object('sub','${DRIVER_USER}','role','authenticated')::text, true)`
  );
  const v = await c.query("SELECT * FROM validate_delivery($1,$2,$3,$4)", [
    o.id,
    prepaid ? code : null,
    !prepaid,
    "audit",
  ]);
  await c.query(`SELECT set_config('request.jwt.claims', '', true)`);

  const collected = await dl(o.id, "driver_cash_collected");
  const owesMerch = await dl(o.id, "driver_owes_merchant");
  const owesPlat = await dl(o.id, "driver_owes_platform");
  const payout = await dl(o.id, "driver_payout");
  const residual = collected - owesMerch - owesPlat - payout;
  const earned = await cwe(o.id, "cashback_earned");
  const spentCb = await cwe(o.id, "cashback_spent");
  const spentTu = await cwe(o.id, "topup_spent");

  console.log(`\n=== ${label} ===`);
  console.log(
    `  validate ok=${v.rows[0].ok} | P=${P} S=${S} D=${D} cashback_used=${cashbackUsed} topup_used=${topupUsed} | total payé cash=${total}`
  );
  console.log(
    `  LIVREUR : collecté=${collected}  doit_marchand=${owesMerch}  doit_plateforme=${owesPlat}  garde(payout)=${payout}`
  );
  console.log(
    `  → RÉSIDU livreur (collecté − doit_marchand − doit_plateforme − garde) = ${residual}  ${residual === 0 ? "✅ équilibré" : "❌ DÉSÉQUILIBRE"}`
  );
  console.log(
    `  CLIENT  : cashback gagné=${earned}  cashback dépensé=${spentCb}  topup dépensé=${spentTu}`
  );
  console.log(
    `  merchant wallet (doit être 0 en COD custodian)=${await merchW(o.id)} | platform_ledger=${await plat(o.id)}`
  );
  if (residual > 0)
    console.log(
      `  ⚠️ Le livreur GARDE ${residual} DA non remis (fuite vers le livreur = cashback gagné non réservé).`
    );
  if (residual < 0)
    console.log(
      `  ⚠️ Le livreur est COURT de ${-residual} DA (il a encaissé moins de cash que ce qu'il doit reverser).`
    );
}

try {
  // Donner au client un solde cashback + topup pour pouvoir en dépenser.
  await c.query(
    "INSERT INTO customer_wallet_entries (customer_id, type, source, amount_da, note) VALUES ($1,'cashback_earned','cashback',500,'audit'),($1,'topup_credit','topup',500,'audit')",
    [CUST]
  );

  await scenario("COD — cashback GAGNÉ seul (2% cash), aucune redemption", {
    P: 400,
    S: 30,
    D: 200,
    cashbackUsed: 0,
    topupUsed: 0,
  });
  await scenario("COD — client paie une partie en cashback + Coligo Pay", {
    P: 400,
    S: 30,
    D: 200,
    cashbackUsed: 100,
    topupUsed: 50,
  });

  // --- CASH NON-CUSTODIAN (retrait + tournée) avec redemption wallet ---
  // Le commerçant détient le cash → réconciliation = SUM(wallet+platform+client) = 0
  // (la plateforme reverse au commerçant le cashback/Coligo Pay dépensé).
  async function reconcileNonCustodian(label, { mode, fulfillment }) {
    const P = 400,
      S = 30,
      D = fulfillment === "delivery" ? 200 : 0,
      C = 100,
      T = 50;
    const total = P + S + D - C - T;
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const dm = fulfillment === "delivery" ? mode : null;
    const o = (
      await c.query(
        `INSERT INTO orders (merchant_id,customer_id,customer_name,customer_phone,
           subtotal_da,discount_da,net_total_da,service_fee_da,delivery_fee_da,total_da,
           cashback_used_da,topup_used_da,pickup_code,pickup_slot_at,payment_method,
           payment_status,fulfillment_type,delivery_mode,delivery_lat,delivery_lng,
           delivery_address_text,status)
         VALUES ($1,$2,'Y','0',$3,0,$3,$4,$5,$6,$7,$8,$9,now(),'cash','pending',$10,$11,
           36.76,5.07,'t','preparing') RETURNING id`,
        [M, CUST, P, S, D, total, C, T, code, fulfillment, dm]
      )
    ).rows[0];
    await c.query("UPDATE orders SET status='completed' WHERE id=$1", [o.id]);
    const w = await merchW(o.id);
    const pl = await plat(o.id);
    const cwd = (
      await c.query(
        "SELECT COALESCE(SUM(amount_da),0)::int s FROM customer_wallet_entries WHERE order_id=$1",
        [o.id]
      )
    ).rows[0].s;
    const red = (
      await c.query(
        "SELECT COALESCE(SUM(amount_da),0)::int s FROM wallet_entries WHERE order_id=$1 AND type='wallet_redemption'",
        [o.id]
      )
    ).rows[0].s;
    const sum = w + pl + cwd;
    console.log(
      `\n=== ${label} (cash + 100 cashback + 50 Coligo Pay) ===\n  reversé au commerçant=${red} | SUM(wallet+platform+client)=${sum} ${sum === 0 ? "✅ équilibré" : "❌ commerçant court de " + -sum}`
    );
  }
  await reconcileNonCustodian("RETRAIT cash", {
    mode: null,
    fulfillment: "pickup",
  });
  await reconcileNonCustodian("TOURNÉE cash", {
    mode: "tour",
    fulfillment: "delivery",
  });

  console.log(
    "\nRappel : custodian (express COD) → résidu livreur = 0 ; cash non-custodian → SUM ledger = 0."
  );
} catch (e) {
  console.error("ERREUR:", e.message);
} finally {
  await c.query("ROLLBACK");
  await c.end();
}
