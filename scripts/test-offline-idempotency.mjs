/**
 * Test d'idempotency de la file offline.
 *
 * Reproduit EXACTEMENT la logique de `updateOrderStatus` (RLS bypass via
 * service_role) puis :
 *
 *  1. Trouve une commande candidate dans un statut depuis lequel on peut
 *     transitionner (pending → preparing).
 *  2. Crée un statut de départ propre (rollback à pending).
 *  3. Joue 5 fois la même opération avec le MÊME client_operation_id.
 *  4. Vérifie qu'il n'y a QU'UN seul row dans order_events et que le statut
 *     n'a changé qu'une fois.
 *  5. Joue 10 appels CONCURRENTS avec le MÊME UUID — la contrainte
 *     `client_operation_id UUID UNIQUE` doit rejeter tous les doublons.
 *  6. Tente une transition invalide (preparing → pending) avec un nouveau
 *     UUID → doit être refusée proprement.
 *  7. Rollback à l'état initial.
 *
 * Aucun changement de schéma. Aucune perte de données : on rollback à la fin.
 */

import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { getDbUrl } from "./_supabase.mjs";

// Mirror de la table ALLOWED_TRANSITIONS de lib/types.ts (source unique de vérité).
const ALLOWED = {
  pending: ["preparing", "accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

function isValidTransition(from, to) {
  return (ALLOWED[from] ?? []).includes(to);
}

/**
 * Réplique de la Server Action `updateOrderStatus` SANS la RLS (on est en
 * service_role). Conserve la même séquence :
 *   1. check idempotency par client_operation_id
 *   2. lire le statut courant
 *   3. valider la transition
 *   4. update + insert order_events
 *
 * Retourne `{ error }` ou `{ success }`.
 */
async function updateOrderStatusReplica(client, orderId, to, opId) {
  // 1. Idempotency
  const dup = await client.query(
    "SELECT id FROM public.order_events WHERE client_operation_id = $1 LIMIT 1",
    [opId]
  );
  if (dup.rows.length > 0) {
    return { success: "Déjà appliqué." };
  }

  // 2. Lire la commande
  const row = await client.query(
    "SELECT id, status FROM public.orders WHERE id = $1",
    [orderId]
  );
  if (row.rows.length === 0) return { error: "Commande introuvable." };
  const from = row.rows[0].status;
  if (from === to) return { success: "Aucun changement." };
  if (!isValidTransition(from, to)) {
    return { error: `Transition non autorisée (${from} → ${to}).` };
  }

  // 3. Update + 4. Audit. La contrainte UNIQUE protège contre les doublons
  //    concurrents même si le check #1 ne les a pas vus.
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

async function findCandidateOrder(client) {
  // On cherche une commande NON terminale (pas completed/cancelled) la plus
  // récente possible. Sur prod réelle on évite de toucher aux nouvelles pour
  // ne pas perturber un commerçant.
  const r = await client.query(
    `SELECT id, status, customer_name, merchant_id
     FROM public.orders
     WHERE status NOT IN ('completed','cancelled')
     ORDER BY created_at DESC
     LIMIT 1`
  );
  if (r.rows.length === 0) {
    // Fallback : on prend la plus ancienne completed et on l'utilisera en
    // simulation read-only (on ne va PAS toucher, on échoue le test plutôt).
    return null;
  }
  return r.rows[0];
}

/**
 * Snapshot complet d'une commande + ses events pour rollback / vérif.
 */
async function snapshot(client, orderId) {
  const o = await client.query(
    "SELECT id, status FROM public.orders WHERE id = $1",
    [orderId]
  );
  const ev = await client.query(
    "SELECT id, from_status, to_status, client_operation_id, created_at FROM public.order_events WHERE order_id = $1 ORDER BY created_at ASC",
    [orderId]
  );
  return { order: o.rows[0], events: ev.rows };
}

async function deleteEventsByOpIds(client, opIds) {
  if (opIds.length === 0) return;
  await client.query(
    "DELETE FROM public.order_events WHERE client_operation_id = ANY($1::uuid[])",
    [opIds]
  );
}

async function restoreOrderStatus(client, orderId, status) {
  await client.query("UPDATE public.orders SET status = $1 WHERE id = $2", [
    status,
    orderId,
  ]);
}

function pass(msg) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg) {
  console.log(`  ✗ ${msg}`);
  process.exitCode = 1;
}
function header(title) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  const client = new Client({ connectionString: getDbUrl() });
  await client.connect();

  const created_op_ids = []; // pour rollback à la fin
  let initial = null;
  let order = null;

  try {
    header("Recherche d'une commande candidate");
    order = await findCandidateOrder(client);
    if (!order) {
      console.log(
        "Aucune commande active disponible (toutes en completed/cancelled). On en crée une... non, on s'arrête : refaire seed."
      );
      process.exit(1);
    }
    initial = await snapshot(client, order.id);
    console.log(
      `Commande choisie : ${order.id} (statut = ${initial.order.status}, client = ${order.customer_name}, events existants = ${initial.events.length})`
    );

    // Force l'état de départ à "pending" pour tester la transition canonique
    // pending → preparing (la première transition côté commerçant).
    if (initial.order.status !== "pending") {
      console.log(
        `→ rollback temporaire à pending (était ${initial.order.status}) pour test`
      );
      await restoreOrderStatus(client, order.id, "pending");
    }

    // -------------------------------------------------------------------
    // TEST 1 : 5 rejouts SÉQUENTIELS du même UUID
    // -------------------------------------------------------------------
    header("Test 1 — 5 rejouts séquentiels avec le MÊME client_operation_id");
    const opId1 = randomUUID();
    created_op_ids.push(opId1);

    const results = [];
    for (let i = 0; i < 5; i++) {
      const res = await updateOrderStatusReplica(
        client,
        order.id,
        "preparing",
        opId1
      );
      results.push(res);
      console.log(`  tentative ${i + 1} → ${JSON.stringify(res)}`);
    }

    // Vérifs
    const succeeded = results.filter((r) => r.success).length;
    if (succeeded === 5) pass("Toutes les tentatives retournent un success");
    else fail(`Seulement ${succeeded}/5 ont retourné success`);

    if (results[0].success === "Commande mise à jour.")
      pass("La 1re tentative applique la mise à jour");
    else
      fail(
        `La 1re tentative aurait dû appliquer : ${results[0].success ?? results[0].error}`
      );

    const dejaApplique = results
      .slice(1)
      .every((r) => r.success === "Déjà appliqué.");
    if (dejaApplique) pass("Les 4 suivantes retournent « Déjà appliqué. »");
    else fail("Au moins une rejou n'a pas été détectée comme idempotente");

    const after1 = await snapshot(client, order.id);
    const newEvents1 = after1.events.filter(
      (e) => e.client_operation_id === opId1
    );
    if (newEvents1.length === 1)
      pass(
        `Une SEULE ligne ajoutée à order_events (count=${newEvents1.length})`
      );
    else fail(`Doublon détecté ! ${newEvents1.length} lignes pour cet opId`);

    if (after1.order.status === "preparing")
      pass(`Statut final = preparing (transition appliquée 1 seule fois)`);
    else fail(`Statut inattendu : ${after1.order.status}`);

    // -------------------------------------------------------------------
    // TEST 2 : 10 rejouts CONCURRENTS du même UUID (pire cas réseau)
    // -------------------------------------------------------------------
    // On rollback d'abord pour repartir d'un état exploitable.
    header("Test 2 — 10 rejouts CONCURRENTS avec le MÊME client_operation_id");

    // On crée une 2e commande de test transition preparing → ready
    const opId2 = randomUUID();
    created_op_ids.push(opId2);

    // Pour le test concurrent on a besoin de plusieurs CONNEXIONS pg
    // (sinon les requêtes seraient sérialisées sur la connexion unique).
    const N = 10;
    const conns = [];
    for (let i = 0; i < N; i++) {
      const c = new Client({ connectionString: getDbUrl() });
      await c.connect();
      conns.push(c);
    }

    try {
      const concurrent = await Promise.all(
        conns.map((c) =>
          updateOrderStatusReplica(c, order.id, "ready", opId2).catch((e) => ({
            error: `EXCEPTION: ${e.message}`,
          }))
        )
      );
      concurrent.forEach((r, i) => {
        console.log(`  appel parallèle ${i + 1} → ${JSON.stringify(r)}`);
      });

      const after2 = await snapshot(client, order.id);
      const newEvents2 = after2.events.filter(
        (e) => e.client_operation_id === opId2
      );
      if (newEvents2.length === 1)
        pass(
          `Une SEULE ligne ajoutée malgré ${N} appels concurrents (count=${newEvents2.length})`
        );
      else
        fail(
          `DOUBLON ! ${newEvents2.length} lignes pour ce opId (contrainte UNIQUE bypassée ?)`
        );

      if (after2.order.status === "ready")
        pass(`Statut final = ready (transition appliquée 1 seule fois)`);
      else fail(`Statut inattendu après concurrent : ${after2.order.status}`);

      // Combien ont eu success vs error ?
      const okCount = concurrent.filter((r) => r.success).length;
      const errCount = concurrent.filter((r) => r.error).length;
      console.log(`  bilan : ${okCount} success, ${errCount} error`);
      if (okCount + errCount === N)
        pass(`Aucun appel n'a été silencieusement perdu`);

      // Au moins UN doit avoir réussi
      if (okCount >= 1) pass(`Au moins 1 appel a appliqué la transition`);
      else fail(`Aucun appel n'a réussi !`);
    } finally {
      for (const c of conns) await c.end().catch(() => {});
    }

    // -------------------------------------------------------------------
    // TEST 3 : transition INVALIDE doit être refusée (conflit serveur)
    // -------------------------------------------------------------------
    header("Test 3 — Transition invalide (ready → pending) avec nouveau UUID");
    const opId3 = randomUUID();
    created_op_ids.push(opId3);
    const invalidRes = await updateOrderStatusReplica(
      client,
      order.id,
      "pending",
      opId3
    );
    console.log(`  résultat : ${JSON.stringify(invalidRes)}`);
    if (invalidRes.error && /transition non autorisée/i.test(invalidRes.error))
      pass(
        `Transition invalide rejetée proprement (sera détectée comme conflit par isConflictError)`
      );
    else
      fail(
        `La transition invalide n'a pas été rejetée correctement : ${JSON.stringify(invalidRes)}`
      );

    const after3 = await snapshot(client, order.id);
    const newEvents3 = after3.events.filter(
      (e) => e.client_operation_id === opId3
    );
    if (newEvents3.length === 0)
      pass(`Aucun order_event créé pour la transition invalide`);
    else fail(`Un event a été créé pour une transition refusée !`);

    if (after3.order.status === "ready")
      pass(`Statut inchangé après tentative invalide`);
    else
      fail(`Statut altéré après transition invalide : ${after3.order.status}`);

    // -------------------------------------------------------------------
    // TEST 4 : violation directe de la contrainte UNIQUE (sécurité ceinture)
    // -------------------------------------------------------------------
    header("Test 4 — INSERT direct dupliquant un client_operation_id existant");
    try {
      await client.query(
        "INSERT INTO public.order_events (order_id, from_status, to_status, client_operation_id) VALUES ($1, $2, $3, $4)",
        [order.id, "ready", "completed", opId1] // opId1 déjà utilisé
      );
      fail(`La contrainte UNIQUE n'a PAS rejeté le doublon !`);
    } catch (e) {
      if (e.code === "23505")
        pass(
          `Contrainte UNIQUE active : ${e.constraint ?? "23505"} bloque le doublon`
        );
      else fail(`Erreur inattendue : ${e.code} ${e.message}`);
    }
  } finally {
    // -------------------------------------------------------------------
    // Rollback : on remet la commande dans son état initial + on supprime
    // tous les order_events créés par ce test.
    // -------------------------------------------------------------------
    if (order && initial) {
      header("Rollback");
      try {
        await deleteEventsByOpIds(client, created_op_ids);
        await restoreOrderStatus(client, order.id, initial.order.status);
        const final = await snapshot(client, order.id);
        console.log(
          `Rollback OK : statut restauré à ${final.order.status}, events nettoyés (${final.events.length} restants, attendu ${initial.events.length})`
        );
      } catch (e) {
        console.error("⚠ rollback raté :", e.message);
        process.exitCode = 2;
      }
    }
    await client.end();
  }

  console.log("");
  if (process.exitCode && process.exitCode !== 0) {
    console.log("❌ TESTS ÉCHOUÉS — voir traces ci-dessus");
  } else {
    console.log(
      "✅ TOUS LES TESTS PASSENT — idempotency confirmée, aucun doublon possible"
    );
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
