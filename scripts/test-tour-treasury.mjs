// Test d'invariants de trésorerie pour les triggers tournée/cashback (0118-0121).
// Simule 3 scénarios dans UNE transaction puis ROLLBACK (aucune donnée persistée).
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const MERCHANT = "18174433-8829-4c2d-8018-f58dceb3ea59";
const CUSTOMER = "60eec155-fb82-4a8b-9223-8ac2dd24d922";
const DRIVER = "17ad052c-f043-481c-86cf-87bff9fe9497";

const P = 300,
  S = 30,
  D = 340; // panier, frais service, livraison
let pass = 0,
  fail = 0;
function check(label, got, want) {
  const ok = got === want;
  console.log(`${ok ? "✅" : "❌"} ${label}: got=${got} want=${want}`);
  ok ? pass++ : fail++;
}

async function insertOrder(c, { mode, fulfillment, payment, withDriver }) {
  const code = Math.random().toString().slice(2, 8);
  const r = await c.query(
    `INSERT INTO orders (merchant_id, customer_id, customer_name, customer_phone,
       subtotal_da, discount_da, net_total_da, service_fee_da, delivery_fee_da,
       total_da, pickup_code, pickup_slot_at, payment_method, fulfillment_type,
       delivery_mode, delivery_driver_id, status, payment_status,
       delivery_lat, delivery_lng, delivery_address_text)
     VALUES ($1,$2,'Test','0600000000',$3,0,$3,$4,$5,$6,$7, now(), $8,$9,$10,$11,'preparing',$12,
       36.75, 3.06, 'Test adresse')
     RETURNING id`,
    [
      MERCHANT,
      CUSTOMER,
      P,
      S,
      D,
      P + S + D,
      code,
      payment,
      fulfillment,
      mode,
      withDriver ? DRIVER : null,
      payment === "online" ? "pending" : "pending",
    ]
  );
  return r.rows[0].id;
}

async function walletSum(c, id, type) {
  const r = await c.query(
    `SELECT COALESCE(SUM(amount_da),0)::int s FROM wallet_entries WHERE order_id=$1` +
      (type ? ` AND type=$2` : ``),
    type ? [id, type] : [id]
  );
  return r.rows[0].s;
}
async function ledgerSum(c, id, type) {
  const r = await c.query(
    `SELECT COALESCE(SUM(amount_da),0)::int s FROM platform_ledger WHERE order_id=$1` +
      (type ? ` AND type=$2` : ``),
    type ? [id, type] : [id]
  );
  return r.rows[0].s;
}
async function deliverySum(c, id, type) {
  const r = await c.query(
    `SELECT COALESCE(SUM(amount_da),0)::int s FROM delivery_ledger WHERE order_id=$1 AND type=$2`,
    [id, type]
  );
  return r.rows[0].s;
}
async function cashbackCredit(c, id) {
  const r = await c.query(
    `SELECT COALESCE(SUM(amount_da),0)::int s FROM customer_wallet_entries WHERE order_id=$1 AND type='cashback_earned'`,
    [id]
  );
  return r.rows[0].s;
}

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();
await c.query("BEGIN");
try {
  // ---- Scénario 1 : TOURNÉE ONLINE ----
  console.log("\n=== TOURNÉE ONLINE (P=300, S=30, D=340) ===");
  const o1 = await insertOrder(c, {
    mode: "tour",
    fulfillment: "delivery",
    payment: "online",
    withDriver: true,
  });
  await c.query("UPDATE orders SET payment_status='paid' WHERE id=$1", [o1]);
  await c.query("UPDATE orders SET status='completed' WHERE id=$1", [o1]);
  const comm = Math.round(P * 0.08),
    tour = Math.round(D * 0.08),
    // ch.4.2 — assiette cashback = produits NETS + frais de LIVRAISON (online : pas de plafond COD).
    cb = Math.round((P + D) * 0.03);
  // Frais Chargily (coût plateforme sur les commandes online) = round(total × taux).
  const settingsRow = (
    await c.query(
      "SELECT chargily_fee, cashback_cash FROM platform_settings WHERE id=true"
    )
  ).rows[0];
  const chg = Math.round((P + S + D) * Number(settingsRow.chargily_fee));
  // Cashback CASH (provisionné en charge sur les commandes cash hors-COD).
  // ch.4.2 assiette = produits + livraison ; ch.4.4 plafond COD (tournée → commission outil).
  const cashCb = Math.min(
    Math.round((P + D) * Number(settingsRow.cashback_cash)),
    Math.floor(P / 2),
    comm + S + tour
  );
  check("wallet sale", await walletSum(c, o1, "sale"), P);
  check("wallet commission", await walletSum(c, o1, "commission"), -comm);
  check(
    "wallet delivery_revenue",
    await walletSum(c, o1, "delivery_revenue"),
    D
  );
  check(
    "wallet tour_delivery_commission",
    await walletSum(c, o1, "tour_delivery_commission"),
    -tour
  );
  const wnet1 = await walletSum(c, o1);
  check("wallet NET (P-comm+D-tour)", wnet1, P - comm + D - tour);
  check(
    "ledger commission_income",
    await ledgerSum(c, o1, "commission_income"),
    comm
  );
  check(
    "ledger service_fee_income",
    await ledgerSum(c, o1, "service_fee_income"),
    S
  );
  check(
    "ledger tour_delivery_commission_income",
    await ledgerSum(c, o1, "tour_delivery_commission_income"),
    tour
  );
  check(
    "ledger cashback_expense",
    await ledgerSum(c, o1, "cashback_expense"),
    -cb
  );
  check("ledger chargily_fee", await ledgerSum(c, o1, "chargily_fee"), -chg);
  const pnet1 = await ledgerSum(c, o1);
  check(
    "platform NET (comm+S+tour−cashback−chargily)",
    pnet1,
    comm + S + tour - cb - chg
  );
  const credit1 = await cashbackCredit(c, o1);
  check("customer cashback credit == expense", credit1, cb);
  // Conservation : le coût Chargily SORT du système (vers le PSP) → total − chargily.
  check(
    "CONSERVATION (wallet+platform+cashback == total−chargily)",
    wnet1 + pnet1 + credit1,
    P + S + D - chg
  );
  check(
    "no delivery_ledger payout (tour)",
    await deliverySum(c, o1, "driver_payout"),
    0
  );

  // ---- Scénario 2 : TOURNÉE CASH ----
  console.log("\n=== TOURNÉE CASH ===");
  const o2 = await insertOrder(c, {
    mode: "tour",
    fulfillment: "delivery",
    payment: "cash",
    withDriver: true,
  });
  await c.query("UPDATE orders SET status='completed' WHERE id=$1", [o2]);
  check("wallet commission", await walletSum(c, o2, "commission"), -comm);
  check("wallet service_fee", await walletSum(c, o2, "service_fee"), -S);
  check(
    "wallet tour_delivery_commission",
    await walletSum(c, o2, "tour_delivery_commission"),
    -tour
  );
  check("wallet sale (cash=none)", await walletSum(c, o2, "sale"), 0);
  check(
    "wallet delivery_revenue (cash=none)",
    await walletSum(c, o2, "delivery_revenue"),
    0
  );
  check(
    "cash cashback provisionné (charge plateforme)",
    await ledgerSum(c, o2, "cashback_expense"),
    -cashCb
  );
  check("cash cashback crédité au client", await cashbackCredit(c, o2), cashCb);
  const wnet2 = await walletSum(c, o2);
  check("merchant OWES platform == -(comm+S+tour)", wnet2, -(comm + S + tour));
  check(
    "platform income == comm+S+tour−cashback",
    await ledgerSum(c, o2),
    comm + S + tour - cashCb
  );
  // Cash : le cash est hors-ledger (détenu par le marchand) → SUM ledger == 0.
  check(
    "CONSERVATION cash (wallet+platform+cashback == 0)",
    wnet2 + (await ledgerSum(c, o2)) + (await cashbackCredit(c, o2)),
    0
  );
  check(
    "no delivery_ledger payout (tour)",
    await deliverySum(c, o2, "driver_payout"),
    0
  );

  // ---- Scénario 3 : EXPRESS CASH (custodian, doit rester INCHANGÉ) ----
  console.log("\n=== EXPRESS CASH (custodian) ===");
  const o3 = await insertOrder(c, {
    mode: "express",
    fulfillment: "delivery",
    payment: "cash",
    withDriver: true,
  });
  await c.query("UPDATE orders SET status='completed' WHERE id=$1", [o3]);
  const driverFee = Math.max(
    10,
    Math.min(Math.round(D * 0.08), Math.round(D * 0.1))
  );
  check("NO merchant wallet entries (custodian)", await walletSum(c, o3), 0);
  check(
    "driver_owes_platform == comm+S+driver_fee",
    await deliverySum(c, o3, "driver_owes_platform"),
    comm + S + driverFee
  );
  check(
    "driver_owes_merchant == P-comm",
    await deliverySum(c, o3, "driver_owes_merchant"),
    P - comm
  );
  check(
    "driver_payout == D-driver_fee",
    await deliverySum(c, o3, "driver_payout"),
    D - driverFee
  );
  check(
    "driver_cash_collected == total",
    await deliverySum(c, o3, "driver_cash_collected"),
    P + S + D
  );

  console.log(
    `\n${fail === 0 ? "🎉 TOUS LES INVARIANTS OK" : "⚠️ ÉCHECS"} — pass=${pass} fail=${fail}`
  );
} finally {
  await c.query("ROLLBACK");
  await c.end();
}
process.exit(fail === 0 ? 0 : 1);
