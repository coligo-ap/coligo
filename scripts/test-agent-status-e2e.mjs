// =============================================================================
// E2E — suspension & réactivation d'un AGENT COLIGO PAY, back + front + BDD,
// en TRANSACTION ANNULÉE sur la prod (ROLLBACK final : aucun état modifié).
//
// Le statut d'un agent vit dans operator_wallets.status (PAS dans le moteur
// anti-fraude, qui ne couvre pas cette population). Ce test vérifie que la
// suspension MORD réellement partout, et que la réactivation rend tout :
//   1. operator_can_operate(wallet) → false suspendu, true réactivé ;
//   2. recharge_points_nearby : le point DISPARAÎT de la carte suspendu,
//      RÉAPPARAÎT réactivé (si le point a des coordonnées) ;
//   3. vue AGENT (front) : my_operator_wallet_state() sous le JWT de l'agent
//      reflète le statut — c'est ce que le hub partenaire affiche
//      (« Compte suspendu — contactez Coligo ») ;
//   4. VENTE (le geste métier) : coligo_recharge_sell sous le JWT de l'agent
//      → 'not_active_partner' suspendu ; réactivé, le refus de statut a
//      DISPARU (l'appel échoue plus loin, sur la cible bidon — preuve que
//      seul le statut bloquait) ;
//   5. ROLLBACK — état initial intact.
//
// Usage : npm run test:agent:status
// =============================================================================

import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const ADMIN_EMAIL = "coligo.noreply@gmail.com";

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();

let failures = 0;
function check(label, ok, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures += 1;
}

async function actAs(claims) {
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify(claims),
  ]);
}
const asAdmin = () => actAs({ email: ADMIN_EMAIL, role: "authenticated" });
const asAgent = (ownerId) => actAs({ sub: ownerId, role: "authenticated" });

async function canOperate(id) {
  const r = await c.query("select public.operator_can_operate($1) as ok", [id]);
  return r.rows[0].ok === true;
}

async function visibleOnMap(id, lat, lng) {
  const r = await c.query(
    "select wallet_id from public.recharge_points_nearby($1, $2, 100) where wallet_id = $3",
    [lat, lng, id]
  );
  return r.rows.length > 0;
}

async function agentSeenStatus(ownerId) {
  await asAgent(ownerId);
  const r = await c.query(
    "select to_jsonb(x) as j from public.my_operator_wallet_state() x"
  );
  await asAdmin();
  return JSON.stringify(r.rows.map((row) => row.j));
}

async function sellAttempt(ownerId, opId) {
  await asAgent(ownerId);
  // Cible bidon : suspendu, le refus doit tomber AVANT (not_active_partner) ;
  // actif, il tombe APRÈS (cible introuvable / PIN) — c'est la preuve cherchée.
  const r = await c.query(
    "select public.coligo_recharge_sell('00000000-0000-0000-0000-000000000000'::uuid, 100, '0000', $1) as res",
    [opId]
  );
  await asAdmin();
  return r.rows[0].res;
}

try {
  const w = await c.query(
    `select id, display_name, status, owner_id, lat, lng
       from public.operator_wallets
      where owner_type = 'partner' and owner_id is not null
      order by created_at desc limit 1`
  );
  if (!w.rows[0]) {
    console.error("Aucun agent (owner_type=partner avec owner_id) en base.");
    process.exit(1);
  }
  const agent = w.rows[0];
  console.log(
    `Agent testé : ${agent.display_name} (${agent.id}) — statut initial « ${agent.status} »\n`
  );
  const hasCoords = agent.lat != null && agent.lng != null;

  await c.query("begin");
  await asAdmin();

  // --- 1. SUSPENSION (ce que fait setAgentStatus) ---
  await c.query(
    "update public.operator_wallets set status = 'suspended' where id = $1",
    [agent.id]
  );
  check(
    "Suspendu : operator_can_operate = false",
    !(await canOperate(agent.id))
  );
  if (hasCoords) {
    check(
      "Suspendu : le point DISPARAÎT de la carte (recharge_points_nearby)",
      !(await visibleOnMap(agent.id, agent.lat, agent.lng))
    );
  } else {
    console.log("(point sans coordonnées — contrôle carte sauté)");
  }
  const seenSuspended = await agentSeenStatus(agent.owner_id);
  check(
    "Suspendu : l'AGENT voit « suspended » dans son espace",
    seenSuspended.includes('"suspended"'),
    seenSuspended.slice(0, 120)
  );
  const saleBlocked = await sellAttempt(agent.owner_id, "e2e-agent-suspended");
  check(
    "Suspendu : la VENTE est refusée (not_active_partner)",
    saleBlocked?.ok === false && saleBlocked?.error === "not_active_partner",
    JSON.stringify(saleBlocked)
  );

  // --- 2. RÉACTIVATION ---
  await c.query(
    "update public.operator_wallets set status = 'active' where id = $1",
    [agent.id]
  );
  check("Réactivé : operator_can_operate = true", await canOperate(agent.id));
  if (hasCoords) {
    check(
      "Réactivé : le point RÉAPPARAÎT sur la carte",
      await visibleOnMap(agent.id, agent.lat, agent.lng)
    );
  }
  const seenActive = await agentSeenStatus(agent.owner_id);
  check(
    "Réactivé : l'AGENT voit « active » dans son espace",
    seenActive.includes('"active"')
  );
  const saleUnblocked = await sellAttempt(agent.owner_id, "e2e-agent-active");
  check(
    "Réactivé : le refus de statut a DISPARU (l'échec vient de la cible bidon)",
    saleUnblocked?.error !== "not_active_partner",
    JSON.stringify(saleUnblocked)
  );

  await c.query("rollback");

  // --- 3. ROLLBACK : rien n'a bougé ---
  const final = await c.query(
    "select status from public.operator_wallets where id = $1",
    [agent.id]
  );
  check(
    "ROLLBACK : statut initial intact",
    final.rows[0].status === agent.status,
    `statut=${final.rows[0].status}`
  );

  console.log(
    failures === 0
      ? "\nTOUT EST VERT — suspension et réactivation des agents fonctionnent de bout en bout."
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
