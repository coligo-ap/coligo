// Parcours COMPLET d'une livraison EXPRESS en ESPÈCES, par les vraies RPC et les
// vrais triggers, avec le livreur réel « Yaxine » (0603044618).
//
// Vérifie de bout en bout :
//   • le garde d'attribution (`trg_gate_driver_assign`) — et que ses DEUX motifs
//     de refus disent la vérité (portefeuille suspendu ≠ solde insuffisant) ;
//   • le parcours : attribution → récupération → arrivée → PIN → livraison ;
//   • le PIN : mauvais code refusé, bon code accepté ;
//   • l'argent : commission livreur à 8 %, encaissement espèces, dette envers le
//     commerçant, et la conservation du grand livre.
//
// Transaction ROLLBACK : la production n'est pas touchée. Le seul état persistant
// dont dépend ce test est `operator_wallets.status = 'active'` pour ce livreur.
//
//   node scripts/test-driver-cash-flow.mjs

import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const DRIVER = "cc7944e2-4ac3-4fcd-8bec-af29466f04d4"; // Yaxine livreur
const DRIVER_USER = "69120859-f3d4-4c24-9b1e-6ef6e518acde";
const WALLET = "d27639e6-2149-4e9f-8e40-257a8e8b13a5";
const MERCHANT = "6a57ea14-40e3-47c6-9fc8-305d8bbb5bdd";
const CUSTOMER = "60eec155-fb82-4a8b-9223-8ac2dd24d922";

const P = 1000; // produits
const D = 300; // frais de livraison

let pass = 0;
let fail = 0;
const ok = (label, got, want) => {
  const good = got === want;
  console.log(`  ${good ? "✅" : "❌"} ${label}: got=${got} want=${want}`);
  good ? pass++ : fail++;
};
const okTrue = (label, cond) => {
  console.log(`  ${cond ? "✅" : "❌"} ${label}`);
  cond ? pass++ : fail++;
};

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();
await c.query("BEGIN");

const asDriver = () =>
  c.query(
    `SELECT set_config('request.jwt.claims', json_build_object('sub','${DRIVER_USER}','role','authenticated')::text, true)`
  );
const asNobody = () =>
  c.query(`SELECT set_config('request.jwt.claims','',true)`);

/** Commande express, espèces, prête à être récupérée. */
async function newCashOrder() {
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  const s = (await c.query("SELECT compute_service_fee_da($1) v", [P])).rows[0]
    .v;
  const r = await c.query(
    `INSERT INTO orders (merchant_id, customer_id, customer_name, customer_phone,
       subtotal_da, discount_da, net_total_da, service_fee_da, delivery_fee_da, total_da,
       pickup_code, pickup_slot_at, payment_method, payment_status, fulfillment_type,
       delivery_mode, delivery_lat, delivery_lng, delivery_address_text, status)
     VALUES ($1,$2,'Sonde cash','+213770000001',$3,0,$3,$4,$5,$6,$7,now(),
       'cash','pending','delivery','express',36.71,3.06,'Sonde','ready')
     RETURNING id, pickup_code`,
    [MERCHANT, CUSTOMER, P, s, D, P + s + D, code]
  );
  return r.rows[0];
}

/** Tente l'attribution ; renvoie null si acceptée, le message d'erreur sinon. */
async function assign(orderId) {
  await c.query("SAVEPOINT a");
  try {
    await c.query("UPDATE orders SET delivery_driver_id=$1 WHERE id=$2", [
      DRIVER,
      orderId,
    ]);
    return null;
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT a");
    return e.message;
  }
}

const ledger = async (orderId, type) =>
  (
    await c.query(
      "SELECT COALESCE(SUM(amount_da),0)::int s FROM delivery_ledger WHERE order_id=$1 AND type=$2",
      [orderId, type]
    )
  ).rows[0].s;

try {
  // ───────────────────────── État de départ ─────────────────────────
  console.log("\n=== 0) État du livreur et de son portefeuille ===");
  const d = (
    await c.query(
      "SELECT full_name, is_verified, is_frozen, is_blocked FROM drivers WHERE id=$1",
      [DRIVER]
    )
  ).rows[0];
  ok("compte vérifié", d.is_verified, true);
  ok("ni gelé", d.is_frozen, false);
  ok("ni bloqué", d.is_blocked, false);
  const w = (
    await c.query("SELECT status FROM operator_wallets WHERE id=$1", [WALLET])
  ).rows[0];
  ok("portefeuille actif", w.status, "active");
  okTrue(
    "le garde le laisse opérer",
    (
      await c.query("SELECT operator_can_operate_owner('driver',$1) v", [
        DRIVER,
      ])
    ).rows[0].v
  );

  // ───────────── Le garde d'attribution, dans ses deux refus ─────────────
  console.log("\n=== 1) Le garde d'attribution dit la vérité ===");
  await c.query("UPDATE operator_wallets SET status='suspended' WHERE id=$1", [
    WALLET,
  ]);
  const errSusp = await assign((await newCashOrder()).id);
  console.log(`     → ${errSusp}`);
  okTrue("portefeuille suspendu : attribution refusée", errSusp !== null);
  okTrue(
    "le message nomme le STATUT",
    /suspendu/.test(errSusp ?? "") && !/Solde insuffisant/.test(errSusp ?? "")
  );
  okTrue("et n'invite JAMAIS à recharger", !/recharg/i.test(errSusp ?? ""));

  await c.query("UPDATE operator_wallets SET status='active' WHERE id=$1", [
    WALLET,
  ]);
  await c.query(
    `INSERT INTO feature_flags (key, status) VALUES ('operator_gating','active')
     ON CONFLICT (key) DO UPDATE SET status='active'`
  );
  await c.query(
    "INSERT INTO operator_wallet_entries (wallet_id, type, amount_da, note) VALUES ($1,'fee_debit',$2,'sonde')",
    [WALLET, -100000]
  );
  const errBal = await assign((await newCashOrder()).id);
  console.log(`     → ${errBal}`);
  okTrue(
    "solde sous le seuil : le message parle bien de SOLDE",
    /Solde insuffisant/.test(errBal ?? "")
  );
  // On rétablit un portefeuille sain pour la suite.
  await c.query(
    `INSERT INTO operator_wallet_entries (wallet_id, type, amount_da, note) VALUES ($1,'topup_manual',$2,'sonde')`,
    [WALLET, 200000]
  );
  // `hidden` = drapeau éteint (`operator_gating_on()` n'est vrai que sur 'active').
  await c.query(
    "UPDATE feature_flags SET status='hidden' WHERE key='operator_gating'"
  );

  // ───────────────────────── Parcours nominal ─────────────────────────
  console.log("\n=== 2) Parcours complet : attribution → PIN → livraison ===");
  const order = await newCashOrder();
  okTrue(
    "attribution acceptée (portefeuille sain)",
    (await assign(order.id)) === null
  );

  await asDriver();

  const pick = (
    await c.query("SELECT * FROM mark_delivery_picked_up($1)", [order.id])
  ).rows[0];
  ok("commande récupérée chez le commerçant", pick.ok, true);
  // Le statut reste `ready` jusqu'à la livraison : c'est l'horodatage qui trace
  // le parcours, pas le statut.
  okTrue(
    "l'heure de récupération est horodatée",
    (
      await c.query(
        "SELECT delivery_picked_up_at IS NOT NULL v FROM orders WHERE id=$1",
        [order.id]
      )
    ).rows[0].v
  );

  const arr = (
    await c.query("SELECT * FROM mark_delivery_arrived($1)", [order.id])
  ).rows[0];
  ok("arrivée signalée au client", arr.ok, true);
  okTrue(
    "l'heure d'arrivée est horodatée (elle arme le minuteur no-show)",
    (
      await c.query(
        "SELECT delivery_arrived_at IS NOT NULL v FROM orders WHERE id=$1",
        [order.id]
      )
    ).rows[0].v
  );

  const bad = (
    await c.query("SELECT * FROM validate_delivery($1,$2,false,$3)", [
      order.id,
      "0000",
      "sonde-bad",
    ])
  ).rows[0];
  ok("mauvais PIN refusé", bad.reason, "bad_code");
  okTrue(
    "la commande n'est PAS livrée",
    (await c.query("SELECT status FROM orders WHERE id=$1", [order.id])).rows[0]
      .status !== "completed"
  );

  const good = (
    await c.query("SELECT * FROM validate_delivery($1,$2,false,$3)", [
      order.id,
      order.pickup_code,
      "sonde-good",
    ])
  ).rows[0];
  ok("bon PIN accepté", good.ok, true);
  ok(
    "commande livrée",
    (await c.query("SELECT status FROM orders WHERE id=$1", [order.id])).rows[0]
      .status,
    "completed"
  );

  await asNobody();

  // ───────────────────────── L'argent ─────────────────────────
  console.log(
    "\n=== 3) L'argent : commission 8 %, espèces, dette commerçant ==="
  );
  const o = (
    await c.query(
      `SELECT driver_fee_da, driver_fee_rate_applied, delivery_fee_da, net_total_da,
              service_fee_da, total_da
         FROM orders WHERE id=$1`,
      [order.id]
    )
  ).rows[0];
  const rate = Number(
    (
      await c.query(
        "SELECT driver_fee_rate v FROM platform_settings WHERE id=true"
      )
    ).rows[0].v
  );
  ok(
    "taux appliqué figé sur la commande",
    Number(o.driver_fee_rate_applied),
    rate
  );
  ok("taux de la plateforme = 8 %", rate, 0.08);
  ok(
    "commission livreur = 8 % de 300 DA",
    o.driver_fee_da,
    Math.round(D * rate)
  );

  const cash = await ledger(order.id, "driver_cash_collected");
  const owesMerchant = await ledger(order.id, "driver_owes_merchant");
  const owesPlatform = await ledger(order.id, "driver_owes_platform");
  const payout = await ledger(order.id, "driver_payout");
  console.log(
    `     espèces=${cash} · doit au commerçant=${owesMerchant} · doit à la plateforme=${owesPlatform} · payé=${payout}`
  );

  // Le livreur encaisse le TOTAL affiché au client (produits + service + livraison).
  ok("espèces encaissées = total de la commande", cash, o.total_da);
  // Ce qu'il doit au commerçant : les produits, moins la part que le commerçant
  // reverse à la plateforme. On vérifie le signe et l'ordre de grandeur, pas la
  // formule — elle appartient au ledger, testé par `test:driver:money`.
  okTrue("le livreur doit de l'argent au commerçant", owesMerchant !== 0);
  okTrue(
    "la commission livreur quitte sa poche",
    owesPlatform !== 0 || payout !== 0
  );

  // Ce que le livreur GARDE, c'est le prix de la livraison moins sa commission.
  ok("le livreur garde 300 − 24 = 276 DA", payout, D - o.driver_fee_da);

  // CONSERVATION — aucun dinar ne se crée ni ne disparaît : tout ce qu'il a
  // encaissé se répartit entre le commerçant, la plateforme et sa poche.
  ok(
    "conservation : espèces = dette commerçant + dette plateforme + sa part",
    cash,
    owesMerchant + owesPlatform + payout
  );

  // La plateforme prélève la commission du commerçant (8 % de 1000) ET la
  // commission du livreur (8 % de 300), toutes deux via la poche du livreur.
  ok(
    "dette plateforme = commission commerçant + commission livreur",
    owesPlatform,
    Math.round(P * rate) + o.driver_fee_da
  );
  ok(
    "dette commerçant = produits − sa commission",
    owesMerchant,
    P - Math.round(P * rate)
  );

  const outstanding = (
    await c.query("SELECT driver_outstanding($1) v", [DRIVER])
  ).rows[0].v;
  console.log(`     reste à devoir (driver_outstanding) = ${outstanding}`);
} catch (e) {
  console.error("\nERREUR parcours :", e.message);
  fail++;
} finally {
  await c.query("ROLLBACK");
  const after = (
    await c.query("SELECT status FROM operator_wallets WHERE id=$1", [WALLET])
  ).rows[0].status;
  const gating = (await c.query("SELECT operator_gating_on() g")).rows[0].g;
  console.log(
    `\nAprès ROLLBACK — portefeuille : ${after} · gating : ${gating} (état de prod intact)`
  );
  await c.end();
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
