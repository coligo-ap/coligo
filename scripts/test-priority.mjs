// =============================================================================
// Test abonnement Prioritaire (ch.7) — souscription + garde-fou dispatch
// « candidate-aware » (la priorité ne pénalise personne s'il n'y a pas d'abonné
// en ligne à proximité). Transaction ROLLBACK : rien persisté.
//   node scripts/test-priority.mjs   (npm run test:priority)
// =============================================================================
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

let pass = 0,
  fail = 0;
const ok = (l, g, w) => {
  const p = g === w || String(g) === String(w);
  console.log(`${p ? "✅" : "❌"} ${l}: got=${g} want=${w}`);
  p ? pass++ : fail++;
};

const M = "6a57ea14-40e3-47c6-9fc8-305d8bbb5bdd"; // commerçant de test (coords réelles)
const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();
await c.query("BEGIN");

const as = (uid) =>
  c.query(
    `SELECT set_config('request.jwt.claims', json_build_object('sub','${uid}','role','authenticated')::text, true)`
  );
const reset = () =>
  c
    .query("RESET ROLE")
    .then(() => c.query("SELECT set_config('request.jwt.claims','',true)"));
const blocks = async (type, id, createdAt) =>
  (
    await c.query("SELECT priority_window_blocks($1,$2,$3) b", [
      type,
      id,
      createdAt,
    ])
  ).rows[0].b;
const candidate = async (svc, lat, lng, rad, excl) =>
  (
    await c.query("SELECT priority_candidate_near($1,$2,$3,$4,$5) b", [
      svc,
      lat,
      lng,
      rad,
      excl,
    ])
  ).rows[0].b;
const offer = async (uid, ride, price) => {
  await as(uid);
  return (
    await c.query("SELECT * FROM chauffeur_offer_ride($1,$2)", [ride, price])
  ).rows[0];
};

try {
  await c.query(
    "UPDATE platform_settings SET dispatch_priority_delay_sec = 30 WHERE id = true"
  );
  const CUST_USER = "00000000-0000-4000-8000-000820591480";
  const cust = (
    await c.query("SELECT id FROM customers WHERE user_id=$1", [CUST_USER])
  ).rows[0].id;
  const PLAT = await c.query(
    "SELECT pickup_lat, pickup_lng FROM rides LIMIT 0"
  );
  // coords de référence (course + marchand).
  const RLAT = 36.75,
    RLNG = 3.06;

  // ── Deux chauffeurs vérifiés : A (abonné) et B (gratuit) ──
  async function mkCh(uid, plate) {
    const r = await c.query(
      `INSERT INTO chauffeurs (user_id, full_name, first_name, phone, is_verified, vehicle_plate,
         vehicle_make, vehicle_model, vehicle_color, gamme)
       VALUES ($1,'Test Ch','Test',$2,true,$3,'Chevrolet','Beat','Blanche','classic') RETURNING id`,
      [uid, "+2137009" + plate, plate]
    );
    return r.rows[0].id;
  }
  const A_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  for (const [u, e] of [
    [A_USER, "a"],
    [B_USER, "b"],
  ]) {
    await c.query(
      `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       VALUES ('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated',$2,'x',now(),now(),now())`,
      [u, "prio-" + e + "@test.local"]
    );
  }
  const chA = await mkCh(A_USER, "10001");
  const chB = await mkCh(B_USER, "10002");

  // Float A + souscription wallet.
  await c.query("SELECT ensure_operator_wallet('chauffeur',$1,now())", [chA]);
  const wA = (
    await c.query(
      "SELECT id FROM operator_wallets WHERE owner_type='chauffeur' AND owner_id=$1",
      [chA]
    )
  ).rows[0].id;
  await c.query(
    "INSERT INTO operator_wallet_entries (wallet_id, type, amount_da, note) VALUES ($1,'topup_manual',5000,'test')",
    [wA]
  );

  await as(A_USER);
  const sub = (await c.query("SELECT priority_subscribe('wallet') r")).rows[0]
    .r;
  ok("souscription wallet OK", sub.ok, true);
  ok("statut actif immédiat", sub.status, "active");
  ok("1er mois (promo) appliqué", sub.is_first_month, true);
  await reset();
  ok(
    "A est Prioritaire",
    (await c.query("SELECT is_priority('chauffeur',$1) p", [chA])).rows[0].p,
    true
  );
  ok(
    "B n'est PAS Prioritaire",
    (await c.query("SELECT is_priority('chauffeur',$1) p", [chB])).rows[0].p,
    false
  );

  // A EN LIGNE à proximité (candidat prioritaire réel).
  await c.query(
    `INSERT INTO chauffeur_presence (chauffeur_id, lat, lng, is_online, updated_at)
     VALUES ($1,$2,$3,true,now()) ON CONFLICT (chauffeur_id) DO UPDATE SET lat=$2,lng=$3,is_online=true,updated_at=now()`,
    [chA, RLAT, RLNG]
  );
  ok(
    "candidat prioritaire détecté (A en ligne)",
    await candidate("drive", RLAT, RLNG, 8, chB),
    true
  );

  // ── Course 1 : fenêtre active + candidat prioritaire présent ──
  const mkRide = async () =>
    (
      await c.query(
        `INSERT INTO rides (customer_id, status, pickup_lat, pickup_lng, pickup_text,
         dest_lat, dest_lng, dest_text, distance_km, suggested_price_da, proposed_price_da,
         payment_method, gamme, boost_amount_da, female_only, expires_at, created_at)
       VALUES ($1,'searching',$2,$3,'D',36.78,3.10,'A',5.0,400,400,'cash','classic',0,false,
         now()+interval '30 min', now()) RETURNING id, created_at`,
        [cust, RLAT, RLNG]
      )
    ).rows[0];
  const ride1 = await mkRide();

  ok(
    "fenêtre temps: B dans la fenêtre",
    await blocks("chauffeur", chB, ride1.created_at),
    true
  );
  const offB1 = await offer(B_USER, ride1.id, 500);
  ok(
    "B (gratuit) REFUSÉ pendant la fenêtre (A candidat en ligne)",
    offB1.reason,
    "priority_window"
  );
  const offA = await offer(A_USER, ride1.id, 500);
  ok("A (prioritaire) accepté pendant la fenêtre", offA.ok, true);

  // Passé le délai → ouvert à tous.
  await c.query(
    "UPDATE rides SET created_at = now() - interval '60 sec' WHERE id=$1",
    [ride1.id]
  );
  const offB2 = await offer(B_USER, ride1.id, 500);
  ok("B accepté APRÈS le délai (garde-fou)", offB2.ok, true);

  // ── Course 2 : A HORS LIGNE → aucun candidat prioritaire → PAS de blocage ──
  await c.query(
    "UPDATE chauffeur_presence SET is_online=false WHERE chauffeur_id=$1",
    [chA]
  );
  ok(
    "plus de candidat prioritaire (A hors ligne)",
    await candidate("drive", RLAT, RLNG, 8, chB),
    false
  );
  const ride2 = await mkRide();
  const offB3 = await offer(B_USER, ride2.id, 500);
  ok(
    "B accepté IMMÉDIATEMENT (aucun abonné en ligne → pas de délai)",
    offB3.ok,
    true
  );
  await reset();

  // ── Express : candidat prioritaire livreur près du marchand ──
  const mc = (
    await c.query(
      "SELECT latitude lat, longitude lng FROM merchants WHERE id=$1",
      [M]
    )
  ).rows[0];
  const D_USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  await c.query(
    `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
     VALUES ('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated','prio-d@test.local','x',now(),now(),now())`,
    [D_USER]
  );
  const drvP = (
    await c.query(
      "INSERT INTO drivers (user_id, full_name, phone) VALUES ($1,'Livreur Prio','+213700112233') RETURNING id",
      [D_USER]
    )
  ).rows[0].id;
  // abonnement direct (superuser) + présence en ligne près du marchand.
  await c.query(
    `INSERT INTO priority_subscriptions (subject_type, subject_id, status, period_start, period_end, amount_da, payment_method)
     VALUES ('driver',$1,'active',now(),now()+interval '30 days',100,'wallet')`,
    [drvP]
  );
  await c.query(
    "INSERT INTO driver_presence (driver_id, lat, lng, updated_at) VALUES ($1,$2,$3,now())",
    [drvP, Number(mc.lat), Number(mc.lng)]
  );
  ok(
    "candidat prioritaire LIVREUR détecté près du marchand",
    await candidate("express", Number(mc.lat), Number(mc.lng), 6, null),
    true
  );
  await c.query(
    "UPDATE driver_presence SET updated_at = now() - interval '20 min' WHERE driver_id=$1",
    [drvP]
  );
  ok(
    "livreur prioritaire hors ligne → plus de candidat",
    await candidate("express", Number(mc.lat), Number(mc.lng), 6, null),
    false
  );

  console.log(
    `\n${fail === 0 ? "🎉 PRIORITÉ DISPATCH (candidate-aware) OK" : "⚠️ ÉCHECS"} — pass=${pass} fail=${fail}`
  );
} finally {
  await c.query("ROLLBACK");
  await c.end();
}
process.exit(fail === 0 ? 0 : 1);
