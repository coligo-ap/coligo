/**
 * E2E — Parcours client RÉEL Coligo Drive AVEC devis signé (mig 0252).
 *
 * Couvre tout le fonctionnement jusqu'à la validation de la course par le
 * chauffeur, et prouve les garde-fous anti double-tap :
 *   1. émission d'un devis (geo_quote_issue) ;
 *   2. request_ride AVEC p_quote_id → devis vérifié+consommé À L'INTÉRIEUR,
 *      lié à la course (consumed_ride_id) ;
 *   3. IDEMPOTENCE : même operation_id → même course (pas de doublon) ;
 *   4. ANTI-DOUBLE-TAP séquentiel : 2ᵉ demande (autre op) pendant une course
 *      active → refus « déjà une course » (aucune 2ᵉ course) ;
 *   5. cycle chauffeur : offre → acceptation → arrivée → démarrage → fin ;
 *   6. après la fin, le formulaire est de nouveau utilisable (nouvelle course) ;
 *   7. CONCURRENCE RÉELLE (2 connexions) : double-tap simultané → l'index
 *      unique partiel garantit UNE seule course (atomique).
 *
 * Parties 1-6 : transaction + ROLLBACK (aucune trace). Partie 7 : 2 connexions
 * réelles (commit) avec nettoyage explicite.
 */
import fs from "node:fs";
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const env = fs.readFileSync(".env.local", "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && process.env[m[1]] === undefined)
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "").trim();
}

let pass = 0,
  fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(
    `${good ? "✅" : "❌"} ${label}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`
  );
  good ? pass++ : fail++;
};

const PICK = { lat: 36.7538, lng: 3.0588, t: "Place Audin" };
const DEST = { lat: 36.78, lng: 3.1, t: "Bab Ezzouar" };

async function main() {
  const c = new pg.Client({ connectionString: getDbUrl() });
  await c.connect();
  const as = (uid) =>
    c.query(
      `SELECT set_config('request.jwt.claims', json_build_object('sub','${uid}','role','authenticated')::text, true)`
    );
  const svc = () =>
    c.query(
      `SELECT set_config('request.jwt.claims', json_build_object('role','service_role')::text, true)`
    );

  const custUid = (
    await c.query(
      `SELECT id FROM auth.users WHERE email = 'demo.drive.client@coligo.local'`
    )
  ).rows[0].id;
  const ahmed = (
    await c.query(
      `SELECT id, user_id FROM chauffeurs WHERE phone = '0550100001'`
    )
  ).rows[0];

  await c.query("BEGIN");
  try {
    await svc();
    // État propre (dans la txn rollback) : aucune course active résiduelle.
    await c.query(
      `UPDATE rides SET status='cancelled', cancelled_at=now()
        WHERE customer_id=(SELECT id FROM customers WHERE user_id=$1)
          AND status IN ('searching','accepted','arriving','arrived','in_progress')`,
      [custUid]
    );
    await c.query(
      `UPDATE chauffeur_presence SET is_online=true, updated_at=now()
        WHERE chauffeur_id IN (SELECT id FROM chauffeurs WHERE is_demo)`
    );

    console.log("— 1. Émission du devis signé —");
    await as(custUid);
    const q = (
      await c.query(
        `SELECT * FROM geo_quote_issue('drive',$1,$2,$3,$4,$5,$6,300,NULL,NULL,NULL,'{"gamme":"classic"}'::jsonb)`,
        [PICK.lat, PICK.lng, PICK.t, DEST.lat, DEST.lng, DEST.t]
      )
    ).rows[0];
    ok("devis émis (quote_id)", !!q.quote_id, true);

    console.log("— 2. request_ride AVEC devis —");
    const ride = (
      await c.query(
        `SELECT request_ride($1,$2,$3,$4,$5,$6,5.0,300,'cash','classic',0,false,NULL,NULL,$7,NULL,NULL,NULL,NULL,$8) id`,
        [
          PICK.lat,
          PICK.lng,
          PICK.t,
          DEST.lat,
          DEST.lng,
          DEST.t,
          "op-A",
          q.quote_id,
        ]
      )
    ).rows[0].id;
    ok(
      "course créée (searching)",
      (await c.query("SELECT status FROM rides WHERE id=$1", [ride])).rows[0]
        .status,
      "searching"
    );
    const qrow = (
      await c.query(
        "SELECT consumed_at, consumed_ride_id FROM geo_quotes WHERE quote_id=$1",
        [q.quote_id]
      )
    ).rows[0];
    ok("devis consommé", qrow.consumed_at != null, true);
    ok("devis LIÉ à la course (consumed_ride_id)", qrow.consumed_ride_id, ride);

    console.log("— 3. Idempotence (même operation_id) —");
    const ride2 = (
      await c.query(
        `SELECT request_ride($1,$2,$3,$4,$5,$6,5.0,300,'cash','classic',0,false,NULL,NULL,$7,NULL,NULL,NULL,NULL,NULL) id`,
        [PICK.lat, PICK.lng, PICK.t, DEST.lat, DEST.lng, DEST.t, "op-A"]
      )
    ).rows[0].id;
    ok("même op → MÊME course (pas de doublon)", ride2, ride);

    console.log("— 4. Anti-double-tap séquentiel (autre op, course active) —");
    await c.query("SAVEPOINT sp1");
    let raised = null;
    try {
      await c.query(
        `SELECT request_ride($1,$2,$3,$4,$5,$6,5.0,300,'cash','classic',0,false,NULL,NULL,$7,NULL,NULL,NULL,NULL,NULL)`,
        [PICK.lat, PICK.lng, PICK.t, DEST.lat, DEST.lng, DEST.t, "op-B"]
      );
    } catch (e) {
      raised = e.message;
    }
    await c.query("ROLLBACK TO SAVEPOINT sp1");
    ok(
      "2ᵉ demande refusée (déjà une course)",
      /déjà une course/.test(raised ?? ""),
      true
    );
    const activeCount = (
      await c.query(
        `SELECT count(*)::int n FROM rides WHERE customer_id=(SELECT id FROM customers WHERE user_id=$1)
          AND status IN ('searching','accepted','arriving','arrived','in_progress')`,
        [custUid]
      )
    ).rows[0].n;
    ok("exactement 1 course active", activeCount, 1);

    console.log("— 5. Cycle chauffeur jusqu'à la validation —");
    await svc();
    const n = (await c.query("SELECT drive_demo_respond($1) n", [ride])).rows[0]
      .n;
    ok("répondeur démo : ≥ 2 offres", n >= 2, true);
    await as(custUid);
    const offers = (await c.query("SELECT * FROM my_ride_offers($1)", [ride]))
      .rows;
    ok("client voit les offres", offers.length >= 2, true);
    const ahOffer =
      offers.find((o) => o.chauffeur_id === ahmed.id) ?? offers[0];
    const acc = (
      await c.query("SELECT * FROM accept_ride_offer($1)", [ahOffer.id])
    ).rows[0];
    ok("acceptation OK", acc.ok, true);
    ok(
      "course attribuée",
      (await c.query("SELECT chauffeur_id FROM rides WHERE id=$1", [ride]))
        .rows[0].chauffeur_id,
      ahOffer.chauffeur_id
    );
    // Déroulé chauffeur (cash : pas de PIN) → fin de course.
    await as(ahmed.user_id);
    await c.query("SELECT ride_set_status($1,'arriving')", [ride]);
    await c.query("SELECT ride_set_status($1,'arrived')", [ride]);
    await c.query("SELECT ride_set_status($1,'in_progress')", [ride]);
    const done = (await c.query("SELECT * FROM complete_ride($1)", [ride]))
      .rows[0];
    ok("validation fin de course (chauffeur)", done.ok, true);
    ok(
      "statut final = completed",
      (await c.query("SELECT status FROM rides WHERE id=$1", [ride])).rows[0]
        .status,
      "completed"
    );

    console.log("— 6. Formulaire de nouveau utilisable après la course —");
    await as(custUid);
    const q3 = (
      await c.query(
        `SELECT * FROM geo_quote_issue('drive',$1,$2,$3,$4,$5,$6,300,NULL,NULL,NULL,'{"gamme":"classic"}'::jsonb)`,
        [PICK.lat, PICK.lng, PICK.t, DEST.lat, DEST.lng, DEST.t]
      )
    ).rows[0];
    const ride3 = (
      await c.query(
        `SELECT request_ride($1,$2,$3,$4,$5,$6,5.0,300,'cash','classic',0,false,NULL,NULL,$7,NULL,NULL,NULL,NULL,$8) id`,
        [
          PICK.lat,
          PICK.lng,
          PICK.t,
          DEST.lat,
          DEST.lng,
          DEST.t,
          "op-C",
          q3.quote_id,
        ]
      )
    ).rows[0].id;
    ok(
      "nouvelle course créée après complétion",
      !!ride3 && ride3 !== ride,
      true
    );
  } finally {
    await c.query("ROLLBACK");
  }

  // ── 7. CONCURRENCE RÉELLE : l'index unique partiel bloque ATOMIQUEMENT une
  //    2ᵉ course active (double-tap simultané). Deux connexions insèrent en
  //    parallèle une demande 'searching' pour le MÊME client → la 2ᵉ est
  //    rejetée (23505). Test direct de uq_rides_one_active_per_customer.
  console.log("— 7. Concurrence réelle (index unique partiel) —");
  const cleanup = new pg.Client({ connectionString: getDbUrl() });
  await cleanup.connect();
  const custId = (
    await cleanup.query(`SELECT id FROM customers WHERE user_id=$1`, [custUid])
  ).rows[0].id;
  const purge = () =>
    cleanup.query(
      `UPDATE rides SET status='cancelled', cancelled_at=now()
        WHERE customer_id=$1
          AND status IN ('searching','accepted','arriving','arrived','in_progress')`,
      [custId]
    );
  await purge();

  const a = new pg.Client({ connectionString: getDbUrl() });
  const b = new pg.Client({ connectionString: getDbUrl() });
  await a.connect();
  await b.connect();
  const insSearching = (cl) =>
    cl.query(
      `INSERT INTO rides(customer_id,status,pickup_lat,pickup_lng,dest_lat,dest_lng,
         distance_km,proposed_price_da,suggested_price_da,payment_method,gamme,expires_at)
       VALUES($1,'searching',$2,$3,$4,$5,5,300,300,'cash','classic',now()+interval '30 min')
       RETURNING id`,
      [custId, PICK.lat, PICK.lng, DEST.lat, DEST.lng]
    );
  let idA, bBlocked;
  await a.query("BEGIN");
  await b.query("BEGIN");
  idA = (await insSearching(a)).rows[0].id; // A insère (non commité)
  const pB = insSearching(b); // B se bloque sur l'index unique partiel
  await a.query("COMMIT"); // libère B → unique_violation attendue
  try {
    await pB;
    bBlocked = false;
    await b.query("COMMIT");
  } catch (e) {
    bBlocked = e.code === "23505"; // duplicate key → garde atomique OK
    await b.query("ROLLBACK");
  }
  ok("course A créée", idA != null, true);
  ok("2ᵉ insert simultané BLOQUÉ (unique_violation)", bBlocked, true);
  const finalCount = (
    await cleanup.query(
      `SELECT count(*)::int n FROM rides WHERE customer_id=$1
        AND status IN ('searching','accepted','arriving','arrived','in_progress')`,
      [custId]
    )
  ).rows[0].n;
  ok("UNE seule course active (atomique)", finalCount, 1);

  await purge(); // nettoyage
  await a.end();
  await b.end();
  await cleanup.end();
  await c.end();

  console.log(`\n🎯 DRIVE CLIENT QUOTE E2E — pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
