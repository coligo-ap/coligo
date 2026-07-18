// Test e2e (ROLLBACK) — partage du numéro client au chauffeur.
// Prouve : (1) le numéro est MASQUÉ par défaut ; (2) seul le CLIENT propriétaire
// peut basculer le partage (set_ride_phone_shared) ; (3) le flag pilote
// l'exposition (gating). Le gating final est dans getChauffeurActiveRide (TS) :
// customer_phone = client_phone_shared ? phone : null — ici on prouve le flag.
// Exécution : node scripts/test-ride-phone-share.mjs
import { getDbUrl } from "./_supabase.mjs";
import pg from "pg";

let pass = 0,
  fail = 0;
const ok = (c, l) =>
  c ? (pass++, console.log("  ✅", l)) : (fail++, console.log("  ❌", l));

const c = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});
await c.connect();

async function asUser(uid) {
  await c.query("select set_config('role','authenticated',true)");
  await c.query(
    `select set_config('request.jwt.claims', json_build_object('sub',$1::text,'role','authenticated')::text, true)`,
    [uid]
  );
}
async function asService() {
  await c.query("select set_config('role','service_role',true)");
  await c.query("select set_config('request.jwt.claims','', true)");
}

try {
  await c.query("BEGIN");
  await asService();

  // Deux clients EXISTANTS (avec user_id) — pas de création auth.users.
  const custs = (
    await c.query(
      "select id, user_id from customers where user_id is not null limit 2"
    )
  ).rows;
  if (custs.length < 2) throw new Error("besoin de 2 clients existants");
  const A = { cust: custs[0].id, u: custs[0].user_id };
  const B = { cust: custs[1].id, u: custs[1].user_id };
  const ride = (
    await c.query(
      `INSERT INTO rides (customer_id, status, pickup_text, dest_text,
         pickup_lat, pickup_lng, dest_lat, dest_lng)
       VALUES ($1,'accepted','x','y',36.75,3.06,36.70,3.05)
       RETURNING id, client_phone_shared`,
      [A.cust]
    )
  ).rows[0];

  // Mig 0380 : le numéro est AFFICHÉ par défaut, le client peut le MASQUER.
  ok(ride.client_phone_shared === true, "par défaut : numéro AFFICHÉ (true)");

  // B (autre client) tente de MASQUER la course de A → refusé (FOUND false).
  await asUser(B.u);
  const rB = (
    await c.query("select public.set_ride_phone_shared($1,false) as r", [
      ride.id,
    ])
  ).rows[0].r;
  ok(rB === false, "un AUTRE client ne peut pas modifier la course de A");
  await asService();
  ok(
    (
      await c.query("select client_phone_shared from rides where id=$1", [
        ride.id,
      ])
    ).rows[0].client_phone_shared === true,
    "→ flag inchangé après tentative non autorisée"
  );

  // A (propriétaire) MASQUE → ok.
  await asUser(A.u);
  const rA = (
    await c.query("select public.set_ride_phone_shared($1,false) as r", [
      ride.id,
    ])
  ).rows[0].r;
  ok(rA === true, "le CLIENT propriétaire peut masquer son numéro");
  await asService();
  ok(
    (
      await c.query("select client_phone_shared from rides where id=$1", [
        ride.id,
      ])
    ).rows[0].client_phone_shared === false,
    "→ flag = false (numéro JAMAIS envoyé au chauffeur)"
  );

  // A ré-affiche → true (le bouton direct réapparaît côté chauffeur).
  await asUser(A.u);
  await c.query("select public.set_ride_phone_shared($1,true)", [ride.id]);
  await asService();
  ok(
    (
      await c.query("select client_phone_shared from rides where id=$1", [
        ride.id,
      ])
    ).rows[0].client_phone_shared === true,
    "le client peut ré-afficher à tout moment"
  );

  await c.query("ROLLBACK");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("ERREUR:", e.message);
  fail++;
} finally {
  await c.end();
}

console.log(`\n${pass}/${pass + fail} OK`);
process.exit(fail ? 1 : 0);
