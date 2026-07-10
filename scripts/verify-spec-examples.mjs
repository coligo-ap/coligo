// =============================================================================
// VÉRIFICATION DES 3 EXEMPLES CHIFFRÉS — SPEC-COLIGO-PAY (après alignement 0207).
// Exerce le VRAI moteur (insert + complétion) en transaction ROLLBACK.
//   node scripts/verify-spec-examples.mjs
// Sort en code 1 si un seul chiffre ne tombe pas juste (au dinar près).
// =============================================================================
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const M = "6a57ea14-40e3-47c6-9fc8-305d8bbb5bdd";
const DRIVER = "cc7944e2-4ac3-4fcd-8bec-af29466f04d4";
const DRIVER_USER = "69120859-f3d4-4c24-9b1e-6ef6e518acde";
const CUST = "60eec155-fb82-4a8b-9223-8ac2dd24d922";

let fail = 0;
const ok = (l, g, w) => {
  const p = Number(g) === Number(w);
  console.log(`  ${p ? "✅" : "❌"} ${l}: got=${g} want=${w}`);
  if (!p) fail++;
};

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();
await c.query("BEGIN");
// Priorité dispatch neutralisée pour ce test (ROLLBACK) — on ne teste pas la priorité.
await c.query(
  "UPDATE platform_settings SET dispatch_priority_delay_sec = 0 WHERE id = true"
);

async function fund(ownerType, ownerId, amount = 500000) {
  await c.query("SELECT ensure_operator_wallet($1,$2,now())", [
    ownerType,
    ownerId,
  ]);
  const wid = (
    await c.query(
      "SELECT id FROM operator_wallets WHERE owner_type=$1 AND owner_id=$2",
      [ownerType, ownerId]
    )
  ).rows[0].id;
  await c.query(
    "INSERT INTO operator_wallet_entries (wallet_id, type, amount_da, note) VALUES ($1,'topup_manual',$2,'verify')",
    [wid, amount]
  );
  // `operator_can_operate` refuse un portefeuille non `active` AVANT même de
  // regarder le solde : créditer ne suffit pas. Le livreur de test traînait un
  // statut `suspended` posé hors des tests, ce qui faisait échouer l'attribution
  // sur « Solde insuffisant » — un message trompeur. Tout est annulé au ROLLBACK.
  await c.query("UPDATE operator_wallets SET status='active' WHERE id=$1", [
    wid,
  ]);
}
const orderField = async (id, col) =>
  (await c.query(`SELECT ${col} v FROM orders WHERE id=$1`, [id])).rows[0].v;
const dl = async (id, type) =>
  (
    await c.query(
      "SELECT COALESCE(SUM(amount_da),0)::int s FROM delivery_ledger WHERE order_id=$1 AND type=$2",
      [id, type]
    )
  ).rows[0].s;
const pl = async (id, type) =>
  (
    await c.query(
      "SELECT COALESCE(SUM(amount_da),0)::int s FROM platform_ledger WHERE order_id=$1 AND type=$2",
      [id, type]
    )
  ).rows[0].s;
const we = async (id, type) =>
  (
    await c.query(
      "SELECT COALESCE(SUM(amount_da),0)::int s FROM wallet_entries WHERE order_id=$1 AND type=$2",
      [id, type]
    )
  ).rows[0].s;

try {
  await fund("merchant", M);
  await fund("driver", DRIVER);

  // ───────────────────────────────────────────────────────────────────────
  // EXEMPLE 1 — Express COD 1350 (1000 produits + 300 livraison + 50 service)
  // ───────────────────────────────────────────────────────────────────────
  console.log("\n=== EXEMPLE 1 — Express COD 1350 (P=1000, D=300, S=50) ===");
  const code1 = "1357";
  const o1 = (
    await c.query(
      `INSERT INTO orders (merchant_id, customer_id, customer_name, customer_phone,
         subtotal_da, discount_da, net_total_da, service_fee_da, delivery_fee_da, total_da,
         cashback_used_da, topup_used_da, pickup_code, pickup_slot_at, payment_method,
         payment_status, fulfillment_type, delivery_mode, delivery_driver_id,
         delivery_lat, delivery_lng, delivery_address_text, status)
       VALUES ($1,$2,'Yasmine','+213770900203',1000,0,1000,50,300,1350,0,0,$3, now(),'cash','pending',
         'delivery','express',$4, 36.76,5.07,'Test','preparing') RETURNING id`,
      [M, CUST, code1, DRIVER]
    )
  ).rows[0];
  await c.query("UPDATE orders SET delivery_picked_up_at=now() WHERE id=$1", [
    o1.id,
  ]);
  await c.query(
    `SELECT set_config('request.jwt.claims', json_build_object('sub','${DRIVER_USER}','role','authenticated')::text, true)`
  );
  const v1 = await c.query("SELECT * FROM validate_delivery($1,$2,$3,$4)", [
    o1.id,
    null,
    true,
    "verify",
  ]);
  await c.query("SELECT set_config('request.jwt.claims', NULL, true)");
  ok("validate_delivery ok", v1.rows[0].ok, true);
  // En COD express (custodian), la commission produits est portée par la
  // réconciliation livreur (driver_owes_*), pas par orders.commission_da.
  ok(
    "commission produits = 80 (P − ce que reçoit le commerçant)",
    1000 - (await dl(o1.id, "driver_owes_merchant")),
    80
  );
  ok(
    "commerçant reçoit (P − commission) = 920",
    await dl(o1.id, "driver_owes_merchant"),
    920
  );
  ok(
    "commission livraison livreur = 24",
    await orderField(o1.id, "driver_fee_da"),
    24
  );
  ok("livreur garde (D − fee) = 276", await dl(o1.id, "driver_payout"), 276);
  ok(
    "Coligo encaisse (comm+fee+service) = 154",
    await dl(o1.id, "driver_owes_platform"),
    154
  );
  ok(
    "cashback client = 39 (3% × (1000+300))",
    await orderField(o1.id, "cashback_da"),
    39
  );

  // ───────────────────────────────────────────────────────────────────────
  // EXEMPLE 2 — Tournée 1180 (1000 produits + 180 livraison tournée), online
  // ───────────────────────────────────────────────────────────────────────
  console.log("\n=== EXEMPLE 2 — Tournée online (P=1000, D=180, S=0) ===");
  const o2 = (
    await c.query(
      `INSERT INTO orders (merchant_id, customer_id, customer_name, customer_phone,
         subtotal_da, discount_da, net_total_da, service_fee_da, delivery_fee_da, total_da,
         cashback_used_da, topup_used_da, pickup_code, pickup_slot_at, payment_method,
         payment_status, fulfillment_type, delivery_mode, delivery_driver_id,
         delivery_lat, delivery_lng, delivery_address_text, status)
       VALUES ($1,$2,'Yasmine','+213770900203',1000,0,1000,0,180,1180,0,0,$3, now(),'online','paid',
         'delivery','tour',NULL, 36.76,5.07,'Test','preparing') RETURNING id`,
      [M, CUST, "2468"]
    )
  ).rows[0];
  await c.query("UPDATE orders SET status='completed' WHERE id=$1", [o2.id]);
  ok("commission produits = 80", await we(o2.id, "commission"), -80);
  ok(
    "commission outil tournée = 7 (4% × 180, soit 7,2→7)",
    await we(o2.id, "tour_delivery_commission"),
    -7
  );
  ok(
    "Coligo encaisse du commerçant = 87 (80 + 7)",
    (await pl(o2.id, "commission_income")) +
      (await pl(o2.id, "tour_delivery_commission_income")),
    87
  );
  ok(
    "cashback client = 35 (3% × (1000+180) = 35,4→35)",
    await orderField(o2.id, "cashback_da"),
    35
  );
  const expressFee = (await c.query("SELECT platform_delivery_fee_da(5.0) v"))
    .rows[0].v;
  ok("contrôle prix : 180 ≤ barème express", 180 <= expressFee ? 1 : 0, 1);

  // ───────────────────────────────────────────────────────────────────────
  // EXEMPLE 3 — Drive 350, chauffeur Gratuit (lancement : 0% / 0 / 0)
  // ───────────────────────────────────────────────────────────────────────
  console.log("\n=== EXEMPLE 3 — Drive 350, chauffeur Gratuit ===");
  // Chauffeur sans abonnement → resolve_vtc_commission = vtc_commission_rate (0).
  const chTmp = (
    await c.query(
      `INSERT INTO chauffeurs (user_id, full_name, first_name, phone, is_verified, vehicle_plate,
         vehicle_make, vehicle_model, vehicle_color, gamme)
       VALUES ('99999999-9999-4999-8999-999999999999','Verif Driver','Verif','+213700999001',true,
         '99999-V','Chevrolet','Beat','Blanche','classic') RETURNING id`
    )
  ).rows[0].id;
  const vtcRate = Number(
    (await c.query("SELECT resolve_vtc_commission($1) r", [chTmp])).rows[0].r
  );
  const cbDrive = Number(
    (
      await c.query(
        "SELECT drive_cashback_rate r FROM platform_settings WHERE id=true"
      )
    ).rows[0].r
  );
  const F3 = 350;
  ok(
    "commission chauffeur = 0 (Drive gratuit au lancement)",
    Math.round(F3 * vtcRate),
    0
  );
  ok("chauffeur garde 100% = 350", F3 - Math.round(F3 * vtcRate), 350);
  ok("cashback Drive = 0", Math.round(F3 * cbDrive), 0);
  ok(
    "Coligo encaisse = 0",
    Math.round(F3 * vtcRate) + Math.round(F3 * cbDrive),
    0
  );

  console.log(
    `\n${fail === 0 ? "🎉 LES 3 EXEMPLES TOMBENT JUSTE (au dinar près)" : "⚠️ ÉCHECS: " + fail}`
  );
} finally {
  await c.query("ROLLBACK");
  await c.end();
}
process.exit(fail === 0 ? 0 : 1);
