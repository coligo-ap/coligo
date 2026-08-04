// =============================================================================
// Mesures anti-fraude — la mesure enregistrée est-elle RÉELLEMENT vue par
// l'application du client ?
//
// C'est le maillon qui manquait : les boutons du super-admin écrivaient bien
// dans `fraud_actions`, mais rien ne garantissait que le client la subisse.
// On pose donc chaque mesure et on interroge `customer_fraud_gate()` en se
// faisant passer pour CE client (auth.uid() simulé), exactement comme le fait
// l'application.
//
// TOUT se joue dans une transaction ANNULÉE : aucune donnée n'est modifiée.
// Lancer : node scripts/test-fraud-gate.mjs
// =============================================================================
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

let pass = 0,
  fail = 0;
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const c = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});
await c.connect();

// Un client réel qui a bien un compte d'authentification.
const { rows } = await c.query(
  "select id, user_id, full_name from customers where user_id is not null limit 1"
);
const cust = rows[0];
ok("client de test trouvé", !!cust, cust?.full_name ?? "");

/** Interroge la porte EN SE FAISANT PASSER pour ce client. */
async function gate() {
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: cust.user_id, role: "authenticated" }),
  ]);
  await c.query("set local role authenticated");
  const r = await c.query("select customer_fraud_gate() g");
  await c.query("reset role");
  return r.rows[0].g;
}

async function withAction(action, fn) {
  await c.query("savepoint sp");
  await c.query(
    `insert into fraud_actions (actor_kind, actor_id, user_id, action, source, admin_email, reason)
     values ('customer', $1, $2, $3, 'admin', 'test@coligo', 'test automatisé')`,
    [cust.id, cust.user_id, action]
  );
  await fn();
  await c.query("rollback to savepoint sp");
}

await c.query("begin");

// État de départ : la porte doit être OUVERTE (sinon le test ne veut rien dire).
// On neutralise d'abord les mesures déjà en base pour ce client.
await c.query(
  "update fraud_actions set revoked_at = now() where actor_id = $1 and revoked_at is null",
  [cust.id]
);
const base = await gate();
ok(
  "porte ouverte au départ",
  !base.suspended && !base.require_ack && !base.limited && !base.require_idv,
  JSON.stringify(base)
);

// ── Chaque mesure doit être VUE par l'application ─────────────────────────
await withAction("suspend", async () => {
  const g = await gate();
  ok(
    "suspend → compte suspendu vu par l'app",
    g.suspended === true,
    JSON.stringify(g)
  );
});

await withAction("require_ack", async () => {
  const g = await gate();
  ok(
    "require_ack → pop-up obligatoire vue par l'app",
    g.require_ack === true,
    JSON.stringify(g)
  );
});

await withAction("limit", async () => {
  const g = await gate();
  ok("limit → limitation vue par l'app", g.limited === true, JSON.stringify(g));
});

await withAction("require_idv", async () => {
  const g = await gate();
  ok(
    "require_idv → vérification exigée vue par l'app",
    g.require_idv === true,
    JSON.stringify(g)
  );
});

// ── Une mesure RÉVOQUÉE ne doit plus rien bloquer ─────────────────────────
await c.query("savepoint sp2");
await c.query(
  `insert into fraud_actions (actor_kind, actor_id, user_id, action, source, admin_email, reason, revoked_at)
   values ('customer', $1, $2, 'suspend', 'admin', 'test@coligo', 'test', now())`,
  [cust.id, cust.user_id]
);
const gRevoked = await gate();
ok("mesure révoquée → plus aucun blocage", gRevoked.suspended === false);
await c.query("rollback to savepoint sp2");

// ── Une mesure EXPIRÉE ne doit plus rien bloquer ──────────────────────────
await c.query("savepoint sp3");
await c.query(
  `insert into fraud_actions (actor_kind, actor_id, user_id, action, source, admin_email, reason, expires_at)
   values ('customer', $1, $2, 'suspend', 'admin', 'test@coligo', 'test', now() - interval '1 hour')`,
  [cust.id, cust.user_id]
);
const gExpired = await gate();
ok("mesure expirée → plus aucun blocage", gExpired.suspended === false);
await c.query("rollback to savepoint sp3");

await c.query("rollback"); // ← AUCUNE donnée modifiée
console.log("\nTransaction annulée — base intacte.");
console.log(`${pass} réussis, ${fail} échoués`);
await c.end();
process.exit(fail === 0 ? 0 : 1);
