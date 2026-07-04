// =============================================================================
// Vérification MONÉTAIRE & FONCTIONNELLE — livraison / no-show (audit 04/07/2026)
// =============================================================================
// Exécute TOUT dans UNE transaction puis ROLLBACK → la prod n'est JAMAIS touchée.
// Chaque scénario : on pose une commande, on déclenche les VRAIS triggers/RPC,
// puis on recalcule INDÉPENDAMMENT les montants attendus et on les compare aux
// écritures réelles (wallet_entries / platform_ledger / delivery_ledger /
// customer_wallet_entries) + on vérifie les identités de réconciliation.
//
//   node scripts/tests/noshow-money-verification.mjs
//
// Taux figés dans la transaction (déterministes, indépendants de la prod) :
//   commission 10 % · cashback 5 % · chargily 2 % · driver_fee 8 % (cap 10 %,
//   min 10) · commission tournée 4 % · minuteur no-show 8 min · géofence 150 m.
// =============================================================================

import { getDbUrl } from "../_supabase.mjs";
import pg from "pg";

const R = {
  comm: 0.1,
  cash: 0.05,
  charg: 0.02,
  dFeeRate: 0.08,
  dFeeCap: 0.1,
  dFeeMin: 10,
  tour: 0.04,
};
const round = (n) => Math.round(n);
const driverFee = (D) =>
  D <= 0
    ? 0
    : Math.min(
        D,
        Math.max(
          R.dFeeMin,
          Math.min(round(D * R.dFeeRate), round(D * R.dFeeCap))
        )
      );

let PASS = 0;
let FAIL = 0;
const fails = [];
function check(name, ok, detail = "") {
  if (ok) {
    PASS++;
    console.log(`  ✅ ${name}`);
  } else {
    FAIL++;
    fails.push(`${name} — ${detail}`);
    console.log(`  ❌ ${name}  ${detail}`);
  }
}
function eq(name, actual, expected) {
  check(name, actual === expected, `attendu ${expected}, obtenu ${actual}`);
}

const c = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});

// UUID helpers.
const uid = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });

async function q(sql, params) {
  return (await c.query(sql, params)).rows;
}

// Utilisateur auth minimal (FK user_id) — rollback en fin de transaction.
async function mkUser() {
  const id = uid();
  await q("INSERT INTO auth.users (id) VALUES ($1)", [id]);
  return id;
}

// Écritures d'une commande, par table (sommes par type).
async function ledger(orderId) {
  const out = { wallet: {}, platform: {}, delivery: {}, customer: {} };
  for (const r of await q(
    "SELECT type, sum(amount_da)::int s FROM wallet_entries WHERE order_id=$1 GROUP BY type",
    [orderId]
  ))
    out.wallet[r.type] = r.s;
  for (const r of await q(
    "SELECT type, sum(amount_da)::int s FROM platform_ledger WHERE order_id=$1 GROUP BY type",
    [orderId]
  ))
    out.platform[r.type] = r.s;
  for (const r of await q(
    "SELECT type, sum(amount_da)::int s FROM delivery_ledger WHERE order_id=$1 GROUP BY type",
    [orderId]
  ))
    out.delivery[r.type] = r.s;
  for (const r of await q(
    "SELECT type, sum(amount_da)::int s FROM customer_wallet_entries WHERE order_id=$1 GROUP BY type",
    [orderId]
  ))
    out.customer[r.type] = r.s;
  return out;
}
const sumObj = (o) => Object.values(o).reduce((a, b) => a + b, 0);

let MID, DRV, DRV_USER, CUST, CUST2, SLOT;

async function seedCommon() {
  MID = uid();
  DRV = uid();
  DRV_USER = await mkUser();
  CUST = uid();
  CUST2 = uid();
  await q(
    `INSERT INTO merchants (id, name, shop_public_id, slug, user_id, latitude, longitude, express_enabled)
     VALUES ($1,'TEST Boutique',$2,$3,$4, 36.75, 3.05, true)`,
    [MID, "TST" + MID.slice(0, 6), "test-" + MID.slice(0, 8), await mkUser()]
  );
  await q(
    `INSERT INTO drivers (id, full_name, phone, user_id, is_frozen, is_blocked)
     VALUES ($1,'TEST Livreur','0555000000',$2,false,false)`,
    [DRV, DRV_USER]
  );
  for (const cu of [CUST, CUST2])
    await q(
      `INSERT INTO customers (id, full_name, user_id, phone) VALUES ($1,'TEST Client',$2,'0555111111')`,
      [cu, await mkUser()]
    );
  // Créneau tournée (pour delivery_tours / tour_stops).
  SLOT = uid();
  await q(
    `INSERT INTO delivery_slots (id, merchant_id, slot_date, start_time, end_time, max_orders, status)
     VALUES ($1,$2, current_date, '10:00','12:00', 50, 'open')`,
    [SLOT, MID]
  );
}

// Crée une commande "prête, récupérée" et renvoie son id.
async function newOrder(o) {
  const id = uid();
  const P = o.P,
    S = o.S ?? 0,
    D = o.D ?? 0,
    R_ = o.redeemed ?? 0;
  const total = o.total ?? Math.max(0, P + S - R_ + D);
  await q(
    `INSERT INTO orders (id, merchant_id, customer_id, customer_name, customer_phone,
       status, payment_method, payment_status, pickup_code, pickup_slot_at,
       order_number, subtotal_da, discount_da, net_total_da, service_fee_da,
       delivery_fee_da, total_da, cashback_used_da, topup_used_da,
       fulfillment_type, delivery_mode, delivery_driver_id,
       delivery_lat, delivery_lng, delivery_picked_up_at, delivery_arrived_at)
     VALUES ($1,$2,$3,'TEST Client','0555111111',$4,$5,$6,'1234', now(),
       $7,$8,0,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [
      id,
      MID,
      o.customer ?? CUST,
      o.status ?? "ready",
      o.pm,
      o.ps ?? (o.pm === "online" ? "paid" : "pending"),
      "A" + id.slice(0, 4),
      P,
      S,
      D,
      total,
      o.cashback_used ?? 0,
      o.topup_used ?? 0,
      o.ff ?? (D > 0 ? "delivery" : "pickup"),
      o.mode ?? null,
      o.withDriver ? DRV : null,
      o.lat ?? 36.75,
      o.lng ?? 3.05,
      o.pickedUp === false ? null : (o.pickedUp ?? new Date().toISOString()),
      o.arrived ?? null,
    ]
  );
  return id;
}

async function complete(id) {
  await q(
    "UPDATE orders SET status='completed', delivery_delivered_at=now() WHERE id=$1",
    [id]
  );
}

// Crée un créneau + une tournée dédiés (contraintes UNIQUE slot_id+driver_id ET
// occurrence de créneau) et y rattache la commande via un arrêt 'pending'.
let slotSeq = 13;
async function mkTourStop(orderId) {
  const slot = uid();
  const h = slotSeq++; // fenêtre horaire distincte à chaque appel
  await q(
    `INSERT INTO delivery_slots (id, merchant_id, slot_date, start_time, end_time, max_orders, status)
     VALUES ($1,$2, current_date, make_time($3,0,0), make_time($3+1,0,0), 50, 'open')`,
    [slot, MID, h]
  );
  const tour = uid();
  await q(
    `INSERT INTO delivery_tours (id, driver_id, merchant_id, slot_id) VALUES ($1,$2,$3,$4)`,
    [tour, DRV, MID, slot]
  );
  await q(
    `INSERT INTO tour_stops (order_id, tour_id, stop_order, status) VALUES ($1,$2,1,'pending')`,
    [orderId, tour]
  );
}

// Appelle une RPC en tant que livreur (auth.uid() = DRV_USER).
async function asDriver(sql, params) {
  await q("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: DRV_USER, role: "authenticated" }),
  ]);
  await q("SET ROLE authenticated");
  try {
    return await q(sql, params);
  } finally {
    await q("RESET ROLE");
  }
}

async function run() {
  await c.connect();
  await q("BEGIN");
  try {
    // Taux déterministes (rollback → prod inchangée).
    await q(
      `UPDATE platform_settings SET commission_cash=$1, commission_online=$1,
         cashback_cash=$2, cashback_online=$2, chargily_fee=$3,
         driver_fee_rate=$4, driver_fee_cap_rate=$5, driver_fee_min_da=$6,
         tour_delivery_commission_rate=$7, noshow_wait_min=8, noshow_geofence_m=150,
         driver_float_cap_da=8000, max_debt_da=0 WHERE id=true`,
      [R.comm, R.cash, R.charg, R.dFeeRate, R.dFeeCap, R.dFeeMin, R.tour]
    );
    await seedCommon();

    const P = 1000,
      S = 20,
      D = 200;
    const comm = round(P * R.comm); // 100

    // ── A. MATRICE DE COMPLÉTION (calculs d'argent) ───────────────────────────
    console.log("\n▶ A. Matrice de complétion — écritures & réconciliation");

    // A1 Retrait CASH
    {
      const id = await newOrder({ P, S, pm: "cash", ff: "pickup" });
      await complete(id);
      const l = await ledger(id);
      const cbBase = P + 0; // pickup D=0
      const cb = Math.min(
        round(cbBase * R.cash),
        Math.floor(P / 2),
        comm + S + 0
      ); // 50
      eq("A1 cash retrait — wallet commission", l.wallet.commission, -comm);
      eq("A1 cash retrait — wallet service_fee", l.wallet.service_fee, -S);
      eq("A1 cash retrait — pas de sale", l.wallet.sale, undefined);
      eq(
        "A1 cash retrait — platform commission_income",
        l.platform.commission_income,
        comm
      );
      eq(
        "A1 cash retrait — platform service_fee_income",
        l.platform.service_fee_income,
        S
      );
      eq(
        "A1 cash retrait — cashback_expense",
        l.platform.cashback_expense,
        -cb
      );
      eq(
        "A1 cash retrait — client cashback_earned",
        l.customer.cashback_earned,
        cb
      );
      check(
        "A1 cash retrait — réconciliation Σ=0",
        sumObj(l.wallet) + sumObj(l.platform) + sumObj(l.customer) === 0,
        `wallet=${sumObj(l.wallet)} platform=${sumObj(l.platform)} cust=${sumObj(l.customer)}`
      );
    }

    // A2 Retrait ONLINE
    {
      const id = await newOrder({ P, S, pm: "online", ff: "pickup" });
      await complete(id);
      const l = await ledger(id);
      const total = P + S;
      const cb = round((P + 0) * R.cash); // 50 (online, sans plafond)
      eq("A2 online retrait — wallet sale", l.wallet.sale, P);
      eq("A2 online retrait — wallet commission", l.wallet.commission, -comm);
      eq(
        "A2 online retrait — platform chargily",
        l.platform.chargily_fee,
        -round(total * R.charg)
      );
      eq(
        "A2 online retrait — cashback_expense",
        l.platform.cashback_expense,
        -cb
      );
      eq("A2 online retrait — client cashback", l.customer.cashback_earned, cb);
    }

    // A3 Express COD (custodian) — identité clé
    {
      const id = await newOrder({
        P,
        S,
        D,
        pm: "cash",
        mode: "express",
        withDriver: true,
      });
      await complete(id);
      const l = await ledger(id);
      const total = P + S + D;
      const fee = driverFee(D); // 16
      const payout = D - fee; // 184
      const owesM = P - comm; // 900
      const owesP = comm + S + fee - 0; // 136
      const cb = Math.min(
        round((P + D) * R.cash),
        Math.floor(P / 2),
        comm + S + D
      ); // 60
      eq("A3 COD — driver_payout", l.delivery.driver_payout, payout);
      eq(
        "A3 COD — driver_cash_collected",
        l.delivery.driver_cash_collected,
        total
      );
      eq(
        "A3 COD — driver_owes_merchant",
        l.delivery.driver_owes_merchant,
        owesM
      );
      eq(
        "A3 COD — driver_owes_platform",
        l.delivery.driver_owes_platform,
        owesP
      );
      eq("A3 COD — pas de wallet commerçant", sumObj(l.wallet), 0);
      eq("A3 COD — cashback_expense", l.platform.cashback_expense, -cb);
      eq("A3 COD — client cashback", l.customer.cashback_earned, cb);
      const custodian =
        l.delivery.driver_cash_collected -
        l.delivery.driver_owes_merchant -
        l.delivery.driver_owes_platform -
        l.delivery.driver_payout;
      check(
        "A3 COD — IDENTITÉ custodian = 0",
        custodian === 0,
        `= ${custodian}`
      );
    }

    // A3b Express COD avec cashback DÉPENSÉ (redeemed) — identité tient toujours
    {
      // pré-financer le client (le trigger de dépense débite à l'INSERT).
      await q(
        `INSERT INTO customer_wallet_entries (customer_id, type, source, amount_da, note)
         VALUES ($1,'cashback_earned','cashback',300,'seed')`,
        [CUST2]
      );
      const redeemed = 200;
      const id = await newOrder({
        P,
        S,
        D,
        pm: "cash",
        mode: "express",
        withDriver: true,
        customer: CUST2,
        cashback_used: redeemed,
        redeemed, // total_da net des wallets (comme le checkout réel)
      });
      await complete(id);
      const l = await ledger(id);
      const fee = driverFee(D);
      const owesP = comm + S + fee - redeemed; // 100+20+16-200 = -64
      eq(
        "A3b COD redeemed — owes_platform (SIGNÉ)",
        l.delivery.driver_owes_platform,
        owesP
      );
      const total = P + S + D - redeemed; // cash réellement encaissé
      const custodian =
        l.delivery.driver_cash_collected -
        l.delivery.driver_owes_merchant -
        l.delivery.driver_owes_platform -
        l.delivery.driver_payout;
      eq(
        "A3b COD redeemed — cash_collected = total net",
        l.delivery.driver_cash_collected,
        total
      );
      check(
        "A3b COD redeemed — IDENTITÉ custodian = 0",
        custodian === 0,
        `= ${custodian}`
      );
    }

    // A4 Express ONLINE
    {
      const id = await newOrder({
        P,
        S,
        D,
        pm: "online",
        mode: "express",
        withDriver: true,
      });
      await complete(id);
      const l = await ledger(id);
      const total = P + S + D;
      eq(
        "A4 express online — driver_payout",
        l.delivery.driver_payout,
        D - driverFee(D)
      );
      eq("A4 express online — wallet sale", l.wallet.sale, P);
      eq("A4 express online — wallet commission", l.wallet.commission, -comm);
      eq(
        "A4 express online — chargily",
        l.platform.chargily_fee,
        -round(total * R.charg)
      );
      eq(
        "A4 express online — client cashback",
        l.customer.cashback_earned,
        round((P + D) * R.cash)
      );
    }

    // A5 Tournée CASH
    {
      const id = await newOrder({
        P,
        S,
        D,
        pm: "cash",
        mode: "tour",
        withDriver: true,
      });
      await complete(id);
      const l = await ledger(id);
      const tc = round(D * R.tour); // 8
      const cb = Math.min(
        round((P + D) * R.cash),
        Math.floor(P / 2),
        comm + S + tc
      ); // 60
      eq("A5 tour cash — wallet commission", l.wallet.commission, -comm);
      eq("A5 tour cash — wallet service_fee", l.wallet.service_fee, -S);
      eq(
        "A5 tour cash — tour_delivery_commission",
        l.wallet.tour_delivery_commission,
        -tc
      );
      eq(
        "A5 tour cash — pas de delivery_revenue (cash)",
        l.wallet.delivery_revenue,
        undefined
      );
      eq("A5 tour cash — pas de custodian livreur", sumObj(l.delivery), 0);
      eq(
        "A5 tour cash — platform tour_income",
        l.platform.tour_delivery_commission_income,
        tc
      );
      eq("A5 tour cash — client cashback", l.customer.cashback_earned, cb);
      check(
        "A5 tour cash — réconciliation Σ=0",
        sumObj(l.wallet) + sumObj(l.platform) + sumObj(l.customer) === 0,
        `w=${sumObj(l.wallet)} p=${sumObj(l.platform)} c=${sumObj(l.customer)}`
      );
    }

    // A6 Tournée ONLINE
    {
      const id = await newOrder({
        P,
        S,
        D,
        pm: "online",
        mode: "tour",
        withDriver: true,
      });
      await complete(id);
      const l = await ledger(id);
      const tc = round(D * R.tour);
      eq("A6 tour online — wallet sale", l.wallet.sale, P);
      eq("A6 tour online — delivery_revenue", l.wallet.delivery_revenue, D);
      eq(
        "A6 tour online — tour_delivery_commission",
        l.wallet.tour_delivery_commission,
        -tc
      );
      eq(
        "A6 tour online — platform tour_income",
        l.platform.tour_delivery_commission_income,
        tc
      );
    }

    // ── B. NO-SHOW ────────────────────────────────────────────────────────────
    console.log("\n▶ B. No-show — règles espèces/tournée/en ligne");

    const past = (min) => new Date(Date.now() - min * 60000).toISOString();

    // B1 Cash EXPRESS no-show : livreur non payé, avance réclamée, pénalité client
    {
      // client avec soldes pour la pénalité (cashback 120, topup 200).
      const cu = uid();
      await q(
        `INSERT INTO customers (id, full_name, user_id) VALUES ($1,'TEST',$2)`,
        [cu, await mkUser()]
      );
      await q(
        `INSERT INTO customer_wallet_entries (customer_id, type, source, amount_da) VALUES
         ($1,'cashback_earned','cashback',120),($1,'topup_credit','topup',200)`,
        [cu]
      );
      const id = await newOrder({
        P,
        S,
        D,
        pm: "cash",
        mode: "express",
        withDriver: true,
        customer: cu,
        arrived: past(30),
      });
      const res = await asDriver(
        "SELECT * FROM driver_report_no_show($1,'no_show',null)",
        [id]
      );
      check(
        "B1 cash express — RPC ok",
        res[0].ok === true,
        JSON.stringify(res[0])
      );
      const o = (
        await q(
          "SELECT status, delivery_no_show_kind FROM orders WHERE id=$1",
          [id]
        )
      )[0];
      eq("B1 cash express — statut cancelled", o.status, "cancelled");
      const l = await ledger(id);
      eq(
        "B1 cash express — AUCUN driver_payout",
        l.delivery.driver_payout,
        undefined
      );
      eq("B1 cash express — AUCUN crédit commerçant", sumObj(l.wallet), 0);
      eq(
        "B1 cash express — AUCUN cashback gagné",
        l.customer.cashback_earned,
        undefined
      );
      const claim = await q(
        "SELECT advance_da FROM driver_refund_claims WHERE order_id=$1",
        [id]
      );
      eq(
        "B1 cash express — avance réclamée = P−comm",
        claim[0]?.advance_da,
        P - comm
      );
      const pen = (
        await q(
          "SELECT COALESCE(sum(amount_da),0)::int s FROM customer_wallet_entries WHERE order_id IS NULL AND customer_id=$1 AND amount_da<0",
          [cu]
        )
      )[0].s;
      eq("B1 cash express — pénalité prélevée = D", pen, -D);
    }

    // B2 Cash TOURNÉE no-show : plateforme NEUTRE (rien nulle part)
    {
      const cu = uid();
      await q(
        `INSERT INTO customers (id, full_name, user_id) VALUES ($1,'TEST',$2)`,
        [cu, await mkUser()]
      );
      await q(
        `INSERT INTO customer_wallet_entries (customer_id, type, source, amount_da) VALUES ($1,'topup_credit','topup',500)`,
        [cu]
      );
      const nc0 = (
        await q("SELECT noshow_count FROM customers WHERE id=$1", [cu])
      )[0].noshow_count;
      const id = await newOrder({
        P,
        S,
        D,
        pm: "cash",
        mode: "tour",
        withDriver: true,
        customer: cu,
        arrived: past(30),
      });
      // tour + stop pending pour vérifier le passage à 'failed'.
      await mkTourStop(id);
      const res = await asDriver(
        "SELECT * FROM driver_report_no_show($1,'no_show',null)",
        [id]
      );
      check(
        "B2 tour cash — RPC ok",
        res[0].ok === true,
        JSON.stringify(res[0])
      );
      const l = await ledger(id);
      eq("B2 tour cash — AUCUN reversement commerçant", sumObj(l.wallet), 0);
      eq("B2 tour cash — AUCUNE pénalité client", sumObj(l.customer), 0);
      eq("B2 tour cash — AUCUN custodian", sumObj(l.delivery), 0);
      eq("B2 tour cash — AUCUNE écriture plateforme", sumObj(l.platform), 0);
      const st = (
        await q("SELECT status FROM tour_stops WHERE order_id=$1", [id])
      )[0].status;
      eq("B2 tour cash — stop 'failed'", st, "failed");
      const nc1 = (
        await q("SELECT noshow_count FROM customers WHERE id=$1", [cu])
      )[0].noshow_count;
      eq("B2 tour cash — compteur no-show +1", nc1, nc0 + 1);
    }

    // B3 driver_report_no_show sur ONLINE → 'use_leave_at_door'
    {
      const id = await newOrder({
        P,
        S,
        D,
        pm: "online",
        mode: "express",
        withDriver: true,
        arrived: past(30),
      });
      const res = await asDriver(
        "SELECT * FROM driver_report_no_show($1,'no_show',null)",
        [id]
      );
      eq("B3 online report → redirigé", res[0].reason, "use_leave_at_door");
      eq("B3 online report → non ok", res[0].ok, false);
      const st = (await q("SELECT status FROM orders WHERE id=$1", [id]))[0]
        .status;
      eq("B3 online report → commande NON annulée", st, "ready");
    }

    // B4 confirm_arrival — géofence
    {
      const id = await newOrder({
        P,
        S,
        D,
        pm: "online",
        mode: "express",
        withDriver: true,
        lat: 36.75,
        lng: 3.05,
      });
      const far = await asDriver(
        "SELECT * FROM driver_confirm_arrival($1, 36.80, 3.20)",
        [id]
      ); // ~14 km
      eq("B4 arrivée trop loin → too_far", far[0].reason, "too_far");
      const near = await asDriver(
        "SELECT * FROM driver_confirm_arrival($1, 36.7505, 3.0505)",
        [id]
      ); // ~60 m
      check(
        "B4 arrivée proche → ok",
        near[0].ok === true,
        JSON.stringify(near[0])
      );
      const arr = (
        await q("SELECT delivery_arrived_at FROM orders WHERE id=$1", [id])
      )[0];
      check("B4 delivery_arrived_at posé", arr.delivery_arrived_at != null);
    }

    // B5 leave_at_door — préconditions + succès + argent
    {
      const mk = () =>
        newOrder({
          P,
          S,
          D,
          pm: "online",
          mode: "express",
          withDriver: true,
          arrived: past(10),
        });
      // (a) sans appel → call_required
      let id = await mk();
      let r = await asDriver(
        "SELECT * FROM driver_leave_at_door($1,'http://x/p.jpg','n',null)",
        [id]
      );
      eq("B5a leave sans appel → call_required", r[0].reason, "call_required");
      // (b) appel mais sans message → message_required
      await asDriver("SELECT * FROM driver_note_call_attempt($1)", [id]);
      r = await asDriver(
        "SELECT * FROM driver_leave_at_door($1,'http://x/p.jpg','n',null)",
        [id]
      );
      eq(
        "B5b leave sans message → message_required",
        r[0].reason,
        "message_required"
      );
      // (c) message présent mais sans photo → photo_required
      await q(
        `INSERT INTO order_messages (order_id, sender_role, sender_user_id, body) VALUES ($1,'courier',$2,'Je suis arrivé')`,
        [id, DRV_USER]
      );
      r = await asDriver("SELECT * FROM driver_leave_at_door($1,'','n',null)", [
        id,
      ]);
      eq(
        "B5c leave sans photo → photo_required",
        r[0].reason,
        "photo_required"
      );
      // (d) toutes préconditions OK → livré (No-Show), argent versé
      r = await asDriver(
        "SELECT * FROM driver_leave_at_door($1,'http://x/proof.jpg','Déposé devant la porte',null)",
        [id]
      );
      check("B5d leave OK", r[0].ok === true, JSON.stringify(r[0]));
      const o = (
        await q(
          "SELECT status, delivery_no_show_kind, delivery_proof_url, delivery_proof_note FROM orders WHERE id=$1",
          [id]
        )
      )[0];
      eq("B5d statut completed", o.status, "completed");
      eq("B5d marqueur left_at_door", o.delivery_no_show_kind, "left_at_door");
      eq("B5d preuve enregistrée", o.delivery_proof_url, "http://x/proof.jpg");
      const l = await ledger(id);
      eq(
        "B5d livreur payé (payout)",
        l.delivery.driver_payout,
        D - driverFee(D)
      );
      eq("B5d commerçant payé (sale)", l.wallet.sale, P);
      eq(
        "B5d client garde son cashback",
        l.customer.cashback_earned,
        round((P + D) * R.cash)
      );
      // (e) trop tôt (minuteur non écoulé)
      const id2 = await newOrder({
        P,
        S,
        D,
        pm: "online",
        mode: "express",
        withDriver: true,
        arrived: past(1),
      });
      await asDriver("SELECT * FROM driver_note_call_attempt($1)", [id2]);
      await q(
        `INSERT INTO order_messages (order_id, sender_role, sender_user_id, body) VALUES ($1,'courier',$2,'arrivé')`,
        [id2, DRV_USER]
      );
      const rt = await asDriver(
        "SELECT * FROM driver_leave_at_door($1,'http://x/p.jpg','n',null)",
        [id2]
      );
      eq("B5e minuteur non écoulé → too_early", rt[0].reason, "too_early");
    }

    // B6 leave_at_door sur TOURNÉE online : commerçant payé, stop 'delivered'
    {
      const id = await newOrder({
        P,
        S,
        D,
        pm: "online",
        mode: "tour",
        withDriver: true,
        arrived: past(10),
      });
      await mkTourStop(id);
      await asDriver("SELECT * FROM driver_note_call_attempt($1)", [id]);
      await q(
        `INSERT INTO order_messages (order_id, sender_role, sender_user_id, body) VALUES ($1,'courier',$2,'arrivé')`,
        [id, DRV_USER]
      );
      const r = await asDriver(
        "SELECT * FROM driver_leave_at_door($1,'http://x/p.jpg','n',null)",
        [id]
      );
      check("B6 tour online leave OK", r[0].ok === true, JSON.stringify(r[0]));
      const l = await ledger(id);
      eq(
        "B6 tour online — delivery_revenue commerçant",
        l.wallet.delivery_revenue,
        D
      );
      eq(
        "B6 tour online — PAS de payout plateforme",
        l.delivery.driver_payout,
        undefined
      );
      const st = (
        await q("SELECT status FROM tour_stops WHERE order_id=$1", [id])
      )[0].status;
      eq("B6 tour online — stop 'delivered'", st, "delivered");
    }

    // B7 admin_confirm_online_noshow → payé comme livré
    {
      const id = await newOrder({
        P,
        S,
        D,
        pm: "online",
        mode: "express",
        withDriver: true,
        arrived: past(2),
      });
      const r = await q(
        "SELECT * FROM admin_confirm_online_noshow($1,'test@admin','support')",
        [id]
      );
      check("B7 admin confirm ok", r[0].ok === true, JSON.stringify(r[0]));
      const o = (
        await q(
          "SELECT status, delivery_no_show_kind FROM orders WHERE id=$1",
          [id]
        )
      )[0];
      eq("B7 statut completed", o.status, "completed");
      eq(
        "B7 marqueur support_confirmed",
        o.delivery_no_show_kind,
        "support_confirmed"
      );
      const l = await ledger(id);
      eq("B7 livreur payé", l.delivery.driver_payout, D - driverFee(D));
      eq("B7 commerçant payé", l.wallet.sale, P);
      eq(
        "B7 cashback client",
        l.customer.cashback_earned,
        round((P + D) * R.cash)
      );
    }

    // ── C. GARDE-FOUS DISPATCH (A2) ───────────────────────────────────────────
    console.log("\n▶ C. Garde-fous dispatch (plafond encours COD)");
    {
      const can0 = (await q("SELECT public.driver_can_accept($1) b", [DRV]))[0]
        .b;
      check("C1 encours faible → driver_can_accept = true", can0 === true);
      // Gonfler l'encours au-dessus du plafond (8000) via une écriture non réglée.
      await q(
        `INSERT INTO delivery_ledger (driver_id, merchant_id, order_id, type, amount_da)
         SELECT $1,$2, id, 'driver_owes_platform', 9000 FROM orders WHERE merchant_id=$2 LIMIT 1`,
        [DRV, MID]
      );
      const can1 = (await q("SELECT public.driver_can_accept($1) b", [DRV]))[0]
        .b;
      check("C2 encours ≥ plafond → driver_can_accept = false", can1 === false);
    }

    // ── D. INTÉGRITÉ GLOBALE ─────────────────────────────────────────────────
    console.log("\n▶ D. Invariants d'intégrité (dans la transaction)");
    {
      const v = await q("SELECT code FROM public.integrity_violations()");
      check(
        "D1 integrity_violations() = 0",
        v.length === 0,
        v.map((r) => r.code).join(",")
      );
    }
  } finally {
    await q("ROLLBACK");
    await c.end();
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  RÉSULTAT : ${PASS} PASS · ${FAIL} FAIL`);
  if (FAIL) {
    console.log("\n  Échecs :");
    fails.forEach((f) => console.log("   • " + f));
    process.exit(1);
  }
  console.log("  ✅ Tout est vert — prod inchangée (ROLLBACK).");
}

run().catch((e) => {
  console.error("ERREUR FATALE:", e.message);
  process.exit(1);
});
