// =============================================================================
// Test abonnement Prioritaire (ch.7) — souscription + garde-fou dispatch.
// Transaction ROLLBACK : rien persisté.
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

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();
await c.query("BEGIN");

const as = (uid) =>
  c.query(
    `SELECT set_config('request.jwt.claims', json_build_object('sub','${uid}','role','authenticated')::text, true)`
  );
const blocks = async (type, id, createdAt) =>
  (
    await c.query("SELECT priority_window_blocks($1,$2,$3) b", [
      type,
      id,
      createdAt,
    ])
  ).rows[0].b;

try {
  // Délai connu pour le test.
  await c.query(
    "UPDATE platform_settings SET dispatch_priority_delay_sec = 30 WHERE id = true"
  );

  // Un client (pour la course).
  const CUST_USER = "00000000-0000-4000-8000-000820591480";
  const cust = (
    await c.query("SELECT id FROM customers WHERE user_id=$1", [CUST_USER])
  ).rows[0].id;

  // Deux chauffeurs vérifiés (A = futur abonné, B = gratuit).
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
  for (const u of [A_USER, B_USER]) {
    await c.query(
      `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       VALUES ('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated',$2,'x',now(),now(),now())`,
      [u, "prio-" + u.slice(0, 4) + "@test.local"]
    );
  }
  const chA = await mkCh(A_USER, "10001");
  const chB = await mkCh(B_USER, "10002");

  // Float pour A (paiement wallet de l'abo).
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

  // ── Souscription (wallet) par A ──
  await as(A_USER);
  const sub = (await c.query("SELECT priority_subscribe('wallet') r")).rows[0]
    .r;
  ok("souscription wallet OK", sub.ok, true);
  ok("statut actif immédiat", sub.status, "active");
  ok("1er mois (promo) appliqué", sub.is_first_month, true);

  await c.query("RESET ROLE");
  ok(
    "A est Prioritaire",
    await (async () =>
      (await c.query("SELECT is_priority('chauffeur',$1) p", [chA])).rows[0]
        .p)(),
    true
  );
  ok(
    "B n'est PAS Prioritaire",
    await (async () =>
      (await c.query("SELECT is_priority('chauffeur',$1) p", [chB])).rows[0]
        .p)(),
    false
  );

  // ── Course en recherche (créée maintenant → fenêtre active) ──
  const ride = (
    await c.query(
      `INSERT INTO rides (customer_id, status, pickup_lat, pickup_lng, pickup_text,
         dest_lat, dest_lng, dest_text, distance_km, suggested_price_da, proposed_price_da,
         payment_method, gamme, boost_amount_da, female_only, expires_at, created_at)
       VALUES ($1,'searching',36.75,3.06,'D',36.78,3.10,'A',5.0,400,400,'cash','classic',0,false,
         now()+interval '30 min', now()) RETURNING id, created_at`,
      [cust]
    )
  ).rows[0];

  // ── Helper window ──
  ok(
    "fenêtre BLOQUE le gratuit (B)",
    await blocks("chauffeur", chB, ride.created_at),
    true
  );
  ok(
    "fenêtre N'OUVRE PAS au prioritaire (A passe)",
    await blocks("chauffeur", chA, ride.created_at),
    false
  );

  // ── Offres pendant la fenêtre ──
  await as(B_USER);
  const offB1 = (
    await c.query("SELECT * FROM chauffeur_offer_ride($1,500)", [ride.id])
  ).rows[0];
  ok("B (gratuit) refusé pendant la fenêtre", offB1.reason, "priority_window");

  await as(A_USER);
  const offA = (
    await c.query("SELECT * FROM chauffeur_offer_ride($1,500)", [ride.id])
  ).rows[0];
  ok("A (prioritaire) accepté pendant la fenêtre", offA.ok, true);

  // ── Passé le délai (on recule created_at) → ouvert à TOUS (garde-fou) ──
  await c.query(
    "UPDATE rides SET created_at = now() - interval '60 sec' WHERE id=$1",
    [ride.id]
  );
  ok(
    "après délai, le gratuit n'est plus bloqué",
    await blocks(
      "chauffeur",
      chB,
      (await c.query("SELECT created_at FROM rides WHERE id=$1", [ride.id]))
        .rows[0].created_at
    ),
    false
  );
  await as(B_USER);
  const offB2 = (
    await c.query("SELECT * FROM chauffeur_offer_ride($1,500)", [ride.id])
  ).rows[0];
  ok("B (gratuit) accepté APRÈS le délai", offB2.ok, true);

  console.log(
    `\n${fail === 0 ? "🎉 PRIORITÉ DISPATCH OK" : "⚠️ ÉCHECS"} — pass=${pass} fail=${fail}`
  );
} finally {
  await c.query("ROLLBACK");
  await c.end();
}
process.exit(fail === 0 ? 0 : 1);
