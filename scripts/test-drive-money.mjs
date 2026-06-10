// E2E Coligo Drive — ARGENT + RÈGLES DURES via les VRAIS RPC, impersonation
// client/chauffeur, transaction ROLLBACK (aucune trace en prod).
//
// Couvre : barème par gamme + plancher silencieux + clamp boost ·
// matching gammes · femme au volant (+ repli) · anti double-engagement ·
// idempotence client_operation_id · commission par plan (8 / 3,5 / 0 %) ·
// boost 100 % chauffeur sans commission · cashback 2 % financé par la
// commission (plafonné, Premium ⇒ 0) · abonnements CCP/carte + recette ·
// retour Gratuit à l'échéance · gel automatique (dette).
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const CUST = "60eec155-fb82-4a8b-9223-8ac2dd24d922";
const CUST_USER = "00000000-0000-4000-8000-000820591480";
const CUST2_USER = "22222222-2222-4222-8222-222222222222";
const CH_M = "33333333-3333-4333-8333-333333333333"; // homme, classic
const CH_F = "44444444-4444-4444-8444-444444444444"; // femme vérifiée, classic
const CH_C = "55555555-5555-4555-8555-555555555555"; // homme, confort
const CH_MOTO = "66666666-6666-4666-8666-666666666666"; // moto

let pass = 0,
  fail = 0;
const ok = (l, g, w) => {
  const p =
    g === w ||
    (typeof g !== "boolean" &&
      !Number.isNaN(Number(g)) &&
      Number(g) === Number(w));
  console.log(`${p ? "✅" : "❌"} ${l}: got=${g} want=${w}`);
  p ? pass++ : fail++;
};

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();
await c.query("BEGIN");

const as = (uid) =>
  c.query(
    `SELECT set_config('request.jwt.claims', json_build_object('sub','${uid}','role','authenticated')::text, true)`
  );
const rl = async (rideId, type) =>
  (
    await c.query(
      "SELECT COALESCE(SUM(amount_da),0)::int s FROM ride_ledger WHERE ride_id=$1 AND type=$2",
      [rideId, type]
    )
  ).rows[0].s;
const platSum = async (type) =>
  (
    await c.query(
      "SELECT COALESCE(SUM(amount_da),0)::int s FROM platform_ledger WHERE type=$1",
      [type]
    )
  ).rows[0].s;

async function mkChauffeur(uid, name, plate, gamme, female) {
  const r = await c.query(
    `INSERT INTO chauffeurs (user_id, full_name, first_name, phone, is_verified, vehicle_plate,
       vehicle_make, vehicle_model, vehicle_color, gamme, is_female, is_female_verified)
     VALUES ($1,$2,$3,$4,true,$5,'Chevrolet','Beat','Blanche',$6,$7,$7) RETURNING id`,
    [
      uid,
      name,
      name.split(" ")[0],
      "+213700" + plate.slice(0, 5).replace("-", "9"),
      plate,
      gamme,
      female,
    ]
  );
  return r.rows[0].id;
}
const setOnline = (chId, on = true) =>
  c.query(
    `INSERT INTO chauffeur_presence (chauffeur_id, lat, lng, is_online, updated_at)
     VALUES ($1, 36.75, 3.06, $2, now())
     ON CONFLICT (chauffeur_id) DO UPDATE SET is_online=$2, updated_at=now()`,
    [chId, on]
  );

async function requestRide(userUid, opts = {}) {
  await as(userUid);
  const r = await c.query(
    `SELECT request_ride(36.75,3.06,'Départ',36.78,3.10,'Arrivée',5.0,$1,$2,$3,$4,$5,NULL,NULL,$6) id`,
    [
      opts.price ?? 0,
      opts.payment ?? "cash",
      opts.gamme ?? "classic",
      opts.boost ?? 0,
      opts.femaleOnly ?? false,
      opts.opId ?? null,
    ]
  );
  return r.rows[0].id;
}
async function offer(chUid, ride, price) {
  await as(chUid);
  return (
    await c.query("SELECT * FROM chauffeur_offer_ride($1,$2)", [ride, price])
  ).rows[0];
}
async function acceptOffer(custUid, ride, chId) {
  await as(custUid);
  const oid = (
    await c.query(
      "SELECT id FROM ride_offers WHERE ride_id=$1 AND chauffeur_id=$2 ORDER BY created_at DESC LIMIT 1",
      [ride, chId]
    )
  ).rows[0].id;
  return (await c.query("SELECT * FROM accept_ride_offer($1)", [oid])).rows[0];
}
async function runToComplete(chUid, ride) {
  await as(chUid);
  await c.query("SELECT ride_set_status($1,'arriving')", [ride]);
  await c.query("SELECT ride_set_status($1,'arrived')", [ride]);
  await c.query("SELECT ride_set_status($1,'in_progress')", [ride]);
  return (await c.query("SELECT * FROM complete_ride($1)", [ride])).rows[0];
}

try {
  // 2e client (auth user minimal, rollback à la fin)
  await c.query(
    `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
     VALUES ('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated','drive-test2@test.local','x',now(),now(),now())`,
    [CUST2_USER]
  );
  const cust2 = (
    await c.query(
      "INSERT INTO customers (user_id, full_name) VALUES ($1,'Client Deux') RETURNING id",
      [CUST2_USER]
    )
  ).rows[0].id;
  // Cliente vérifiée (filtre rose)
  await c.query("UPDATE customers SET is_female_verified=true WHERE id=$1", [
    CUST,
  ]);

  const chM = await mkChauffeur(
    CH_M,
    "Karim Drive",
    "00111-114-16",
    "classic",
    false
  );
  const chF = await mkChauffeur(
    CH_F,
    "Yasmine Drive",
    "00222-114-16",
    "classic",
    true
  );
  const chC = await mkChauffeur(
    CH_C,
    "Sofiane Drive",
    "00333-114-16",
    "confort",
    false
  );
  const chMoto = await mkChauffeur(
    CH_MOTO,
    "Reda Drive",
    "00444-114-16",
    "moto",
    false
  );
  await setOnline(chM);
  await setOnline(chF);
  await setOnline(chC);
  await setOnline(chMoto);

  // ---------- 1. Barème / plancher / clamp boost / idempotence ----------
  console.log("\n=== 1. Prix, plancher, boost, idempotence ===");
  const floor = (await c.query("SELECT drive_price_floor(5.0,'classic') f"))
    .rows[0].f;
  const r1 = await requestRide(CUST_USER, {
    price: 50,
    boost: 7,
    opId: "op-test-1",
  });
  const row1 = (
    await c.query(
      "SELECT proposed_price_da, boost_amount_da, gamme, expires_at FROM rides WHERE id=$1",
      [r1]
    )
  ).rows[0];
  ok(
    "plancher silencieux appliqué (50 → plancher)",
    row1.proposed_price_da,
    floor
  );
  ok("boost clampé au minimum (7 → 10)", row1.boost_amount_da, 10);
  ok("TTL demande posé", row1.expires_at !== null, true);
  const r1bis = await requestRide(CUST_USER, {
    price: 50,
    boost: 7,
    opId: "op-test-1",
  });
  ok("idempotence client_operation_id (même course)", r1bis, r1);
  await as(CUST_USER);
  await c.query("SELECT cancel_ride($1)", [r1]);

  // ---------- 2. Matching gammes ----------
  console.log("\n=== 2. Matching gammes ===");
  const rClassic = await requestRide(CUST_USER, { price: 300 });
  ok(
    "moto NE reçoit PAS classic",
    (await offer(CH_MOTO, rClassic, 300)).reason,
    "gamme_mismatch"
  );
  ok("confort REÇOIT classic", (await offer(CH_C, rClassic, 300)).ok, true);
  ok("classic reçoit classic", (await offer(CH_M, rClassic, 300)).ok, true);
  await as(CUST_USER);
  await c.query("SELECT cancel_ride($1)", [rClassic]);

  const rConfort = await requestRide(CUST_USER, {
    price: 450,
    gamme: "confort",
  });
  ok(
    "classic NE reçoit PAS confort",
    (await offer(CH_M, rConfort, 450)).reason,
    "gamme_mismatch"
  );
  ok("confort reçoit confort", (await offer(CH_C, rConfort, 450)).ok, true);
  await as(CUST_USER);
  await c.query("SELECT cancel_ride($1)", [rConfort]);

  // ---------- 3. Femme au volant + repli ----------
  console.log("\n=== 3. Femme au volant ===");
  const rF = await requestRide(CUST_USER, { price: 300, femaleOnly: true });
  ok(
    "femme au volant posé",
    (await c.query("SELECT female_only FROM rides WHERE id=$1", [rF])).rows[0]
      .female_only,
    true
  );
  ok(
    "homme refusé (conductrice en ligne)",
    (await offer(CH_M, rF, 300)).reason,
    "female_only"
  );
  ok("conductrice acceptée", (await offer(CH_F, rF, 300)).ok, true);
  await setOnline(chF, false); // plus aucune conductrice en ligne → repli
  ok(
    "repli : homme accepté si aucune conductrice",
    (await offer(CH_M, rF, 310)).ok,
    true
  );
  await setOnline(chF, true);
  await as(CUST_USER);
  await c.query("SELECT cancel_ride($1)", [rF]);

  // ---------- 4. Anti double-engagement ----------
  console.log("\n=== 4. Anti double-engagement ===");
  const rA = await requestRide(CUST_USER, { price: 300 });
  const rB = await requestRide(CUST2_USER, { price: 280 });
  await offer(CH_M, rA, 300);
  await offer(CH_M, rB, 280);
  const accA = await acceptOffer(CUST_USER, rA, chM);
  ok("1re acceptation gagne", accA.ok, true);
  const accB = await acceptOffer(CUST2_USER, rB, chM);
  // La 1re acceptation a déjà expiré ses autres propositions (offer_expired),
  // et s'il restait une offre vivante le verrou répondrait chauffeur_busy.
  ok(
    "2e acceptation refusée (chauffeur verrouillé)",
    accB.ok === false &&
      ["offer_expired", "chauffeur_busy"].includes(accB.reason),
    true
  );
  const otherOffer = (
    await c.query(
      "SELECT status FROM ride_offers WHERE ride_id=$1 AND chauffeur_id=$2",
      [rB, chM]
    )
  ).rows[0];
  ok("son autre proposition est expirée", otherOffer.status, "expired");
  const tok = (await c.query("SELECT share_token FROM rides WHERE id=$1", [rA]))
    .rows[0].share_token;
  ok("token de partage généré", !!tok && tok.length === 8, true);

  // ---------- 5. ARGENT plan Gratuit (8 %) + BOOST + CASHBACK ----------
  console.log("\n=== 5. Cash + boost (Gratuit 8 %) ===");
  // rA : proposé 300 + boost → on annule et refait proprement avec boost.
  await as(CUST_USER);
  await c.query("SELECT cancel_ride($1)", [rA]);
  await as(CUST2_USER);
  await c.query("SELECT cancel_ride($1)", [rB]);

  const cbBefore = (
    await c.query(
      "SELECT COALESCE(SUM(amount_da),0)::int s FROM customer_wallet_entries WHERE customer_id=$1 AND type='cashback_earned'",
      [CUST]
    )
  ).rows[0].s;
  const cbExpBefore = await platSum("cashback_expense");

  const r5 = await requestRide(CUST_USER, { price: 300, boost: 30 });
  // Le chauffeur voit 330 (prix client + boost) et accepte ce total.
  await offer(CH_M, r5, 330);
  await acceptOffer(CUST_USER, r5, chM);
  const done5 = await runToComplete(CH_M, r5);
  ok("course terminée", done5.ok, true);
  const F = 330,
    boost = 30,
    base = 300;
  const com = Math.round(base * 0.08); // 24 — PAS de commission sur le boost
  const cb = Math.min(Math.round(F * 0.02), com); // 7 — financé par la commission
  const row5 = (
    await c.query(
      "SELECT commission_da, chauffeur_net_da, cashback_da FROM rides WHERE id=$1",
      [r5]
    )
  ).rows[0];
  ok("commission sur la base seule (300×8 %)", row5.commission_da, com);
  ok(
    "gain net = F − commission (boost 100 % chauffeur)",
    row5.chauffeur_net_da,
    F - com
  );
  ok("cashback = min(2 % × F, commission)", row5.cashback_da, cb);
  ok(
    "ledger cash_collected = F (boost inclus)",
    await rl(r5, "chauffeur_cash_collected"),
    F
  );
  ok("ledger owes = commission", await rl(r5, "chauffeur_owes_platform"), com);
  ok("ledger payout = net", await rl(r5, "chauffeur_payout"), F - com);
  ok(
    "RÉSIDU custodian = 0",
    (await rl(r5, "chauffeur_cash_collected")) -
      (await rl(r5, "chauffeur_owes_platform")) -
      (await rl(r5, "chauffeur_payout")),
    0
  );
  const cbAfter = (
    await c.query(
      "SELECT COALESCE(SUM(amount_da),0)::int s FROM customer_wallet_entries WHERE customer_id=$1 AND type='cashback_earned'",
      [CUST]
    )
  ).rows[0].s;
  ok("cashback crédité au client", cbAfter - cbBefore, cb);
  ok(
    "cashback provisionné côté plateforme (−cb)",
    (await platSum("cashback_expense")) - cbExpBefore,
    -cb
  );

  // ---------- 6. Abonnement Pro (CCP) : vérification puis activation ----------
  console.log("\n=== 6. Abonnement Pro (CCP, 3,5 %) ===");
  await as(CH_M);
  const sub = (await c.query("SELECT * FROM drive_subscribe('pro','ccp')"))
    .rows[0];
  ok("souscription créée (en vérification)", sub.ok, true);
  ok("montant = 1 500 DA (config)", sub.amount_da, 1500);
  let plan = (await c.query("SELECT * FROM resolve_drive_plan($1)", [chM]))
    .rows[0];
  ok("AVANT validation admin : plan reste Gratuit", plan.plan, "free");
  const subIncomeBefore = await platSum("drive_subscription_income");
  const paid = (
    await c.query("SELECT * FROM drive_sub_mark_paid($1,'admin@test')", [
      sub.payment_id,
    ])
  ).rows[0];
  ok("validation admin OK", paid.ok, true);
  plan = (await c.query("SELECT * FROM resolve_drive_plan($1)", [chM])).rows[0];
  ok("APRÈS validation : plan Pro", plan.plan, "pro");
  ok("taux Pro = 3,5 %", plan.rate, 0.035);
  ok(
    "recette abonnement comptabilisée (+1500)",
    (await platSum("drive_subscription_income")) - subIncomeBefore,
    1500
  );

  const r6 = await requestRide(CUST_USER, { price: 400 });
  await offer(CH_M, r6, 400);
  await acceptOffer(CUST_USER, r6, chM);
  await runToComplete(CH_M, r6);
  const row6 = (
    await c.query(
      "SELECT commission_da, chauffeur_net_da, cashback_da FROM rides WHERE id=$1",
      [r6]
    )
  ).rows[0];
  ok("commission Pro = 400×3,5 % = 14", row6.commission_da, 14);
  ok("net Pro = 386", row6.chauffeur_net_da, 386);
  ok("cashback plafonné par la commission (min(8,14)=8)", row6.cashback_da, 8);

  // ---------- 7. Premium (0 %) : net intégral, cashback 0 ----------
  console.log("\n=== 7. Abonnement Premium (0 %) ===");
  await as(CH_M);
  const sub2 = (
    await c.query("SELECT * FROM drive_subscribe('premium','card')")
  ).rows[0];
  await c.query("SELECT drive_sub_mark_paid($1,'webhook')", [sub2.payment_id]);
  plan = (await c.query("SELECT * FROM resolve_drive_plan($1)", [chM])).rows[0];
  ok("plan Premium actif", plan.plan, "premium");
  const r7 = await requestRide(CUST_USER, { price: 500 });
  await offer(CH_M, r7, 500);
  await acceptOffer(CUST_USER, r7, chM);
  await runToComplete(CH_M, r7);
  const row7 = (
    await c.query(
      "SELECT commission_da, chauffeur_net_da, cashback_da FROM rides WHERE id=$1",
      [r7]
    )
  ).rows[0];
  ok("commission Premium = 0", row7.commission_da, 0);
  ok("net Premium = 100 % du prix", row7.chauffeur_net_da, 500);
  ok("cashback Premium = 0 (financé par la commission)", row7.cashback_da, 0);

  // ---------- 8. Échéance impayée → retour Gratuit ----------
  console.log("\n=== 8. Recouvrement (retour Gratuit) ===");
  await c.query(
    "UPDATE chauffeur_subscriptions SET period_end = now() - interval '10 days' WHERE chauffeur_id=$1 AND status='active'",
    [chM]
  );
  const expired = await c.query("SELECT * FROM drive_sub_expire_job()");
  ok(
    "job d'expiration a traité le chauffeur",
    expired.rows.some((r) => r.chauffeur_id === chM),
    true
  );
  plan = (await c.query("SELECT * FROM resolve_drive_plan($1)", [chM])).rows[0];
  ok("retour automatique au plan Gratuit", plan.plan, "free");

  // ---------- 9. Gel automatique (dette > seuil) ----------
  console.log("\n=== 9. Gel automatique (dette) ===");
  await c.query(
    "INSERT INTO ride_ledger (chauffeur_id, type, amount_da) VALUES ($1,'chauffeur_owes_platform',6000)",
    [chM]
  );
  const frozen = await c.query("SELECT * FROM drive_freeze_job()");
  ok(
    "gel déclenché (dette 6 000 > 5 000)",
    frozen.rows.some((r) => r.chauffeur_id === chM),
    true
  );
  const chRow = (
    await c.query(
      "SELECT is_frozen, frozen_reason FROM chauffeurs WHERE id=$1",
      [chM]
    )
  ).rows[0];
  ok("chauffeur gelé", chRow.is_frozen, true);
  ok("motif renseigné", chRow.frozen_reason.includes("Impayé"), true);
  ok(
    "gelé → ne peut plus proposer",
    (await offer(CH_M, await requestRide(CUST2_USER, { price: 300 }), 300))
      .reason,
    "not_a_verified_chauffeur"
  );

  console.log(
    `\n${fail === 0 ? "🎉 DRIVE ARGENT + RÈGLES OK" : "⚠️ ÉCHECS"} — pass=${pass} fail=${fail}`
  );
} catch (e) {
  console.error("ERREUR:", e.message);
  fail++;
} finally {
  await c.query("ROLLBACK");
  await c.end();
}
process.exit(fail === 0 ? 0 : 1);
