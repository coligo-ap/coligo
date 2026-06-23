// =============================================================================
// Test E2E « réception temps réel » chauffeur (API) — comptes de test réels.
//   1. Client lance une demande à côté du chauffeur → le chauffeur la VOIT
//      (chauffeur_nearby_rides) ET serait NOTIFIÉ (chauffeurs_present_near).
//   2. Présence PÉRIMÉE (> 3 min) → plus de push, mais la liste marche encore
//      (elle dépend des coords passées par le front, pas de la fraîcheur).
//   3. Deadline : demande expirée sans réponse → auto-annulée (mig 0250) et
//      disparaît de la liste.
// Tout en TRANSACTION rollback : rien ne persiste, aucune notif réelle.
//   node scripts/test-chauffeur-realtime.mjs
// =============================================================================
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const P = { lat: 36.7525, lng: 3.042 }; // Alger centre (chauffeur)
const PICKUP = { lat: 36.7585, lng: 3.05 }; // ~1 km du chauffeur
const DEST = { lat: 36.78, lng: 3.06 };

let pass = 0,
  fail = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
  cond ? pass++ : fail++;
};

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();
await c.query("BEGIN");
try {
  // Comptes de test.
  const chu = await c.query(
    "SELECT id, user_id FROM chauffeurs WHERE phone LIKE '%603044618%' LIMIT 1"
  );
  const CH = chu.rows[0].id;
  const CH_UID = chu.rows[0].user_id;
  const cust = await c.query(
    "SELECT cu.id FROM customers cu JOIN auth.users u ON u.id=cu.user_id WHERE u.email='qawaexpress@gmail.com' LIMIT 1"
  );
  const CUST = cust.rows[0].id;

  const asChu = () =>
    c.query(
      `SELECT set_config('request.jwt.claims', json_build_object('sub','${CH_UID}','role','authenticated')::text, true)`
    );

  // Chauffeur : vérifié, classic, rayon 10, en ligne + présence FRAÎCHE à P.
  await c.query(
    "UPDATE chauffeurs SET is_verified=true, is_frozen=false, is_blocked=false, gamme='classic', work_zone_radius_km=10, home_dir_active=false WHERE id=$1",
    [CH]
  );
  await c.query(
    `INSERT INTO chauffeur_presence (chauffeur_id, lat, lng, is_online, updated_at)
     VALUES ($1,$2,$3,true,now())
     ON CONFLICT (chauffeur_id) DO UPDATE SET lat=$2, lng=$3, is_online=true, updated_at=now()`,
    [CH, P.lat, P.lng]
  );

  // Le client lance une demande (searching, cash, classic, TTL 30 min) près de P.
  const ins = await c.query(
    `INSERT INTO rides (customer_id, status, gamme, female_only, payment_method,
        proposed_price_da, boost_amount_da, distance_km,
        pickup_text, pickup_lat, pickup_lng, dest_text, dest_lat, dest_lng,
        expires_at)
     VALUES ($1,'searching','classic',false,'cash',200,0,3,
        'Départ test',$2,$3,'Arrivée test',$4,$5, now() + interval '30 minutes')
     RETURNING id`,
    [CUST, PICKUP.lat, PICKUP.lng, DEST.lat, DEST.lng]
  );
  const RIDE = ins.rows[0].id;

  // 1) LISTE chauffeur (ce que le front appelle via getNearbyRides).
  await asChu();
  const list = await c.query(
    "SELECT id FROM chauffeur_nearby_rides($1,$2,null)",
    [P.lat, P.lng]
  );
  ok(
    "le chauffeur VOIT la demande dans sa liste",
    list.rows.some((r) => r.id === RIDE),
    `liste=${list.rows.length}`
  );

  // 2) PUSH : le trigger cible-t-il ce chauffeur ? (présence fraîche)
  await c.query("SELECT set_config('role','service_role',true)"); // lecture large
  const near = await c.query(
    "SELECT chauffeur_id FROM chauffeurs_present_near($1,$2,10,3,'classic',false,$3)",
    [PICKUP.lat, PICKUP.lng, CUST]
  );
  ok(
    "le chauffeur serait NOTIFIÉ (présence fraîche)",
    near.rows.some((r) => r.chauffeur_id === CH)
  );

  // 3) Présence PÉRIMÉE (> 3 min) → plus de push, MAIS la liste marche encore.
  await c.query(
    "UPDATE chauffeur_presence SET updated_at = now() - interval '5 minutes' WHERE chauffeur_id=$1",
    [CH]
  );
  const nearStale = await c.query(
    "SELECT chauffeur_id FROM chauffeurs_present_near($1,$2,10,3,'classic',false,$3)",
    [PICKUP.lat, PICKUP.lng, CUST]
  );
  ok(
    "présence périmée ⇒ PAS de push (cohérent : il faut un heartbeat récent)",
    !nearStale.rows.some((r) => r.chauffeur_id === CH)
  );
  await asChu();
  const listStale = await c.query(
    "SELECT id FROM chauffeur_nearby_rides($1,$2,null)",
    [P.lat, P.lng]
  );
  ok(
    "présence périmée : la LISTE montre quand même la course (dépend du poll, pas de la fraîcheur)",
    listStale.rows.some((r) => r.id === RIDE)
  );

  // 4) DEADLINE : demande expirée sans réponse → auto-annulée.
  await c.query(
    "UPDATE rides SET expires_at = now() - interval '1 minute' WHERE id=$1",
    [RIDE]
  );
  const n = await c.query("SELECT drive_expire_stale_searches() AS n");
  const st = await c.query(
    "SELECT status, cancelled_by FROM rides WHERE id=$1",
    [RIDE]
  );
  ok(
    "demande expirée sans réponse ⇒ auto-annulée (system_timeout)",
    st.rows[0].status === "cancelled" &&
      st.rows[0].cancelled_by === "system_timeout",
    `status=${st.rows[0].status}, by=${st.rows[0].cancelled_by}, n=${n.rows[0].n}`
  );
  await asChu();
  const listAfter = await c.query(
    "SELECT id FROM chauffeur_nearby_rides($1,$2,null)",
    [P.lat, P.lng]
  );
  ok(
    "course annulée ⇒ disparaît de la liste chauffeur",
    !listAfter.rows.some((r) => r.id === RIDE)
  );

  console.log(
    `\n${fail === 0 ? "🎉" : "⚠️"} RÉSULTAT — pass=${pass} fail=${fail}`
  );
} catch (e) {
  console.error("ERREUR:", e.message);
  fail++;
} finally {
  await c.query("ROLLBACK");
  await c.end();
}
process.exit(fail === 0 ? 0 : 1);
