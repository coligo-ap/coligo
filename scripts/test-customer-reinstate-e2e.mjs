// =============================================================================
// E2E — suspension & RÉACTIVATION TOTALE d'un client (les DEUX systèmes).
//
// Vérifie de bout en bout, sur la base de PROD mais en TRANSACTION ANNULÉE
// (ROLLBACK final : aucun état modifié) :
//   1. l'état de départ est cohérent (sanction anti-fraude « suspend » active
//      ⇒ le client voit « suspendu » via customer_fraud_gate ET l'annuaire
//      admin le voit suspendu via fraud_suspended — mig 0435) ;
//   2. le blocage MANUEL (admin_set_customer_block true) se pose et se voit ;
//   3. la RÉACTIVATION TOTALE (ce que fait reinstateCustomerAction : unblock
//      + révocation de chaque sanction « suspend » active) rend le compte
//      RÉELLEMENT actif : is_blocked=false, gate.suspended=false,
//      annuaire fraud_suspended=false ;
//   4. après ROLLBACK, l'état initial est intact.
//
// Identités simulées par request.jwt.claims (set_config LOCAL, comme PostgREST) :
// admin = e-mail platform_admins ; client = sub = auth user_id.
//
// Usage : npm run test:customer:reinstate  (ou node scripts/test-customer-reinstate-e2e.mjs)
// =============================================================================

import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const EMAIL = process.env.TEST_CUSTOMER_EMAIL ?? "qawaexpress@gmail.com";
const ADMIN_EMAIL = "coligo.noreply@gmail.com";

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();

let failures = 0;
function check(label, ok, extra = "") {
  const mark = ok ? "✅" : "❌";
  console.log(`${mark} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures += 1;
}

/** Pose l'identité JWT simulée, LOCALE à la transaction en cours. */
async function actAs(claims) {
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify(claims),
  ]);
}
const asAdmin = () => actAs({ email: ADMIN_EMAIL, role: "authenticated" });
const asCustomer = (userId) => actAs({ sub: userId, role: "authenticated" });

async function customerState(id) {
  const r = await c.query(
    "select is_blocked from public.customers where id = $1",
    [id]
  );
  const s = await c.query(
    `select count(*)::int as n from public.fraud_actions
      where actor_kind='customer' and actor_id=$1 and action='suspend'
        and revoked_at is null and (expires_at is null or expires_at > now())`,
    [id]
  );
  return { is_blocked: r.rows[0].is_blocked, activeSuspends: s.rows[0].n };
}

async function gateAsCustomer(userId) {
  await asCustomer(userId);
  const r = await c.query("select public.customer_fraud_gate() as g");
  await asAdmin();
  return r.rows[0].g;
}

async function directoryRow(q) {
  await asAdmin();
  const r = await c.query(
    `select is_blocked, fraud_suspended
       from public.admin_customers_directory(p_q := $1, p_limit := 5)`,
    [q]
  );
  return r.rows[0] ?? null;
}

try {
  const cust = await c.query(
    "select id, user_id, full_name from public.customers where email = $1",
    [EMAIL]
  );
  if (!cust.rows[0]) {
    console.error(`Client introuvable : ${EMAIL}`);
    process.exit(1);
  }
  const { id, user_id, full_name } = cust.rows[0];
  console.log(`Client testé : ${full_name} <${EMAIL}> (${id})\n`);

  const initial = await customerState(id);
  console.log(
    `État initial : is_blocked=${initial.is_blocked}, sanctions suspend actives=${initial.activeSuspends}\n`
  );

  await c.query("begin");
  await asAdmin();

  // --- 1. Cohérence de l'état de départ (les 3 surfaces racontent pareil) ---
  const gate0 = await gateAsCustomer(user_id);
  const dir0 = await directoryRow(EMAIL);
  const suspended0 = initial.is_blocked || initial.activeSuspends > 0;
  check(
    "Départ : gate client == vérité DB",
    !!gate0.suspended === initial.activeSuspends > 0 ||
      !!gate0.suspended === suspended0,
    `gate.suspended=${gate0.suspended}`
  );
  check(
    "Départ : annuaire == vérité DB (fraud_suspended)",
    !!dir0?.fraud_suspended === initial.activeSuspends > 0,
    `annuaire.fraud_suspended=${dir0?.fraud_suspended}`
  );

  // --- 2. Blocage MANUEL : se pose et se voit partout ---
  await c.query(
    "select public.admin_set_customer_block($1, true, 'TEST E2E — blocage manuel')",
    [id]
  );
  const afterBlock = await customerState(id);
  check(
    "Blocage manuel posé (is_blocked=true)",
    afterBlock.is_blocked === true
  );
  const dirBlocked = await directoryRow(EMAIL);
  check("Annuaire voit le blocage manuel", dirBlocked?.is_blocked === true);

  // --- 3. RÉACTIVATION TOTALE (le flux de reinstateCustomerAction) ---
  await c.query("select public.admin_set_customer_block($1, false, null)", [
    id,
  ]);
  const toRevoke = await c.query(
    `select id from public.fraud_actions
      where actor_kind='customer' and actor_id=$1 and action='suspend'
        and revoked_at is null and (expires_at is null or expires_at > now())`,
    [id]
  );
  for (const row of toRevoke.rows) {
    const r = await c.query(
      "select public.admin_fraud_revoke_action($1, 'TEST E2E — réactivation totale') as res",
      [row.id]
    );
    check(
      `Sanction ${row.id.slice(0, 8)}… révoquée`,
      r.rows[0].res?.ok === true
    );
  }

  const afterReinstate = await customerState(id);
  check(
    "Après réactivation : is_blocked=false",
    afterReinstate.is_blocked === false
  );
  check(
    "Après réactivation : plus AUCUNE sanction suspend active",
    afterReinstate.activeSuspends === 0
  );
  const gate1 = await gateAsCustomer(user_id);
  check(
    "Après réactivation : le CLIENT n'est plus suspendu (gate)",
    gate1.suspended === false,
    `gate=${JSON.stringify(gate1)}`
  );
  const dir1 = await directoryRow(EMAIL);
  check(
    "Après réactivation : l'annuaire admin le voit ACTIF",
    dir1?.is_blocked === false && dir1?.fraud_suspended === false
  );

  await c.query("rollback");

  // --- 4. ROLLBACK : rien n'a bougé en prod ---
  const final = await customerState(id);
  check(
    "ROLLBACK : état initial intact",
    final.is_blocked === initial.is_blocked &&
      final.activeSuspends === initial.activeSuspends,
    `is_blocked=${final.is_blocked}, suspends=${final.activeSuspends}`
  );

  console.log(
    failures === 0
      ? "\nTOUT EST VERT — la réactivation totale fonctionne de bout en bout."
      : `\n${failures} ÉCHEC(S) — voir ci-dessus.`
  );
  process.exit(failures === 0 ? 0 : 1);
} catch (e) {
  try {
    await c.query("rollback");
  } catch {
    /* déjà hors transaction */
  }
  console.error("ERREUR :", e.message);
  process.exit(1);
} finally {
  await c.end();
}
