// =============================================================================
// E2E — suspension anti-fraude & RÉACTIVATION TOTALE des PARTENAIRES
// (livreur, chauffeur, commerçant), en TRANSACTION ANNULÉE sur la prod.
//
// Pour chaque population :
//   1. sanction « suspend » posée par le module (admin_fraud_apply_action)
//      ⇒ le compte passe is_frozen=true (effet de bord, mig 0374) ;
//   2. DÉGEL TOTAL (le flux des fiches : unfreeze natif + révocation des
//      sanctions « suspend » actives — lib/fraud/reinstate) ⇒ is_frozen=false
//      ET plus aucune sanction active (fini le « dégelé mais toujours marqué ») ;
//   3. « hors ligne forcé » : posé ⇒ actif (enforcement isForcedOffline),
//      levé (admin_fraud_revoke_action) ⇒ plus actif ;
//   4. ROLLBACK — l'état initial de chaque compte est intact.
//
// Identité admin simulée par request.jwt.claims (set_config LOCAL).
// Usage : npm run test:partner:reinstate
// =============================================================================

import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const ADMIN_EMAIL = "coligo.noreply@gmail.com";
const KINDS = [
  { kind: "driver", table: "drivers", label: "Livreur" },
  { kind: "chauffeur", table: "chauffeurs", label: "Chauffeur" },
  { kind: "merchant", table: "merchants", label: "Commerçant" },
];

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();

let failures = 0;
function check(label, ok, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures += 1;
}

async function asAdmin() {
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ email: ADMIN_EMAIL, role: "authenticated" }),
  ]);
}

async function state(table, id) {
  const r = await c.query(
    `select is_frozen from public.${table} where id = $1`,
    [id]
  );
  const s = await c.query(
    `select
       count(*) filter (where action='suspend')::int as suspends,
       count(*) filter (where action='force_offline')::int as offline
     from public.fraud_actions
     where actor_kind=$1 and actor_id=$2 and revoked_at is null
       and (expires_at is null or expires_at > now())`,
    [
      table === "drivers"
        ? "driver"
        : table === "chauffeurs"
          ? "chauffeur"
          : "merchant",
      id,
    ]
  );
  return { is_frozen: r.rows[0]?.is_frozen ?? null, ...s.rows[0] };
}

try {
  for (const { kind, table, label } of KINDS) {
    const target = await c.query(
      `select id, ${table === "merchants" ? "name as full_name" : "full_name"}
         from public.${table} order by created_at desc limit 1`
    );
    if (!target.rows[0]) {
      console.log(`(aucun ${label.toLowerCase()} en base — population sautée)`);
      continue;
    }
    const { id, full_name } = target.rows[0];
    console.log(`\n=== ${label} : ${full_name} (${id}) ===`);
    const initial = await state(table, id);

    await c.query("begin");
    await asAdmin();

    // 1. Suspension anti-fraude ⇒ gel natif (effet de bord).
    const applied = await c.query(
      "select public.admin_fraud_apply_action($1, $2, 'suspend', 'TEST E2E partenaire') as res",
      [kind, id]
    );
    check(`${label} : sanction posée`, applied.rows[0].res?.ok === true);
    const afterSuspend = await state(table, id);
    check(
      `${label} : suspend ⇒ is_frozen=true`,
      afterSuspend.is_frozen === true,
      `suspends=${afterSuspend.suspends}`
    );

    // 2. DÉGEL TOTAL (flux des fiches) : unfreeze natif + révocation.
    await c.query(`update public.${table} set is_frozen=false where id = $1`, [
      id,
    ]);
    const toRevoke = await c.query(
      `select id from public.fraud_actions
        where actor_kind=$1 and actor_id=$2 and action='suspend'
          and revoked_at is null and (expires_at is null or expires_at > now())`,
      [kind, id]
    );
    for (const row of toRevoke.rows) {
      await c.query(
        "select public.admin_fraud_revoke_action($1, 'TEST E2E — dégel total') as res",
        [row.id]
      );
    }
    const afterReinstate = await state(table, id);
    check(
      `${label} : dégel total ⇒ is_frozen=false ET 0 sanction active`,
      afterReinstate.is_frozen === false && afterReinstate.suspends === 0
    );

    // 3. Hors ligne forcé : posé ⇒ actif ; levé ⇒ inactif.
    await c.query(
      "select public.admin_fraud_apply_action($1, $2, 'force_offline', 'TEST E2E hors ligne') as res",
      [kind, id]
    );
    const afterOffline = await state(table, id);
    check(`${label} : hors ligne forcé ACTIF`, afterOffline.offline > 0);
    const off = await c.query(
      `select id from public.fraud_actions
        where actor_kind=$1 and actor_id=$2 and action='force_offline'
          and revoked_at is null`,
      [kind, id]
    );
    for (const row of off.rows) {
      await c.query(
        "select public.admin_fraud_revoke_action($1, 'TEST E2E — levée') as res",
        [row.id]
      );
    }
    const afterRevokeOffline = await state(table, id);
    check(`${label} : hors ligne forcé LEVÉ`, afterRevokeOffline.offline === 0);

    await c.query("rollback");

    // 4. ROLLBACK : rien n'a bougé.
    const final = await state(table, id);
    check(
      `${label} : ROLLBACK — état initial intact`,
      final.is_frozen === initial.is_frozen &&
        final.suspends === initial.suspends &&
        final.offline === initial.offline
    );
  }

  console.log(
    failures === 0
      ? "\nTOUT EST VERT — suspension et dégel total fonctionnent pour les 3 populations."
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
