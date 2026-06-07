/**
 * Test E2E des fonctionnalités livraison en PROD, avec les comptes de test.
 *
 * Chaque rôle est simulé fidèlement : `SET ROLE authenticated` +
 * `request.jwt.claims` (auth.uid() + is_super_admin() + RLS s'appliquent comme
 * en vrai). TOUT se déroule dans UNE transaction terminée par ROLLBACK →
 * aucune donnée de prod n'est modifiée.
 */
import { getDbUrl } from "./_supabase.mjs";
import pg from "pg";

const DRIVER = {
  id: "cc7944e2-4ac3-4fcd-8bec-af29466f04d4",
  user_id: "69120859-f3d4-4c24-9b1e-6ef6e518acde",
};
const CLIENT = {
  id: "c2debd28-082a-47f4-b21b-5364d7e6e470",
  user_id: "63306c11-3691-4ccf-ad14-c7c16e15ddd3",
};
const MERCHANT = {
  id: "9192b8e4-31d3-4490-8c9e-0826cc2cdcd2",
  lat: 36.455659,
  lng: 4.525916,
};
const ADMIN_EMAIL = "coligo.noreply@gmail.com";

const c = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});
const q = async (s, p) => (await c.query(s, p)).rows;
let pass = 0,
  fail = 0;
function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${extra}`);
  }
}
async function asUser(sub, email) {
  await c.query("RESET ROLE");
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub, email, role: "authenticated" }),
  ]);
  await c.query("SET ROLE authenticated");
}
async function asPg() {
  await c.query("RESET ROLE");
}

async function mkOrder(status, { driver = null } = {}) {
  const r = await q(
    `INSERT INTO orders
      (merchant_id, customer_id, customer_name, customer_phone, pickup_code,
       pickup_slot_at, total_da, fulfillment_type, delivery_mode, payment_method,
       payment_status, status, delivery_fee_da, delivery_lat, delivery_lng,
       delivery_address_text, delivery_driver_id, prep_notif_at, order_number)
     VALUES ($1,$2,'Lina Abbasi','0600000000','1234', now(), 1000,
       'delivery','express','cash','pending',$3, 250, 36.46, 4.52,
       'Test adresse', $4, now() - interval '5 min',
       'TST'||floor(random()*100000)::text)
     RETURNING id`,
    [MERCHANT.id, CLIENT.id, status, driver]
  );
  return r[0].id;
}

(async () => {
  await c.connect();
  await c.query("BEGIN");
  try {
    // Pré-condition : le livreur de test a déjà des courses réelles en cours →
    // on neutralise la garde anti-double-course DANS la transaction (rollback).
    await c.query(
      "UPDATE orders SET delivery_delivered_at = now() WHERE delivery_driver_id=$1 AND status NOT IN ('completed','cancelled') AND delivery_delivered_at IS NULL",
      [DRIVER.id]
    );

    // ===== A. Cycle de vie complet =========================================
    console.log(
      "\n── A. Dispatch zone → course → chat → signalement → réception → notation"
    );
    const A = await mkOrder("ready");

    // 1) Dispatch par zone (livreur proche)
    await asUser(DRIVER.user_id, null);
    const pull = await q("SELECT * FROM pull_next_express_nearby($1,$2,$3)", [
      MERCHANT.lat,
      MERCHANT.lng,
      6,
    ]);
    check("pull_next_express_nearby attribue une commande", pull.length > 0);
    await asPg();
    const aRow = (
      await q("SELECT delivery_driver_id FROM orders WHERE id=$1", [A])
    )[0];
    check(
      "commande attribuée au bon livreur",
      aRow.delivery_driver_id === DRIVER.id,
      `(got ${aRow.delivery_driver_id})`
    );

    // 2) Récupération + arrivée
    await asUser(DRIVER.user_id, null);
    await q("SELECT mark_delivery_picked_up($1)", [A]);
    await q("SELECT mark_delivery_arrived($1)", [A]);
    await asPg();
    const aT = (
      await q(
        "SELECT delivery_picked_up_at, delivery_arrived_at FROM orders WHERE id=$1",
        [A]
      )
    )[0];
    check("delivery_picked_up_at posé", !!aT.delivery_picked_up_at);
    check("delivery_arrived_at posé", !!aT.delivery_arrived_at);

    // 3) Chat texte libre + preset (client et livreur)
    await asUser(CLIENT.user_id, null);
    const m1 = await q("SELECT * FROM send_order_text_message($1,$2)", [
      A,
      "Bonjour, je descends",
    ]);
    check(
      "client envoie un texte libre",
      m1[0]?.ok === true,
      JSON.stringify(m1[0])
    );
    const m2 = await q("SELECT * FROM send_order_message($1,$2)", [
      A,
      "where_are_you",
    ]);
    check("client envoie un message prédéfini", m2[0]?.ok === true);
    const mLong = await q("SELECT * FROM send_order_text_message($1,$2)", [
      A,
      "x".repeat(301),
    ]);
    check(
      "texte > 300 caractères refusé",
      mLong[0]?.ok === false && mLong[0]?.reason === "too_long"
    );
    await asUser(DRIVER.user_id, null);
    const m3 = await q("SELECT * FROM send_order_text_message($1,$2)", [
      A,
      "J'arrive dans 2 min",
    ]);
    check("livreur envoie un texte libre", m3[0]?.ok === true);
    await asPg();
    const cnt = (
      await q("SELECT count(*)::int n FROM order_messages WHERE order_id=$1", [
        A,
      ])
    )[0].n;
    check("3 messages enregistrés", cnt === 3, `(got ${cnt})`);

    // 4) Signalements (client → livreur, puis livreur → client)
    await asUser(CLIENT.user_id, null);
    const r1 = await q("SELECT * FROM submit_delivery_report($1,$2,$3)", [
      A,
      "Comportement dangereux",
      "test",
    ]);
    check(
      "client signale le livreur",
      r1[0]?.ok === true,
      JSON.stringify(r1[0])
    );
    const r1b = await q("SELECT * FROM submit_delivery_report($1,$2,$3)", [
      A,
      "Insultes",
      null,
    ]);
    check(
      "2e signalement client refusé (1 par sens)",
      r1b[0]?.ok === false && r1b[0]?.reason === "already_reported"
    );
    await asUser(DRIVER.user_id, null);
    const r2 = await q("SELECT * FROM submit_delivery_report($1,$2,$3)", [
      A,
      "Client injoignable",
      null,
    ]);
    check("livreur signale le client", r2[0]?.ok === true);
    await asPg();
    const rc = (
      await q(
        "SELECT count(*)::int n FROM delivery_reports WHERE order_id=$1",
        [A]
      )
    )[0].n;
    check("2 signalements enregistrés (un par sens)", rc === 2, `(got ${rc})`);

    // 5) Confirmation de réception par le CLIENT (livreur arrivé requis)
    await asUser(CLIENT.user_id, null);
    const conf = await q("SELECT * FROM customer_confirm_delivery($1)", [A]);
    check(
      "client confirme la réception",
      conf[0]?.ok === true,
      JSON.stringify(conf[0])
    );
    await asPg();
    const aDone = (
      await q("SELECT status, delivery_delivered_at FROM orders WHERE id=$1", [
        A,
      ])
    )[0];
    check(
      "commande passée à completed",
      aDone.status === "completed" && !!aDone.delivery_delivered_at
    );

    // 6) Notation : livreur note le client + client note le livreur
    await asUser(DRIVER.user_id, null);
    await q(
      "INSERT INTO customer_ratings (order_id, driver_id, customer_id, rating, comment) VALUES ($1,$2,$3,5,'RAS')",
      [A, DRIVER.id, CLIENT.id]
    );
    await asPg();
    const custRating = (
      await q("SELECT rating_count, rating_avg FROM customers WHERE id=$1", [
        CLIENT.id,
      ])
    )[0];
    check(
      "note client dénormalisée (rating_count ≥ 1)",
      Number(custRating.rating_count) >= 1,
      JSON.stringify(custRating)
    );
    await asUser(CLIENT.user_id, null);
    await q(
      "INSERT INTO driver_reviews (order_id, customer_id, driver_id, rating, comment) VALUES ($1,$2,$3,4,'Rapide')",
      [A, CLIENT.id, DRIVER.id]
    );
    await asPg();
    const drvRating = (
      await q("SELECT rating_count FROM drivers WHERE id=$1", [DRIVER.id])
    )[0];
    check(
      "note livreur dénormalisée (rating_count ≥ 1)",
      Number(drvRating.rating_count) >= 1
    );

    // ===== B. Admin : valider une livraison ================================
    console.log("\n── B. Super-admin : valider une livraison");
    const B = await mkOrder("ready", { driver: DRIVER.id });
    await asUser("00000000-0000-0000-0000-000000000000", ADMIN_EMAIL);
    const av = await q("SELECT * FROM admin_validate_delivery($1,$2)", [
      B,
      "test admin",
    ]);
    check(
      "admin_validate_delivery ok",
      av[0]?.ok === true,
      JSON.stringify(av[0])
    );
    await asPg();
    const bDone = (await q("SELECT status FROM orders WHERE id=$1", [B]))[0];
    check("commande B completed par admin", bDone.status === "completed");

    // ===== C. Admin : annuler à toute étape + rembourser commerçant =======
    console.log(
      "\n── C. Super-admin : annuler (suivi conservé) + rembourser commerçant"
    );
    const C = await mkOrder("ready", { driver: DRIVER.id });
    await asUser("00000000-0000-0000-0000-000000000000", ADMIN_EMAIL);
    const can = await q("SELECT admin_cancel_order($1,$2) j", [
      C,
      "client injoignable",
    ]);
    check(
      "admin_cancel_order ok",
      can[0]?.j?.ok === true,
      JSON.stringify(can[0]?.j)
    );
    check(
      "statut avant annulation renvoyé = ready",
      can[0]?.j?.from_status === "ready"
    );
    const ref = await q("SELECT admin_refund_merchant_wallet($1,$2,$3) j", [
      C,
      700,
      "commande prête annulée",
    ]);
    check(
      "admin_refund_merchant_wallet ok",
      ref[0]?.j?.ok === true,
      JSON.stringify(ref[0]?.j)
    );
    await asPg();
    const cRow = (
      await q("SELECT status, cancelled_by FROM orders WHERE id=$1", [C])
    )[0];
    check(
      "commande C annulée (cancelled_by=system)",
      cRow.status === "cancelled" && cRow.cancelled_by === "system"
    );
    const ev = (
      await q(
        "SELECT from_status, note FROM order_events WHERE order_id=$1 AND to_status='cancelled' ORDER BY created_at DESC LIMIT 1",
        [C]
      )
    )[0];
    check(
      "order_events conserve le statut avant annulation",
      ev?.from_status === "ready" && /statut avant/.test(ev?.note || ""),
      JSON.stringify(ev)
    );
    const we = (
      await q(
        "SELECT amount_da, type, note FROM wallet_entries WHERE order_id=$1 AND type='adjustment'",
        [C]
      )
    )[0];
    check(
      "wallet commerçant crédité +700 (libellé plateforme)",
      we?.amount_da === 700 && /plateforme/.test(we?.note || ""),
      JSON.stringify(we)
    );

    // ===== D. Admin : liste de modération des signalements =================
    console.log("\n── D. Super-admin : modération des signalements");
    await asUser("00000000-0000-0000-0000-000000000000", ADMIN_EMAIL);
    const list = await q("SELECT * FROM admin_delivery_reports($1)", [50]);
    check(
      "admin_delivery_reports renvoie les signalements",
      list.length >= 2,
      `(got ${list.length})`
    );
    const target = list.find((x) => x.order_id === A);
    if (target) {
      const res = await q(
        "SELECT * FROM admin_resolve_delivery_report($1,$2,$3)",
        [target.id, "resolved", "traité"]
      );
      check("admin_resolve_delivery_report ok", res[0]?.ok === true);
    } else {
      check("signalement de la commande A présent dans la liste admin", false);
    }

    // ===== E. Sécurité : non-admin bloqué =================================
    console.log("\n── E. Sécurité (garde-fous)");
    await asUser(CLIENT.user_id, "qawaexpress@gmail.com");
    const forbid = await q("SELECT admin_cancel_order($1,$2) j", [B, "hack"]);
    check(
      "client NE peut PAS annuler via admin_cancel_order",
      forbid[0]?.j?.ok === false && forbid[0]?.j?.reason === "forbidden"
    );
    const forbidList = await q(
      "SELECT * FROM admin_delivery_reports($1)",
      [10]
    );
    check(
      "client NE voit PAS la liste admin des signalements",
      forbidList.length === 0,
      `(got ${forbidList.length})`
    );
    await asPg();
  } finally {
    await c.query("ROLLBACK");
    await c.end();
  }
  console.log(`\n═══ Résultat : ${pass} OK / ${fail} KO ═══`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERREUR FATALE:", e.message);
  process.exit(1);
});
