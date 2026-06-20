/**
 * Scénarios DB avancés contre la prod.
 *
 * Couvre les cas réels du commerçant offline :
 *  - Chaîne de 3 transitions queued (pending → preparing → ready → completed
 *    via validate_pickup), rejouées au sync.
 *  - Code de retrait INCONNU côté validate_pickup au sync.
 *  - Code de retrait sur commande COMPLETED.
 *  - Code de retrait sur commande CANCELLED.
 *  - Code de retrait sur commande PAS encore READY.
 *  - Tentative d'update sur commande déjà completed (terminale).
 *  - Idempotency mélangée : rejouer après que le serveur soit déjà passé en
 *    avant via une autre voie (ex: auto-accept via realtime).
 *
 * Rollback intégral en fin de test.
 */

import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { getDbUrl } from "./_supabase.mjs";

const ALLOWED = {
  pending: ["preparing", "accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};
const isValidTransition = (from, to) => (ALLOWED[from] ?? []).includes(to);

/** Réplique de updateOrderStatus (service_role). */
async function updateOrderStatus(client, orderId, to, opId) {
  const dup = await client.query(
    "SELECT id FROM public.order_events WHERE client_operation_id = $1 LIMIT 1",
    [opId]
  );
  if (dup.rows.length > 0) return { success: "Déjà appliqué." };

  const row = await client.query(
    "SELECT status FROM public.orders WHERE id = $1",
    [orderId]
  );
  if (row.rows.length === 0) return { error: "Commande introuvable." };
  const from = row.rows[0].status;
  if (from === to) return { success: "Aucun changement." };
  if (!isValidTransition(from, to))
    return { error: `Transition non autorisée (${from} → ${to}).` };

  await client.query("BEGIN");
  try {
    await client.query("UPDATE public.orders SET status = $1 WHERE id = $2", [
      to,
      orderId,
    ]);
    await client.query(
      "INSERT INTO public.order_events (order_id, from_status, to_status, client_operation_id) VALUES ($1, $2, $3, $4)",
      [orderId, from, to, opId]
    );
    await client.query("COMMIT");
    return { success: "Commande mise à jour." };
  } catch (e) {
    await client.query("ROLLBACK");
    return { error: `Erreur DB : ${e.code ?? ""} ${e.message}`.trim() };
  }
}

/** Réplique de validatePickupCode (miroir de app/(merchant)/orders/actions.ts :
 *  PIN à 4 chiffres, tolère 4–6 pour le legacy ; idempotency prioritaire). */
async function validatePickupCode(client, code, opId) {
  const normalized = code.replace(/\D/g, "");
  if (normalized.length < 4 || normalized.length > 6)
    return { error: "Le code doit comporter 4 chiffres." };

  if (opId) {
    const ex = await client.query(
      "SELECT order_id FROM public.order_events WHERE client_operation_id = $1 LIMIT 1",
      [opId]
    );
    if (ex.rows.length > 0) {
      return { success: "Déjà appliqué.", orderId: ex.rows[0].order_id };
    }
  }

  const row = await client.query(
    "SELECT id, status, customer_name FROM public.orders WHERE pickup_code = $1",
    [normalized]
  );
  if (row.rows.length === 0)
    return { error: "Aucune commande ne correspond à ce code." };
  const order = row.rows[0];
  if (order.status === "completed")
    return { error: "Cette commande a déjà été récupérée." };
  if (order.status === "cancelled")
    return { error: "Cette commande a été annulée." };
  if (order.status !== "ready")
    return { error: "Cette commande n'est pas encore prête au retrait." };

  const r = await updateOrderStatus(client, order.id, "completed", opId);
  if (r.error) return { error: r.error };
  return {
    success: `Retrait validé pour ${order.customer_name}.`,
    orderId: order.id,
  };
}

// ---------------------------------------------------------------------------
// Mirror de isConflictError pour vérifier que les messages serveur sont bien
// catégorisés "conflit" par la file offline.
// ---------------------------------------------------------------------------

function isConflictError(message) {
  const m = (message ?? "").toLowerCase();
  return (
    m.includes("transition non autorisée") ||
    m.includes("introuvable") ||
    m.includes("ne correspond") ||
    m.includes("déjà été récupérée") ||
    m.includes("a été annulée") ||
    m.includes("pas encore prête") ||
    m.includes("doit comporter")
  );
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let totalPass = 0;
let totalFail = 0;
const failures = [];
function pass(msg) {
  totalPass++;
  console.log(`  ✓ ${msg}`);
}
function fail_(msg) {
  totalFail++;
  failures.push(msg);
  console.log(`  ✗ ${msg}`);
}
function header(title) {
  console.log(`\n=== ${title} ===`);
}

async function snapshot(client, orderId) {
  const o = await client.query(
    "SELECT status FROM public.orders WHERE id = $1",
    [orderId]
  );
  const ev = await client.query(
    "SELECT id, from_status, to_status, client_operation_id FROM public.order_events WHERE order_id = $1 ORDER BY created_at ASC",
    [orderId]
  );
  return { status: o.rows[0]?.status, events: ev.rows };
}

async function findReadyOrder(client) {
  // Si aucune ready, on prend n'importe quelle non-terminale et on remontera l'état.
  let r = await client.query(
    `SELECT id, status, customer_name, pickup_code, merchant_id
     FROM public.orders
     WHERE status NOT IN ('completed','cancelled')
     ORDER BY created_at DESC
     LIMIT 1`
  );
  if (r.rows.length === 0) {
    throw new Error("Aucune commande active disponible pour les tests");
  }
  return r.rows[0];
}

async function findCompletedOrCancelled(client, status) {
  const r = await client.query(
    `SELECT id, pickup_code FROM public.orders WHERE status = $1 ORDER BY created_at DESC LIMIT 1`,
    [status]
  );
  return r.rows[0] ?? null;
}

async function findPendingOrder(client, excludeId) {
  const r = await client.query(
    `SELECT id, pickup_code FROM public.orders WHERE status = 'pending' AND id != $1 ORDER BY created_at DESC LIMIT 1`,
    [excludeId ?? "00000000-0000-0000-0000-000000000000"]
  );
  return r.rows[0] ?? null;
}

async function deleteEventsByOpIds(client, opIds) {
  if (opIds.length === 0) return;
  await client.query(
    "DELETE FROM public.order_events WHERE client_operation_id = ANY($1::uuid[])",
    [opIds]
  );
}
async function setStatus(client, orderId, status) {
  await client.query("UPDATE public.orders SET status = $1 WHERE id = $2", [
    status,
    orderId,
  ]);
}

// ---------------------------------------------------------------------------
// Scénarios
// ---------------------------------------------------------------------------

async function main() {
  const client = new Client({ connectionString: getDbUrl() });
  await client.connect();

  const created_op_ids = [];
  let order = null;
  let initialStatus = null;
  const orderRestores = []; // [{id, status}]

  try {
    // ----------------------------------------------------------------------
    // Scénario 1 : chaîne de 3 actions queued sur la même commande
    // ----------------------------------------------------------------------
    header(
      "Scénario 1 — Chaîne pending → preparing → ready → completed (via validate_pickup)"
    );
    order = await findReadyOrder(client);
    initialStatus = order.status;
    orderRestores.push({ id: order.id, status: initialStatus });
    console.log(
      `Commande : ${order.id} (statut init=${initialStatus}, pickup_code=${order.pickup_code})`
    );

    // On force à pending pour la chaîne complète
    if (order.status !== "pending")
      await setStatus(client, order.id, "pending");

    const op1 = randomUUID();
    created_op_ids.push(op1);
    const op2 = randomUUID();
    created_op_ids.push(op2);
    const op3 = randomUUID();
    created_op_ids.push(op3);

    const r1 = await updateOrderStatus(client, order.id, "preparing", op1);
    const r2 = await updateOrderStatus(client, order.id, "ready", op2);
    const r3 = await validatePickupCode(client, order.pickup_code, op3);

    console.log(`  1) pending→preparing : ${JSON.stringify(r1)}`);
    console.log(`  2) preparing→ready  : ${JSON.stringify(r2)}`);
    console.log(`  3) validate_pickup  : ${JSON.stringify(r3)}`);

    if (r1.success && r2.success && r3.success)
      pass("Chaîne complète appliquée sans erreur");
    else fail_(`Échec dans la chaîne : ${JSON.stringify({ r1, r2, r3 })}`);

    const after = await snapshot(client, order.id);
    if (after.status === "completed") pass(`Statut final = completed`);
    else fail_(`Statut final inattendu : ${after.status}`);

    const ourEvents = after.events.filter((e) =>
      [op1, op2, op3].includes(e.client_operation_id)
    );
    if (ourEvents.length === 3) pass(`3 events créés (1 par transition)`);
    else fail_(`${ourEvents.length} events au lieu de 3`);

    const sequence = ourEvents
      .map((e) => `${e.from_status}→${e.to_status}`)
      .join(", ");
    if (sequence === "pending→preparing, preparing→ready, ready→completed")
      pass(`Séquence correcte : ${sequence}`);
    else fail_(`Séquence inattendue : ${sequence}`);

    // ----------------------------------------------------------------------
    // Scénario 2 : rejouer la MÊME chaîne (3 op_ids déjà connus) → tous
    // « Déjà appliqué. » et 0 nouveau event
    // ----------------------------------------------------------------------
    header("Scénario 2 — Rejouer la chaîne entière (idempotency stricte)");
    const r1b = await updateOrderStatus(client, order.id, "preparing", op1);
    const r2b = await updateOrderStatus(client, order.id, "ready", op2);
    const r3b = await validatePickupCode(client, order.pickup_code, op3);
    if (
      r1b.success === "Déjà appliqué." &&
      r2b.success === "Déjà appliqué." &&
      r3b.success === "Déjà appliqué."
    )
      pass("Chaîne rejouée 1×1 : tous renvoient « Déjà appliqué. »");
    else
      fail_(
        `Rejoue inattendue : ${JSON.stringify({ r1: r1b, r2: r2b, r3: r3b })}`
      );
    if (r3b.orderId === order.id)
      pass(
        "validate_pickup rejoué : renvoie orderId (le lien « Voir la commande » fonctionnera)"
      );
    else fail_(`orderId manquant ou faux après rejout : ${r3b.orderId}`);

    const after2 = await snapshot(client, order.id);
    const events2 = after2.events.filter((e) =>
      [op1, op2, op3].includes(e.client_operation_id)
    );
    if (events2.length === 3)
      pass(`Toujours 3 events (aucun ajout) — count=${events2.length}`);
    else
      fail_(
        `Doublon ! events liés à nos opIds = ${events2.length} (attendu 3)`
      );

    // ----------------------------------------------------------------------
    // Scénario 3 : tentative d'update sur commande COMPLETED
    // ----------------------------------------------------------------------
    header("Scénario 3 — update sur commande COMPLETED (terminale) → refus");
    const opTerm = randomUUID();
    created_op_ids.push(opTerm);
    const rTerm = await updateOrderStatus(client, order.id, "ready", opTerm);
    if (rTerm.error && /transition non autorisée/i.test(rTerm.error))
      pass(`Refusé proprement : « ${rTerm.error} »`);
    else fail_(`Réponse inattendue : ${JSON.stringify(rTerm)}`);
    if (isConflictError(rTerm.error)) pass("isConflictError catch ce message");
    else fail_("isConflictError NE catch PAS ce message — bug détecté !");

    // ----------------------------------------------------------------------
    // Scénario 4 : validate_pickup sur commande déjà COMPLETED
    // ----------------------------------------------------------------------
    header("Scénario 4 — validate_pickup sur commande déjà COMPLETED");
    const opAlreadyDone = randomUUID();
    created_op_ids.push(opAlreadyDone);
    const rAlready = await validatePickupCode(
      client,
      order.pickup_code,
      opAlreadyDone
    );
    if (rAlready.error && /déjà été récupérée/i.test(rAlready.error))
      pass(`Refusé : « ${rAlready.error} »`);
    else fail_(`Réponse inattendue : ${JSON.stringify(rAlready)}`);
    if (isConflictError(rAlready.error))
      pass("isConflictError catch ce message");
    else fail_("isConflictError NE catch PAS — bug !");

    // ----------------------------------------------------------------------
    // Scénario 5 : validate_pickup avec code INCONNU
    // ----------------------------------------------------------------------
    header("Scénario 5 — validate_pickup code 100% inconnu (999000)");
    const opUnknown = randomUUID();
    created_op_ids.push(opUnknown);
    const rUnknown = await validatePickupCode(client, "999000", opUnknown);
    if (rUnknown.error && /ne correspond/i.test(rUnknown.error))
      pass(`Refusé : « ${rUnknown.error} »`);
    else fail_(`Réponse inattendue : ${JSON.stringify(rUnknown)}`);
    if (isConflictError(rUnknown.error))
      pass("isConflictError catch ce message");
    else fail_("isConflictError NE catch PAS — bug !");

    // ----------------------------------------------------------------------
    // Scénario 6 : validate_pickup sur commande PENDING (pas encore prête)
    // ----------------------------------------------------------------------
    header(
      "Scénario 6 — validate_pickup sur commande PENDING (pas encore ready)"
    );
    const pendingOrder = await findPendingOrder(client, order.id);
    if (pendingOrder) {
      const opPending = randomUUID();
      created_op_ids.push(opPending);
      const rPending = await validatePickupCode(
        client,
        pendingOrder.pickup_code,
        opPending
      );
      if (rPending.error && /pas encore prête/i.test(rPending.error))
        pass(`Refusé : « ${rPending.error} »`);
      else fail_(`Réponse inattendue : ${JSON.stringify(rPending)}`);
      if (isConflictError(rPending.error))
        pass("isConflictError catch ce message");
      else fail_("isConflictError NE catch PAS — bug !");
    } else {
      console.log("  (aucune commande pending disponible — skip)");
    }

    // ----------------------------------------------------------------------
    // Scénario 7 : validate_pickup sur commande CANCELLED
    // ----------------------------------------------------------------------
    header("Scénario 7 — validate_pickup sur commande CANCELLED");
    const cancelled = await findCompletedOrCancelled(client, "cancelled");
    if (cancelled) {
      const opCancelled = randomUUID();
      created_op_ids.push(opCancelled);
      const rCancelled = await validatePickupCode(
        client,
        cancelled.pickup_code,
        opCancelled
      );
      if (rCancelled.error && /a été annulée/i.test(rCancelled.error))
        pass(`Refusé : « ${rCancelled.error} »`);
      else fail_(`Réponse inattendue : ${JSON.stringify(rCancelled)}`);
      if (isConflictError(rCancelled.error))
        pass("isConflictError catch ce message");
      else fail_("isConflictError NE catch PAS — bug !");
    } else {
      console.log("  (aucune commande cancelled disponible — skip)");
    }

    // ----------------------------------------------------------------------
    // Scénario 8 : « code mal formé » (trop court : 2 chiffres) — geré côté
    // client mais testons que isConflictError catch quand même au cas où.
    // (Le PIN valide fait 4 à 6 chiffres ; 2 chiffres = format invalide.)
    // ----------------------------------------------------------------------
    header("Scénario 8 — Code mal formé (2 chiffres) → erreur format");
    const opShort = randomUUID();
    created_op_ids.push(opShort);
    const rShort = await validatePickupCode(client, "12", opShort);
    if (rShort.error && /doit comporter/i.test(rShort.error))
      pass(`Refusé : « ${rShort.error} »`);
    else fail_(`Réponse inattendue : ${JSON.stringify(rShort)}`);
    if (isConflictError(rShort.error)) pass("isConflictError catch ce message");
    else fail_("isConflictError NE catch PAS — bug !");
  } finally {
    // Rollback intégral
    header("Rollback");
    try {
      await deleteEventsByOpIds(client, created_op_ids);
      for (const r of orderRestores) {
        await setStatus(client, r.id, r.status);
      }
      const finalState = order ? await snapshot(client, order.id) : null;
      console.log(
        `Rollback OK. Commande principale restaurée à ${finalState?.status ?? "?"}, ${created_op_ids.length} events test supprimés.`
      );
    } catch (e) {
      console.error("⚠ rollback raté :", e.message);
      process.exitCode = 2;
    }
    await client.end();
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Résultat : ${totalPass} pass, ${totalFail} fail`);
  if (totalFail > 0) {
    console.log("Échecs :");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log("✅ TOUS LES SCÉNARIOS PASSENT");
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
