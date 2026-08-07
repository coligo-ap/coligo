// =============================================================================
// Test e2e COVOITURAGE PAR PLACES (mig 0443) — transaction ROLLBACK, zéro trace.
//   node scripts/test-carpool.mjs
// Parcours réel via les VRAIS RPC (auth simulée par request.jwt.claims) :
// publier → réserver (Coligo Pay + espèces) → PIN embarquement → démarrer
// (no-show remboursé) → clôturer (ledger SUM=0) ; annulations (départ +
// réservation) remboursées ; kill-switch drive_carpool.
// =============================================================================
import { getDbUrl } from "./_supabase.mjs";
import pg from "pg";

const c = new pg.Client({ connectionString: getDbUrl() });
let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}`);
  }
};
// Simule la session Supabase du user (auth.uid() lit claims.sub).
const as = (userId) =>
  c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
const rpc = async (sql, params = []) =>
  (await c.query(sql, params)).rows[0] ?? null;

await c.connect();
await c.query("BEGIN");
try {
  const ch = (
    await c.query(`
      select id, user_id from chauffeurs
      where is_verified and not is_frozen and not is_blocked and user_id is not null
      limit 1`)
  ).rows[0];
  const custs = (
    await c.query(
      `
      select cu.id, cu.user_id from customers cu
      where cu.user_id is not null and cu.user_id <> $1
      limit 3`,
      [ch.user_id]
    )
  ).rows;
  if (custs.length < 3) throw new Error("pas assez de clients auth-liés");
  // Solde Coligo Pay de test pour les clients 0 et 2 (rollback de toute façon).
  for (const cu of [custs[0], custs[2]]) {
    await c.query(
      `insert into customer_wallet_entries (customer_id, order_id, type, source, amount_da, note)
       values ($1, null, 'topup_credit', 'topup', 10000, 'seed test covoiturage')`,
      [cu.id]
    );
  }
  const bal = async (cid) =>
    Number(
      (await c.query("select customer_topup_balance($1) b", [cid])).rows[0].b
    );

  // ── 1. Publier (chauffeur) ─────────────────────────────────────────────
  await as(ch.user_id);
  const pub = (
    await rpc(
      `select carpool_publish_trip('16','06','Alger — Tafourah','Béjaïa — gare',
         now() + interval '3 hours', 4, 1200) j`
    )
  ).j;
  ok("publier un départ 16→06 (4 places, 1200 DA/place)", pub.ok === true);
  const trip = pub.trip_id;
  const bad = (
    await rpc(
      `select carpool_publish_trip('16','16','x','y', now() + interval '3 hours', 4, 1200) j`
    )
  ).j;
  ok(
    "même wilaya refusée (bad_route)",
    bad.ok === false && bad.reason === "bad_route"
  );

  // ── 2. Réserver : Coligo Pay (2 places) + espèces (1 place) ────────────
  const b0Before = await bal(custs[0].id);
  await as(custs[0].user_id);
  const bk1 = (
    await rpc(`select carpool_book_seats($1, 2, 'coligo_pay', 'op-test-1') j`, [
      trip,
    ])
  ).j;
  ok(
    "réservation Coligo Pay 2 places + PIN",
    bk1.ok === true && /^\d{4}$/.test(bk1.pin)
  );
  ok("séquestre débité (−2400)", (await bal(custs[0].id)) === b0Before - 2400);
  const again = (
    await rpc(
      `select carpool_book_seats($1, 1, 'coligo_pay', 'op-test-1b') j`,
      [trip]
    )
  ).j;
  ok(
    "re-réserver le même départ = renvoie l'existante",
    again.already === true
  );

  await as(custs[1].user_id);
  const bk2 = (
    await rpc(`select carpool_book_seats($1, 1, 'cash', 'op-test-2') j`, [trip])
  ).j;
  ok("réservation espèces 1 place", bk2.ok === true);
  const search = (
    await c.query(
      `select seats_left, my_booking_id from carpool_search_trips() where id = $1`,
      [trip]
    )
  ).rows[0];
  ok(
    "recherche : 1 place restante + ma réservation signalée",
    search?.seats_left === 1 && search?.my_booking_id === bk2.booking_id
  );

  // ── 3. Embarquement PIN + démarrage + clôture (ARGENT) ─────────────────
  await as(ch.user_id);
  const badPin = (
    await rpc(`select carpool_board_passenger($1, '0000') j`, [trip])
  ).j;
  const goodPin = badPin.reason === "bad_pin" || bk1.pin === "0000";
  ok("mauvais PIN refusé", goodPin);
  const bd1 = (
    await rpc(`select carpool_board_passenger($1, $2) j`, [trip, bk1.pin])
  ).j;
  const bd2 = (
    await rpc(`select carpool_board_passenger($1, $2) j`, [trip, bk2.pin])
  ).j;
  ok(
    "embarquement des 2 réservations par PIN",
    bd1.ok === true && bd2.ok === true
  );
  const st = (await rpc(`select carpool_start_trip($1) j`, [trip])).j;
  const done = (await rpc(`select carpool_complete_trip($1) j`, [trip])).j;
  ok(
    "démarrer puis clôturer",
    st.ok === true &&
      done.ok === true &&
      done.online_da === 2400 &&
      done.cash_da === 1200
  );

  // Ledger SUM=0 par réservation (miroir complete_ride).
  const led = (
    await c.query(
      `select booking_id, type, amount_da from carpool_ledger where trip_id = $1`,
      [trip]
    )
  ).rows;
  const sumFor = (bid, type) =>
    led
      .filter((l) => l.booking_id === bid && l.type === type)
      .reduce((s, l) => s + l.amount_da, 0);
  const income = Number(
    (
      await c.query(
        `select coalesce(sum(amount_da),0) s from platform_ledger
          where type='vtc_commission_income' and created_at > now() - interval '1 minute'`
      )
    ).rows[0].s
  );
  const r1 = 2400 - sumFor(bk1.booking_id, "chauffeur_payout") - income;
  ok("SUM=0 réservation Coligo Pay (montant = payout + commission)", r1 === 0);
  const r2 =
    sumFor(bk2.booking_id, "chauffeur_cash_collected") -
    sumFor(bk2.booking_id, "chauffeur_payout") -
    sumFor(bk2.booking_id, "chauffeur_owes_platform");
  ok("SUM=0 réservation espèces (cash = payout + dette)", r2 === 0);

  // Gains (mig 0444) : drive_my_finances intègre le covoiturage.
  await as(ch.user_id);
  const fin = (
    await c.query(
      `select carpool_month_net_da, carpool_month_trips, month_net_da, today_net_da
         from drive_my_finances()`
    )
  ).rows[0];
  const payoutSum = led
    .filter((l) => l.type === "chauffeur_payout")
    .reduce((s, l) => s + l.amount_da, 0);
  ok(
    "gains : net covoiturage intégré (mois + jour + total)",
    Number(fin.carpool_month_net_da) >= payoutSum &&
      Number(fin.month_net_da) >= payoutSum &&
      Number(fin.today_net_da) >= payoutSum
  );
  ok("gains : départ covoiturage compté", Number(fin.carpool_month_trips) >= 1);

  // ── 4. No-show : réservé payé, pas embarqué → remboursé au démarrage ───
  await as(ch.user_id);
  const pub2 = (
    await rpc(
      `select carpool_publish_trip('16','19','Alger','Sétif', now() + interval '4 hours', 3, 900) j`
    )
  ).j;
  await as(custs[2].user_id);
  const b2Before = await bal(custs[2].id);
  const bk3 = (
    await rpc(`select carpool_book_seats($1, 1, 'coligo_pay', 'op-test-3') j`, [
      pub2.trip_id,
    ])
  ).j;
  await as(ch.user_id);
  await rpc(`select carpool_start_trip($1) j`, [pub2.trip_id]);
  ok(
    "no-show remboursé intégralement au démarrage",
    (await bal(custs[2].id)) === b2Before
  );
  const ns = (
    await c.query(`select status from carpool_bookings where id = $1`, [
      bk3.booking_id,
    ])
  ).rows[0];
  ok("statut no_show posé", ns.status === "no_show");

  // ── 5. Annulations : départ (par chauffeur) et réservation (par client) ─
  await as(ch.user_id);
  const pub3 = (
    await rpc(
      `select carpool_publish_trip('16','31','Alger','Oran', now() + interval '5 hours', 2, 2000) j`
    )
  ).j;
  await as(custs[2].user_id);
  const bk4 = (
    await rpc(`select carpool_book_seats($1, 1, 'coligo_pay', 'op-test-4') j`, [
      pub3.trip_id,
    ])
  ).j;
  await as(ch.user_id);
  const ct = (await rpc(`select carpool_cancel_trip($1) j`, [pub3.trip_id])).j;
  ok(
    "départ annulé par le chauffeur → passager remboursé",
    ct.ok === true &&
      ct.refunded_bookings === 1 &&
      (await bal(custs[2].id)) === b2Before
  );

  const pub4 = (
    await rpc(
      `select carpool_publish_trip('16','25','Alger','Constantine', now() + interval '6 hours', 2, 1800) j`
    )
  ).j;
  await as(custs[2].user_id);
  const bk5 = (
    await rpc(`select carpool_book_seats($1, 1, 'coligo_pay', 'op-test-5') j`, [
      pub4.trip_id,
    ])
  ).j;
  const cb = (
    await rpc(`select carpool_cancel_booking($1) j`, [bk5.booking_id])
  ).j;
  ok(
    "réservation annulée par le client → remboursée",
    cb.ok === true && (await bal(custs[2].id)) === b2Before
  );

  // ── 6. Kill-switch drive_carpool ───────────────────────────────────────
  await c.query(
    `update feature_flags set status='maintenance' where key='drive_carpool'`
  );
  await as(ch.user_id);
  await c.query("SAVEPOINT sp");
  let blocked = false;
  try {
    await rpc(
      `select carpool_publish_trip('16','06','a','b', now() + interval '3 hours', 2, 1000) j`
    );
  } catch (e) {
    blocked = String(e.message).includes("feature_disabled:drive_carpool");
    await c.query("ROLLBACK TO SAVEPOINT sp");
  }
  ok("flag coupé → publication REFUSÉE (trigger)", blocked);
  await as(custs[2].user_id);
  const empty = (
    await c.query(`select count(*)::int n from carpool_search_trips()`)
  ).rows[0];
  ok("flag coupé → recherche vide", empty.n === 0);
  ok(
    "réservation restée intacte (bk1 completed)",
    (
      await c.query(`select status from carpool_bookings where id=$1`, [
        bk1.booking_id,
      ])
    ).rows[0].status === "completed"
  );
} finally {
  await c.query("ROLLBACK");
  await c.end();
}
console.log(`\n${pass}/${pass + fail} tests OK${fail ? " — ÉCHECS !" : ""}`);
process.exit(fail ? 1 : 0);
