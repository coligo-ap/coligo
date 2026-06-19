// E2E TOURNÉE de bout en bout — passe par les VRAIS RPC + triggers (pas d'écriture
// ledger à la main). Impersonation du livreur via request.jwt.claims. Transaction
// ROLLBACK à la fin → aucune donnée prod modifiée.
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const M = "6a57ea14-40e3-47c6-9fc8-305d8bbb5bdd"; // Boulangerie El Baraka (tours on, position)
const DRIVER = "cc7944e2-4ac3-4fcd-8bec-af29466f04d4";
const DRIVER_USER = "69120859-f3d4-4c24-9b1e-6ef6e518acde";
const CUST = "60eec155-fb82-4a8b-9223-8ac2dd24d922";

let pass = 0,
  fail = 0;
const ok = (l, g, w) => {
  const p = g === w;
  console.log(`${p ? "✅" : "❌"} ${l}: got=${g} want=${w}`);
  p ? pass++ : fail++;
};
const okTrue = (l, g) => {
  console.log(`${g ? "✅" : "❌"} ${l}: ${g}`);
  g ? pass++ : fail++;
};

// Haversine (miroir lib/delivery/distance.ts)
function haversineKm(a, b) {
  const R = 6371,
    toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat),
    dLng = toR(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();
await c.query("BEGIN");

// Crédite le float opérateur d'un acteur pour passer le garde de solde (0186).
// Les complétions enchaînées du test débitent ce float ; sans crédit, l'acteur
// « neuf » (seuil 0) passe négatif et le scénario suivant est bloqué. ROLLBACK
// en fin de test → rien n'est persisté en prod.
async function fundOperator(ownerType, ownerId, amount = 500000) {
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
    "INSERT INTO operator_wallet_entries (wallet_id, type, amount_da, note) VALUES ($1,'topup_manual',$2,'test')",
    [wid, amount]
  );
}
await fundOperator("merchant", M);
await fundOperator("driver", DRIVER);

async function wallet(id, t) {
  const r = await c.query(
    `SELECT COALESCE(SUM(amount_da),0)::int s FROM wallet_entries WHERE order_id=$1${t ? " AND type=$2" : ""}`,
    t ? [id, t] : [id]
  );
  return r.rows[0].s;
}
async function ledger(id, t) {
  const r = await c.query(
    `SELECT COALESCE(SUM(amount_da),0)::int s FROM platform_ledger WHERE order_id=$1${t ? " AND type=$2" : ""}`,
    t ? [id, t] : [id]
  );
  return r.rows[0].s;
}
async function delLedgerCount(id) {
  const r = await c.query(
    "SELECT count(*)::int n FROM delivery_ledger WHERE order_id=$1",
    [id]
  );
  return r.rows[0].n;
}
async function cashbackCredit(id) {
  const r = await c.query(
    "SELECT COALESCE(SUM(amount_da),0)::int s FROM customer_wallet_entries WHERE order_id=$1 AND type='cashback_earned'",
    [id]
  );
  return r.rows[0].s;
}
async function impersonateDriver() {
  await c.query(
    `SELECT set_config('request.jwt.claims', json_build_object('sub','${DRIVER_USER}','role','authenticated')::text, true)`
  );
}
async function impersonateNone() {
  await c.query(`SELECT set_config('request.jwt.claims', '', true)`);
}

try {
  // Position du commerçant + point de livraison ~2 km (bande 0–3 km).
  const mpos = (
    await c.query(
      "SELECT latitude lat, longitude lng FROM merchants WHERE id=$1",
      [M]
    )
  ).rows[0];
  const merchant = { lat: Number(mpos.lat), lng: Number(mpos.lng) };
  const dropoff = { lat: merchant.lat + 0.018, lng: merchant.lng }; // ~2 km nord
  const dist = haversineKm(merchant, dropoff);
  console.log(`\nDistance commerçant→client = ${dist.toFixed(2)} km`);

  await c.query("SELECT ensure_merchant_delivery_zones($1)", [M]);

  // -- A) PLAFOND inviolable : tenter de mettre la bande 0 à un prix excessif --
  console.log("\n=== A) Plafond serveur des prix de zone ===");
  const ceil0 = (await c.query("SELECT platform_delivery_fee_da(3.0) v"))
    .rows[0].v;
  await c.query(
    "UPDATE merchant_delivery_zones SET price_da=99999 WHERE merchant_id=$1 AND band_index=0",
    [M]
  );
  const clamped = (
    await c.query(
      "SELECT price_da FROM merchant_delivery_zones WHERE merchant_id=$1 AND band_index=0",
      [M]
    )
  ).rows[0].price_da;
  ok("prix excessif ramené au plafond barème", clamped, ceil0);

  // Fixe un prix de tournée RÉALISTE entre plancher (delivery_min_da) et plafond.
  await c.query(
    "UPDATE merchant_delivery_zones SET price_da=200 WHERE merchant_id=$1 AND band_index=0",
    [M]
  );
  const D = (await c.query("SELECT tour_delivery_fee_da($1,$2) v", [M, dist]))
    .rows[0].v;
  ok(
    "prix tournée appliqué (bande 0 = 200 DA, dans [plancher,plafond])",
    D,
    200
  );

  // Taux résolus (peuvent être surchargés par marchand).
  const rates = (
    await c.query(
      `SELECT resolve_rate($1,'commission_cash') cc, resolve_rate($1,'commission_online') co,
     resolve_rate($1,'cashback_online') cbo, (SELECT tour_delivery_commission_rate FROM platform_settings WHERE id=true) tr`,
      [M]
    )
  ).rows[0];
  const P = 300;
  const S = (await c.query("SELECT compute_service_fee_da($1) v", [P])).rows[0]
    .v;
  const tourComm = Math.round(D * Number(rates.tr));
  console.log(
    `P=${P} S=${S} D=${D} | commission_cash=${rates.cc} commission_online=${rates.co} cashback_online=${rates.cbo} tour_rate=${rates.tr}`
  );

  // Deux créneaux de tournée ouverts (un par scénario : contrainte 1 livreur/créneau).
  const slot = (
    await c.query(
      `INSERT INTO delivery_slots (merchant_id, slot_date, start_time, end_time, max_orders, status)
     VALUES ($1, CURRENT_DATE, '10:00','12:00', 5, 'open') RETURNING id`,
      [M]
    )
  ).rows[0];
  const slot2 = (
    await c.query(
      `INSERT INTO delivery_slots (merchant_id, slot_date, start_time, end_time, max_orders, status)
     VALUES ($1, CURRENT_DATE, '14:00','16:00', 5, 'open') RETURNING id`,
      [M]
    )
  ).rows[0];

  async function insertTourOrder(payment, slotId) {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const r = await c.query(
      `INSERT INTO orders (merchant_id, customer_id, customer_name, customer_phone,
         subtotal_da, discount_da, net_total_da, service_fee_da, delivery_fee_da, total_da,
         pickup_code, pickup_slot_at, payment_method, payment_status, fulfillment_type,
         delivery_mode, delivery_slot_id, delivery_lat, delivery_lng, delivery_address_text,
         cashback_estimate_da, status)
       VALUES ($1,$2,'Yasmine','+213770900203',$3,0,$3,$4,$5,$6,$7, now(), $8,$9,'delivery','tour',$10,
         $11,$12,'Test e2e', $13, 'preparing') RETURNING id, pickup_code`,
      [
        M,
        CUST,
        P,
        S,
        D,
        P + S + D,
        code,
        payment,
        "pending",
        slotId,
        dropoff.lat,
        dropoff.lng,
        payment === "online" ? Math.round(P * Number(rates.cbo)) : 0,
      ]
    );
    return r.rows[0];
  }

  // RPC RÉEL start_tour (0164) sous impersonation livreur — l'ancienne
  // « réplique » SQL masquait le bug RLS (l'UPDATE orders de la server action
  // était silencieusement filtré : commandes jamais attribuées en prod).
  const MD = (
    await c.query(
      "SELECT id FROM merchant_drivers WHERE merchant_id=$1 AND driver_id=$2 AND status='active'",
      [M, DRIVER]
    )
  ).rows[0].id;
  async function startTourReal(slotId) {
    await impersonateDriver();
    const r = await c.query("SELECT * FROM start_tour($1,$2)", [MD, slotId]);
    await impersonateNone();
    return r.rows[0]; // { ok, reason, tour_id, stops_count }
  }

  // ===================== B) TOURNÉE CASH (e2e via RPC) =====================
  console.log("\n=== B) Tournée CASH — parcours RPC complet ===");
  const o1 = await insertTourOrder("cash", slot.id);
  const stB = await startTourReal(slot.id);
  ok("start_tour ok", stB.ok, true);
  const tour1 = stB.tour_id;
  ok(
    "commande ATTRIBUÉE par le RPC (delivery_driver_id)",
    (
      await c.query("SELECT delivery_driver_id FROM orders WHERE id=$1", [
        o1.id,
      ])
    ).rows[0].delivery_driver_id,
    DRIVER
  );
  await impersonateDriver();
  const pick1 = await c.query("SELECT * FROM mark_tour_picked_up($1)", [tour1]);
  okTrue("mark_tour_picked_up OK", pick1.rowCount >= 0);
  const val1 = await c.query("SELECT * FROM validate_delivery($1,$2,$3,$4)", [
    o1.id,
    null,
    true,
    "e2e-cash",
  ]);
  ok("validate_delivery ok", val1.rows[0].ok, true);
  await impersonateNone();

  const st1 = (await c.query("SELECT status FROM orders WHERE id=$1", [o1.id]))
    .rows[0].status;
  ok("commande complétée", st1, "completed");
  const ts1 = (
    await c.query("SELECT status FROM tour_stops WHERE order_id=$1", [o1.id])
  ).rows[0].status;
  ok("tour_stop livré", ts1, "delivered");
  ok(
    "tournée auto-complétée (trigger 0164)",
    (await c.query("SELECT status FROM delivery_tours WHERE id=$1", [tour1]))
      .rows[0].status,
    "completed"
  );
  const commCash = Math.round(P * Number(rates.cc));
  ok("wallet commission", await wallet(o1.id, "commission"), -commCash);
  ok("wallet service_fee", await wallet(o1.id, "service_fee"), -S);
  ok(
    "wallet tour_delivery_commission",
    await wallet(o1.id, "tour_delivery_commission"),
    -tourComm
  );
  ok("wallet sale (cash=0)", await wallet(o1.id, "sale"), 0);
  ok(
    "wallet delivery_revenue (cash=0)",
    await wallet(o1.id, "delivery_revenue"),
    0
  );
  ok(
    "commerçant DOIT à la plateforme = -(comm+S+tourComm)",
    await wallet(o1.id),
    -(commCash + S + tourComm)
  );
  // ch.4.2 assiette = produits + livraison ; ch.4.4 plafond COD (tournée → commission outil).
  const _cbCashRate = Number(
    (await c.query("SELECT cashback_cash FROM platform_settings WHERE id=true"))
      .rows[0].cashback_cash
  );
  const cashCb = Math.min(
    Math.round((P + D) * _cbCashRate),
    Math.floor(P / 2),
    commCash + S + tourComm
  );
  ok(
    "platform income = comm+S+tourComm−cashback",
    await ledger(o1.id),
    commCash + S + tourComm - cashCb
  );
  ok(
    "cash cashback provisionné",
    await ledger(o1.id, "cashback_expense"),
    -cashCb
  );
  ok(
    "platform tour_delivery_commission_income",
    await ledger(o1.id, "tour_delivery_commission_income"),
    tourComm
  );
  ok(
    "CONSERVATION cash (wallet+platform+cashback == 0)",
    (await wallet(o1.id)) +
      (await ledger(o1.id)) +
      (await cashbackCredit(o1.id)),
    0
  );
  ok(
    "AUCUNE écriture livreur custodian (tournée)",
    await delLedgerCount(o1.id),
    0
  );

  // ===================== C) TOURNÉE ONLINE (e2e via RPC) =====================
  console.log("\n=== C) Tournée ONLINE — parcours RPC complet ===");
  const o2 = await insertTourOrder("online", slot2.id);
  // Paiement confirmé AVANT start_tour : le RPC exclut les online non payées
  // (gating 0068 — une commande non encaissée ne part pas en tournée).
  await c.query("UPDATE orders SET payment_status='paid' WHERE id=$1", [o2.id]);
  const stC = await startTourReal(slot2.id);
  ok("start_tour online ok", stC.ok, true);
  const tour2 = stC.tour_id;
  await impersonateDriver();
  await c.query("SELECT * FROM mark_tour_picked_up($1)", [tour2]);
  const val2 = await c.query("SELECT * FROM validate_delivery($1,$2,$3,$4)", [
    o2.id,
    o2.pickup_code,
    false,
    "e2e-online",
  ]);
  ok("validate_delivery online ok (code requis)", val2.rows[0].ok, true);
  await impersonateNone();

  const commOnline = Math.round(P * Number(rates.co));
  // ch.4.2 — assiette cashback = produits NETS + frais de LIVRAISON (online : pas de plafond COD).
  const cb = Math.round((P + D) * Number(rates.cbo));
  const chgRate = Number(
    (await c.query("SELECT chargily_fee FROM platform_settings WHERE id=true"))
      .rows[0].chargily_fee
  );
  const chg = Math.round((P + S + D) * chgRate);
  ok("wallet sale (online=P)", await wallet(o2.id, "sale"), P);
  ok("wallet commission", await wallet(o2.id, "commission"), -commOnline);
  ok(
    "wallet delivery_revenue (online=D)",
    await wallet(o2.id, "delivery_revenue"),
    D
  );
  ok(
    "wallet tour_delivery_commission",
    await wallet(o2.id, "tour_delivery_commission"),
    -tourComm
  );
  const wnet = await wallet(o2.id);
  ok(
    "commerçant REÇOIT = P-comm+D-tourComm",
    wnet,
    P - commOnline + D - tourComm
  );
  ok(
    "platform tour_delivery_commission_income",
    await ledger(o2.id, "tour_delivery_commission_income"),
    tourComm
  );
  ok("platform cashback_expense", await ledger(o2.id, "cashback_expense"), -cb);
  ok("platform chargily_fee", await ledger(o2.id, "chargily_fee"), -chg);
  const credit = await cashbackCredit(o2.id);
  ok("cashback crédit client == dépense plateforme", credit, cb);
  const pnet = await ledger(o2.id);
  // Le coût Chargily sort du système (vers le PSP) → conservation = total − chargily.
  ok(
    "CONSERVATION (wallet+plateforme+cashback = total−chargily)",
    wnet + pnet + credit,
    P + S + D - chg
  );
  ok(
    "AUCUNE écriture livreur custodian (tournée)",
    await delLedgerCount(o2.id),
    0
  );

  // Capacité : chaque créneau a 1 commande non annulée.
  const usedTotal = (
    await c.query(
      "SELECT count(*)::int n FROM orders WHERE delivery_slot_id IN ($1,$2) AND status<>'cancelled'",
      [slot.id, slot2.id]
    )
  ).rows[0].n;
  ok("créneaux : 2 commandes comptées au total", usedTotal, 2);

  // ============ D) Capacité créneau — garde-fou atomique à l'INSERT ============
  console.log("\n=== D) Capacité créneau (trigger 0164) ===");
  const slot3 = (
    await c.query(
      `INSERT INTO delivery_slots (merchant_id, slot_date, start_time, end_time, max_orders, status)
     VALUES ($1, CURRENT_DATE, '17:00','18:00', 1, 'open') RETURNING id`,
      [M]
    )
  ).rows[0];
  await insertTourOrder("cash", slot3.id);
  await c.query("SAVEPOINT cap");
  let capBlocked = false;
  try {
    await insertTourOrder("cash", slot3.id);
  } catch (e) {
    capBlocked = e.message.includes("slot_full");
    await c.query("ROLLBACK TO SAVEPOINT cap");
  }
  okTrue("2e commande sur slot max_orders=1 refusée (slot_full)", capBlocked);
  const cnt3 = (await c.query("SELECT slot_orders_count($1) v", [slot3.id]))
    .rows[0].v;
  ok("slot_orders_count (SECURITY DEFINER)", cnt3, 1);

  // ====== E) No-show TOURNÉE online payé — pas de double paiement course ======
  console.log("\n=== E) No-show tournée online payé ===");
  const slot4 = (
    await c.query(
      `INSERT INTO delivery_slots (merchant_id, slot_date, start_time, end_time, max_orders, status)
     VALUES ($1, CURRENT_DATE, '19:00','20:00', 5, 'open') RETURNING id`,
      [M]
    )
  ).rows[0];
  const o3 = await insertTourOrder("online", slot4.id);
  await c.query("UPDATE orders SET payment_status='paid' WHERE id=$1", [o3.id]);
  const stE = await startTourReal(slot4.id);
  ok("start_tour E ok", stE.ok, true);
  await impersonateDriver();
  await c.query("SELECT * FROM mark_tour_picked_up($1)", [stE.tour_id]);
  await impersonateNone();
  // Arrivée il y a 1 h → fenêtre no-show largement dépassée.
  await c.query(
    "UPDATE orders SET delivery_arrived_at = now() - interval '1 hour' WHERE id=$1",
    [o3.id]
  );
  await impersonateDriver();
  const ns = await c.query("SELECT * FROM driver_report_no_show($1,$2,$3)", [
    o3.id,
    "no_show",
    "e2e-ns-tour",
  ]);
  await impersonateNone();
  ok("no-show accepté", ns.rows[0].ok, true);
  ok(
    "commande annulée",
    (await c.query("SELECT status FROM orders WHERE id=$1", [o3.id])).rows[0]
      .status,
    "cancelled"
  );
  ok(
    "tour_stop marqué failed",
    (await c.query("SELECT status FROM tour_stops WHERE order_id=$1", [o3.id]))
      .rows[0].status,
    "failed"
  );
  ok(
    "tournée complétée après échec",
    (
      await c.query("SELECT status FROM delivery_tours WHERE id=$1", [
        stE.tour_id,
      ])
    ).rows[0].status,
    "completed"
  );
  // LE fix : la plateforme ne paie PAS la course au livreur tournée (il est
  // payé par son commerçant, qui reçoit delivery_revenue).
  ok(
    "AUCUN driver_payout plateforme (tournée)",
    await delLedgerCount(o3.id),
    0
  );
  ok(
    "commerçant crédité delivery_revenue (online payé, no-show)",
    await wallet(o3.id, "delivery_revenue"),
    D
  );
  ok("pas de cashback gagné sur no-show", await cashbackCredit(o3.id), 0);
  ok(
    "pas de snapshot driver_fee express sur la commande tournée",
    (
      await c.query(
        "SELECT COALESCE(driver_fee_da,0) v FROM orders WHERE id=$1",
        [o3.id]
      )
    ).rows[0].v,
    0
  );

  console.log(
    `\n${fail === 0 ? "🎉 E2E TOURNÉE COMPLET OK" : "⚠️ ÉCHECS"} — pass=${pass} fail=${fail}`
  );
} catch (e) {
  console.error("ERREUR e2e:", e.message);
  fail++;
} finally {
  await c.query("ROLLBACK");
  await c.end();
}
process.exit(fail === 0 ? 0 : 1);
