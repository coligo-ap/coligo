// =============================================================================
// Test E2E « restauration course active » CLIENT (API) — compte de test réel.
//   1. Pas de course active → my_active_ride NULL (le formulaire s'afficherait).
//   2. Le client lance une demande → my_active_ride la RETROUVE (searching +
//      expires_at) → l'app restaure l'écran de recherche.
//   3. Re-demande alors qu'une course est active → request_ride REFUSE
//      (« Vous avez déjà une course en cours. ») → conflit + lien « reprendre ».
//   4. Deadline : demande expirée → auto-annulée → my_active_ride NULL → le
//      client peut RE-demander.
// Transaction rollback : rien ne persiste.  node scripts/test-drive-client-restore.mjs
// =============================================================================
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const PICKUP = { lat: 36.7585, lng: 3.05 };
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
  const cust = await c.query(
    "SELECT cu.id, cu.user_id FROM customers cu JOIN auth.users u ON u.id=cu.user_id WHERE u.email='qawaexpress@gmail.com' LIMIT 1"
  );
  const CUST = cust.rows[0].id;
  const UID = cust.rows[0].user_id;

  // État de départ propre : on solde toute course active du client (dans la txn,
  // AVANT d'impersonner — en superuser, sans RLS, pour que le ménage prenne).
  await c.query(
    "UPDATE rides SET status='cancelled', cancelled_at=now() WHERE customer_id=$1 AND status IN ('searching','accepted','arriving','arrived','in_progress')",
    [CUST]
  );

  // Impersonation client : les RPC (SECURITY DEFINER) lisent auth.uid() depuis
  // le claim JWT — pas besoin de changer de rôle de connexion.
  await c.query(
    `SELECT set_config('request.jwt.claims', json_build_object('sub','${UID}','role','authenticated')::text, true)`
  );

  // 1) Aucune course active.
  let act = await c.query("SELECT id, status FROM my_active_ride()");
  ok(
    "aucune course active ⇒ my_active_ride NULL (formulaire)",
    act.rows.length === 0
  );

  // 2) Le client lance une demande (cash, classic).
  const req1 = await c.query(
    "SELECT request_ride($1,$2,$3,$4,$5,$6,$7,$8,'cash') AS id",
    [
      PICKUP.lat,
      PICKUP.lng,
      "Départ test",
      DEST.lat,
      DEST.lng,
      "Arrivée test",
      3,
      200,
    ]
  );
  const RIDE = req1.rows[0].id;
  ok("la demande est créée", !!RIDE);

  // my_active_ride la retrouve (searching + expires_at).
  act = await c.query("SELECT id, status, expires_at FROM my_active_ride()");
  ok(
    "course active RETROUVÉE au retour (searching + échéance)",
    act.rows[0]?.id === RIDE &&
      act.rows[0]?.status === "searching" &&
      act.rows[0]?.expires_at != null,
    `status=${act.rows[0]?.status}`
  );

  // 3) Re-demande pendant une course active → REFUS (conflit).
  await c.query("SAVEPOINT sp_conflict");
  let conflict = false,
    msg = "";
  try {
    await c.query("SELECT request_ride($1,$2,$3,$4,$5,$6,$7,$8,'cash')", [
      PICKUP.lat,
      PICKUP.lng,
      "x",
      DEST.lat,
      DEST.lng,
      "y",
      3,
      200,
    ]);
  } catch (e) {
    conflict = true;
    msg = e.message;
    await c.query("ROLLBACK TO SAVEPOINT sp_conflict");
  }
  ok(
    "re-demande refusée (« déjà une course en cours »)",
    conflict && /déjà une course/i.test(msg),
    msg
  );

  // 4) Deadline : la course expire sans réponse → auto-annulée → re-demande OK.
  await c.query(
    "UPDATE rides SET expires_at = now() - interval '1 minute' WHERE id=$1",
    [RIDE]
  );
  await c.query("SELECT drive_expire_stale_searches()");
  act = await c.query("SELECT id FROM my_active_ride()");
  ok("après expiration ⇒ plus de course active", act.rows.length === 0);

  const req2 = await c.query(
    "SELECT request_ride($1,$2,$3,$4,$5,$6,$7,$8,'cash') AS id",
    [
      PICKUP.lat,
      PICKUP.lng,
      "Départ 2",
      DEST.lat,
      DEST.lng,
      "Arrivée 2",
      3,
      200,
    ]
  );
  ok("le client peut RE-demander après expiration", !!req2.rows[0].id);

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
