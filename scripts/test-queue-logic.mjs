/**
 * Tests algorithmiques de la file offline.
 *
 * Stratégie : on monte un environnement Node "browser-like" (fake-indexeddb +
 * window/navigator), on instancie le MÊME schéma Dexie que `lib/offline/db.ts`,
 * puis on réplique fidèlement les algorithmes de `lib/offline/queue.ts` avec
 * un Server Action mocké dont on contrôle les réponses.
 *
 * Le but : valider la logique de la file (FIFO, retry borné, conflit, mutex,
 * resetStuckSyncing, compteurs), indépendamment de l'auth/réseau réel.
 */

import "fake-indexeddb/auto"; // expose indexedDB en global
import Dexie from "dexie";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Setup environnement browser-like
// ---------------------------------------------------------------------------

globalThis.window = globalThis;
const onlineState = { value: true };
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: new Proxy(
    {},
    {
      get(_, p) {
        if (p === "onLine") return onlineState.value;
        return undefined;
      },
    }
  ),
});
// Évènements stockés en mémoire pour ne pas dépendre d'un EventTarget réel.
const listeners = new Map();
globalThis.window.addEventListener = (name, fn) => {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
};
globalThis.window.removeEventListener = (name, fn) => {
  listeners.get(name)?.delete(fn);
};
globalThis.window.dispatchEvent = (event) => {
  const set = listeners.get(event.type) ?? new Set();
  for (const fn of set) fn(event);
  return true;
};
// CustomEvent shim (minimaliste, suffisant pour notre code)
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail;
  }
};

function setOnline(v) {
  const wasOnline = onlineState.value;
  onlineState.value = v;
  if (v !== wasOnline) {
    globalThis.window.dispatchEvent(new CustomEvent(v ? "online" : "offline"));
  }
}

// ---------------------------------------------------------------------------
// Schéma Dexie (copie EXACTE de lib/offline/db.ts)
// ---------------------------------------------------------------------------

class ColigoOfflineDB extends Dexie {
  constructor() {
    super("coligo_offline_test_" + Date.now()); // nom unique par run
    this.version(1).stores({
      orders_cache: "id, created_at, status, merchant_id, syncedAt",
      pending_actions: "id, createdAt, status, orderId, type",
    });
  }
}

let db = null;
function getDB() {
  if (!db) db = new ColigoOfflineDB();
  return db;
}

// ---------------------------------------------------------------------------
// Mock du Server Action.
// On le configure par cas de test pour scripter ses réponses.
// ---------------------------------------------------------------------------

const serverMock = {
  // List de réponses scriptées par opId (FIFO). Chaque entrée :
  //   { result?, throw? }
  scripts: new Map(),
  // Liste des appels reçus (audit FIFO).
  calls: [],
  // Latence simulée (ms) — utile pour tester la concurrence
  latencyMs: 0,
  reset() {
    this.scripts.clear();
    this.calls = [];
    this.latencyMs = 0;
  },
  scriptFor(opId, sequence) {
    this.scripts.set(opId, [...sequence]);
  },
  async exec(input, opId) {
    this.calls.push({ input, opId, at: Date.now() });
    if (this.latencyMs > 0)
      await new Promise((r) => setTimeout(r, this.latencyMs));
    const queue = this.scripts.get(opId);
    if (!queue || queue.length === 0) {
      // Pas de script → comportement par défaut : success
      return { success: "Commande mise à jour." };
    }
    const next = queue.shift();
    if (next.throw) throw new Error(next.throw);
    return next.result;
  },
};

// ---------------------------------------------------------------------------
// Réplique fidèle de queue.ts
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 3;
const QUEUE_CHANGE_EVENT = "coligo:offline-queue-changed";
const ACTION_RESOLVED_EVENT = "coligo:offline-action-resolved";

const resolvedEvents = [];
window.addEventListener(ACTION_RESOLVED_EVENT, (e) => {
  resolvedEvents.push(e.detail);
});

function notifyQueueChange() {
  window.dispatchEvent(new CustomEvent(QUEUE_CHANGE_EVENT));
}
function notifyResolved(detail) {
  window.dispatchEvent(new CustomEvent(ACTION_RESOLVED_EVENT, { detail }));
}

function newOperationId() {
  return randomUUID();
}

async function enqueueOrExecute(input) {
  const operationId = newOperationId();
  const isOnline = navigator.onLine;

  if (isOnline) {
    try {
      const result = await serverMock.exec(input, operationId);
      return { mode: "online", operationId, result };
    } catch (err) {
      await enqueueAction(input, operationId);
      return { mode: "queued", operationId };
    }
  }
  await enqueueAction(input, operationId);
  return { mode: "queued", operationId };
}

async function enqueueAction(input, operationId) {
  const action = {
    id: operationId,
    type: input.type,
    payload:
      input.type === "update_status"
        ? { orderId: input.orderId, to: input.to }
        : { code: input.code },
    orderId: input.type === "update_status" ? input.orderId : null,
    createdAt: Date.now() + Math.random(), // évite collisions sur runs rapides
    status: "queued",
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
  };
  await getDB().table("pending_actions").put(action);
  notifyQueueChange();
}

function isConflictError(message) {
  const m = message.toLowerCase();
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

let isProcessing = false;
async function processQueue() {
  if (!navigator.onLine) return;
  if (isProcessing) return;
  isProcessing = true;
  try {
    const queue = await getDB()
      .table("pending_actions")
      .where("status")
      .equals("queued")
      .sortBy("createdAt");
    for (const action of queue) {
      if (!navigator.onLine) break;
      await processOne(action);
    }
  } finally {
    isProcessing = false;
  }
}

async function processOne(action) {
  await getDB()
    .table("pending_actions")
    .update(action.id, {
      status: "syncing",
      attempts: action.attempts + 1,
      lastAttemptAt: Date.now(),
    });
  notifyQueueChange();

  try {
    const input =
      action.type === "update_status"
        ? {
            type: "update_status",
            orderId: action.payload.orderId,
            to: action.payload.to,
          }
        : { type: "validate_pickup", code: action.payload.code };
    const result = await serverMock.exec(input, action.id);

    if (result.error) {
      if (isConflictError(result.error)) {
        await getDB().table("pending_actions").delete(action.id);
        notifyQueueChange();
        notifyResolved({ action, result: "conflict", message: result.error });
        return;
      }
      await markFailed(action, result.error);
      return;
    }

    await getDB().table("pending_actions").delete(action.id);
    notifyQueueChange();
    notifyResolved({
      action,
      result: "success",
      message: result.success ?? "Synchronisé.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const next = action.attempts + 1;
    if (next < MAX_ATTEMPTS) {
      await getDB().table("pending_actions").update(action.id, {
        status: "queued",
        lastError: message,
      });
      notifyQueueChange();
    } else {
      await markFailed(action, message);
    }
  }
}

async function markFailed(action, message) {
  await getDB()
    .table("pending_actions")
    .update(action.id, { status: "failed", lastError: message });
  notifyQueueChange();
  notifyResolved({ action, result: "failed", message });
}

async function getPendingActions() {
  return getDB().table("pending_actions").orderBy("createdAt").toArray();
}
async function getActiveCount() {
  return getDB()
    .table("pending_actions")
    .where("status")
    .anyOf(["queued", "syncing"])
    .count();
}
async function getFailedCount() {
  return getDB()
    .table("pending_actions")
    .where("status")
    .equals("failed")
    .count();
}

async function resetStuckSyncing() {
  const stuck = await getDB()
    .table("pending_actions")
    .where("status")
    .equals("syncing")
    .toArray();
  for (const a of stuck) {
    await getDB().table("pending_actions").update(a.id, { status: "queued" });
  }
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
function fail(msg) {
  totalFail++;
  failures.push(msg);
  console.log(`  ✗ ${msg}`);
}
async function setupClean() {
  // Recrée une DB fraîche par test (nom unique).
  if (db) {
    db.close();
    db = null;
  }
  serverMock.reset();
  resolvedEvents.length = 0;
  // Re-flush isProcessing
  isProcessing = false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function test1_online_success() {
  console.log("\n=== Test 1 — Online : exec direct, pas de file ===");
  await setupClean();
  setOnline(true);
  const r = await enqueueOrExecute({
    type: "update_status",
    orderId: "o1",
    to: "preparing",
  });
  if (r.mode === "online" && r.result.success) pass("mode=online + success");
  else fail(`attendu mode=online success, reçu ${JSON.stringify(r)}`);
  const count = await getDB().table("pending_actions").count();
  if (count === 0) pass("Aucune action en file (exec direct)");
  else fail(`File devrait être vide, contient ${count} entrées`);
}

async function test2_offline_enqueue() {
  console.log("\n=== Test 2 — Offline : enqueue + status 'queued' ===");
  await setupClean();
  setOnline(false);
  const r = await enqueueOrExecute({
    type: "update_status",
    orderId: "o2",
    to: "preparing",
  });
  if (r.mode === "queued") pass("mode=queued");
  else fail(`attendu queued, reçu ${r.mode}`);
  const actions = await getPendingActions();
  if (actions.length === 1) pass("1 action en file");
  else fail(`attendu 1 action, ${actions.length} en file`);
  if (actions[0].status === "queued") pass("status=queued");
  else fail(`status attendu queued, reçu ${actions[0].status}`);
  if (actions[0].id === r.operationId)
    pass("PK = operationId (UUID idempotency)");
  else fail("PK différent de operationId");
}

async function test3_online_network_error_fallback() {
  console.log("\n=== Test 3 — Online MAIS server throw → fallback enqueue ===");
  await setupClean();
  setOnline(true);
  // Script : la prochaine exec throw une erreur réseau
  const willOpId = "WILL_BE_SET";
  // On hijacke pour scripter avant que l'opId soit connu : on script TOUS les
  // futurs appels avec un wildcard via une fonction qui matche le 1er appel.
  const originalExec = serverMock.exec.bind(serverMock);
  let firstCall = true;
  serverMock.exec = async (input, opId) => {
    if (firstCall) {
      firstCall = false;
      throw new Error("ECONNREFUSED");
    }
    return { success: "Commande mise à jour." };
  };
  const r = await enqueueOrExecute({
    type: "update_status",
    orderId: "o3",
    to: "preparing",
  });
  serverMock.exec = originalExec;
  if (r.mode === "queued") pass("Bascule en queued après erreur réseau");
  else fail(`attendu queued, reçu ${r.mode}`);
}

async function test4_processQueue_success() {
  console.log("\n=== Test 4 — processQueue : succès → action supprimée ===");
  await setupClean();
  setOnline(false);
  await enqueueOrExecute({
    type: "update_status",
    orderId: "o4",
    to: "preparing",
  });
  setOnline(true);
  await processQueue();
  const count = await getDB().table("pending_actions").count();
  if (count === 0) pass("Action supprimée après succès");
  else fail(`File devrait être vide, ${count} entrée(s)`);
  const success = resolvedEvents.find((e) => e.result === "success");
  if (success) pass("Évènement 'success' émis");
  else fail("Aucun évènement success");
}

async function test5_processQueue_conflict() {
  console.log("\n=== Test 5 — processQueue : conflit → discard + notif ===");
  await setupClean();
  setOnline(false);
  const r = await enqueueOrExecute({
    type: "update_status",
    orderId: "o5",
    to: "preparing",
  });
  serverMock.scriptFor(r.operationId, [
    { result: { error: "Transition non autorisée (preparing → preparing)." } },
  ]);
  setOnline(true);
  await processQueue();
  const count = await getDB().table("pending_actions").count();
  if (count === 0) pass("Action conflit supprimée (pas conservée)");
  else fail(`File devrait être vide, ${count} entrée(s) restante(s)`);
  const conflict = resolvedEvents.find((e) => e.result === "conflict");
  if (conflict) pass("Évènement 'conflict' émis");
  else fail("Aucun évènement conflict");
}

async function test6_retry_then_success() {
  console.log("\n=== Test 6 — processQueue : 2 throws puis success ===");
  await setupClean();
  setOnline(false);
  const r = await enqueueOrExecute({
    type: "update_status",
    orderId: "o6",
    to: "preparing",
  });
  serverMock.scriptFor(r.operationId, [
    { throw: "ENETDOWN 1" },
    { throw: "ENETDOWN 2" },
    { result: { success: "OK." } },
  ]);
  setOnline(true);
  // Passe 1 : try 1 → throw → status=queued, attempts=1
  await processQueue();
  let a = (await getPendingActions())[0];
  if (a && a.status === "queued" && a.attempts === 1)
    pass(`Après 1er throw : queued, attempts=1`);
  else fail(`État inattendu : ${JSON.stringify(a)}`);

  // Passe 2 : try 2 → throw → status=queued, attempts=2
  await processQueue();
  a = (await getPendingActions())[0];
  if (a && a.status === "queued" && a.attempts === 2)
    pass(`Après 2e throw : queued, attempts=2`);
  else fail(`État inattendu : ${JSON.stringify(a)}`);

  // Passe 3 : try 3 → success → supprimé
  await processQueue();
  const count = await getDB().table("pending_actions").count();
  if (count === 0) pass("Après succès final : file vide");
  else fail(`Pas vidée : ${count} restante(s)`);
}

async function test7_max_attempts_then_failed() {
  console.log(
    "\n=== Test 7 — processQueue : MAX_ATTEMPTS atteint → failed ==="
  );
  await setupClean();
  setOnline(false);
  const r = await enqueueOrExecute({
    type: "update_status",
    orderId: "o7",
    to: "preparing",
  });
  serverMock.scriptFor(r.operationId, [
    { throw: "Boom 1" },
    { throw: "Boom 2" },
    { throw: "Boom 3" },
  ]);
  setOnline(true);
  // 3 passes pour atteindre MAX_ATTEMPTS
  await processQueue();
  await processQueue();
  await processQueue();
  const a = (await getPendingActions())[0];
  if (a && a.status === "failed") pass(`Statut=failed après MAX_ATTEMPTS`);
  else fail(`Attendu failed, reçu ${a?.status} (attempts=${a?.attempts})`);
  if (a?.attempts === MAX_ATTEMPTS)
    pass(`attempts=MAX_ATTEMPTS (${MAX_ATTEMPTS})`);
  else fail(`attempts=${a?.attempts}, attendu ${MAX_ATTEMPTS}`);
  const failedEv = resolvedEvents.find((e) => e.result === "failed");
  if (failedEv) pass("Évènement 'failed' émis");
  else fail("Aucun évènement failed");
}

async function test8_fifo_order() {
  console.log(
    "\n=== Test 8 — FIFO : actions traitées dans l'ordre d'enqueue ==="
  );
  await setupClean();
  setOnline(false);
  const opA = (
    await enqueueOrExecute({
      type: "update_status",
      orderId: "A",
      to: "preparing",
    })
  ).operationId;
  await new Promise((r) => setTimeout(r, 5));
  const opB = (
    await enqueueOrExecute({
      type: "update_status",
      orderId: "B",
      to: "preparing",
    })
  ).operationId;
  await new Promise((r) => setTimeout(r, 5));
  const opC = (
    await enqueueOrExecute({
      type: "update_status",
      orderId: "C",
      to: "preparing",
    })
  ).operationId;
  setOnline(true);
  await processQueue();
  const order = serverMock.calls.map((c) => c.opId);
  if (order.length === 3) pass(`3 appels exécutés`);
  else fail(`${order.length} appels au lieu de 3`);
  if (order[0] === opA && order[1] === opB && order[2] === opC)
    pass(`Ordre FIFO respecté (A → B → C)`);
  else fail(`Ordre cassé : ${order.join(" → ")}`);
}

async function test9_mutex_prevents_concurrent_processing() {
  console.log(
    "\n=== Test 9 — Mutex : 2 processQueue en parallèle = 1 passage ==="
  );
  await setupClean();
  setOnline(false);
  await enqueueOrExecute({
    type: "update_status",
    orderId: "M1",
    to: "preparing",
  });
  await enqueueOrExecute({
    type: "update_status",
    orderId: "M2",
    to: "preparing",
  });
  setOnline(true);
  serverMock.latencyMs = 30; // ralentit pour que les 2 appels se chevauchent
  const before = serverMock.calls.length;
  await Promise.all([processQueue(), processQueue()]);
  const after = serverMock.calls.length;
  serverMock.latencyMs = 0;
  // Si le mutex marche, un seul passage applique les 2 actions = 2 calls
  if (after - before === 2)
    pass(
      `Mutex OK : ${after - before} appels (= nombre d'actions, pas le double)`
    );
  else fail(`Mutex défaillant : ${after - before} appels (attendu 2)`);
}

async function test10_resetStuckSyncing() {
  console.log("\n=== Test 10 — resetStuckSyncing : 'syncing' → 'queued' ===");
  await setupClean();
  // Simule un crash : on insère une action en 'syncing'
  await getDB()
    .table("pending_actions")
    .put({
      id: "stuck-1",
      type: "update_status",
      payload: { orderId: "x", to: "ready" },
      orderId: "x",
      createdAt: Date.now(),
      status: "syncing",
      attempts: 1,
      lastError: null,
      lastAttemptAt: Date.now() - 5000,
    });
  await resetStuckSyncing();
  const a = await getDB().table("pending_actions").get("stuck-1");
  if (a.status === "queued") pass("Action stuck remise en 'queued'");
  else fail(`Statut inattendu : ${a.status}`);
}

async function test11_counts() {
  console.log("\n=== Test 11 — Compteurs (active vs failed) ===");
  await setupClean();
  await getDB()
    .table("pending_actions")
    .bulkAdd([
      {
        id: "a",
        type: "update_status",
        payload: { orderId: "x", to: "ready" },
        orderId: "x",
        createdAt: 1,
        status: "queued",
        attempts: 0,
        lastError: null,
        lastAttemptAt: null,
      },
      {
        id: "b",
        type: "update_status",
        payload: { orderId: "y", to: "ready" },
        orderId: "y",
        createdAt: 2,
        status: "syncing",
        attempts: 1,
        lastError: null,
        lastAttemptAt: null,
      },
      {
        id: "c",
        type: "update_status",
        payload: { orderId: "z", to: "ready" },
        orderId: "z",
        createdAt: 3,
        status: "failed",
        attempts: 3,
        lastError: "boom",
        lastAttemptAt: null,
      },
    ]);
  const act = await getActiveCount();
  const fail_ = await getFailedCount();
  if (act === 2) pass(`active = 2 (queued + syncing)`);
  else fail(`active = ${act}, attendu 2`);
  if (fail_ === 1) pass(`failed = 1`);
  else fail(`failed = ${fail_}, attendu 1`);
}

async function test12_idempotency_replay_same_opId_via_server() {
  console.log(
    "\n=== Test 12 — Rejouer le même opId (idempotency serveur simulée) ==="
  );
  await setupClean();
  setOnline(false);
  const r = await enqueueOrExecute({
    type: "update_status",
    orderId: "I1",
    to: "preparing",
  });
  // Le serveur retourne success 1re fois ET « Déjà appliqué. » les fois suivantes.
  serverMock.scriptFor(r.operationId, [
    { result: { success: "Commande mise à jour." } },
  ]);
  setOnline(true);
  await processQueue();
  // L'action est supprimée → si je la ré-enfile manuellement avec le même opId,
  // c'est un cas pathologique mais on simule.
  await getDB()
    .table("pending_actions")
    .put({
      id: r.operationId,
      type: "update_status",
      payload: { orderId: "I1", to: "preparing" },
      orderId: "I1",
      createdAt: Date.now(),
      status: "queued",
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    });
  // Le serveur cette fois retourne « Déjà appliqué. »
  serverMock.scriptFor(r.operationId, [
    { result: { success: "Déjà appliqué." } },
  ]);
  await processQueue();
  const count = await getDB().table("pending_actions").count();
  if (count === 0) pass("« Déjà appliqué. » traité comme succès → supprimé");
  else fail(`File devrait être vide, ${count} restante(s)`);
}

async function test13_validate_pickup_unknown_code_at_sync() {
  console.log(
    "\n=== Test 13 — validate_pickup offline avec code INCONNU → conflit au sync ==="
  );
  await setupClean();
  setOnline(false);
  const r = await enqueueOrExecute({ type: "validate_pickup", code: "999999" });
  serverMock.scriptFor(r.operationId, [
    { result: { error: "Aucune commande ne correspond à ce code." } },
  ]);
  setOnline(true);
  await processQueue();
  const count = await getDB().table("pending_actions").count();
  if (count === 0) pass("Code inconnu : action supprimée comme conflit");
  else fail(`File devrait être vide après conflit, ${count} restante(s)`);
  const conflict = resolvedEvents.find((e) => e.result === "conflict");
  if (conflict) pass("Évènement 'conflict' émis (UI affichera toast info)");
  else
    fail("Aucun évènement conflict (le commerçant n'aurait pas été notifié !)");
}

async function test14_mixed_queue_preserve_fifo() {
  console.log(
    "\n=== Test 14 — File mixte (status + pickup) : FIFO + types respectés ==="
  );
  await setupClean();
  setOnline(false);
  const r1 = await enqueueOrExecute({
    type: "update_status",
    orderId: "X",
    to: "preparing",
  });
  await new Promise((r) => setTimeout(r, 5));
  const r2 = await enqueueOrExecute({
    type: "validate_pickup",
    code: "111111",
  });
  await new Promise((r) => setTimeout(r, 5));
  const r3 = await enqueueOrExecute({
    type: "update_status",
    orderId: "Y",
    to: "ready",
  });
  setOnline(true);
  await processQueue();
  const calls = serverMock.calls;
  if (calls.length === 3) pass("3 appels");
  else fail(`${calls.length} appels au lieu de 3`);
  if (calls[0].input.type === "update_status" && calls[0].input.orderId === "X")
    pass("1er = status X");
  else fail(`1er = ${JSON.stringify(calls[0]?.input)}`);
  if (
    calls[1].input.type === "validate_pickup" &&
    calls[1].input.code === "111111"
  )
    pass("2e = pickup 111111");
  else fail(`2e = ${JSON.stringify(calls[1]?.input)}`);
  if (calls[2].input.type === "update_status" && calls[2].input.orderId === "Y")
    pass("3e = status Y");
  else fail(`3e = ${JSON.stringify(calls[2]?.input)}`);
}

async function test15_failed_doesnt_block_others() {
  console.log(
    "\n=== Test 15 — Une action 'failed' (après MAX) ne bloque PAS les suivantes ==="
  );
  await setupClean();
  setOnline(false);
  const r1 = await enqueueOrExecute({
    type: "update_status",
    orderId: "FAIL",
    to: "preparing",
  });
  await new Promise((r) => setTimeout(r, 5));
  const r2 = await enqueueOrExecute({
    type: "update_status",
    orderId: "OK",
    to: "preparing",
  });
  serverMock.scriptFor(r1.operationId, [
    { throw: "boom 1" },
    { throw: "boom 2" },
    { throw: "boom 3" },
  ]);
  serverMock.scriptFor(r2.operationId, [{ result: { success: "OK." } }]);
  setOnline(true);
  // Passe 1 : r1 throw (retry), r2 success → r2 supprimée
  await processQueue();
  // Passe 2 : r1 throw (retry)
  await processQueue();
  // Passe 3 : r1 throw (failed)
  await processQueue();
  const r2Exists = await getDB().table("pending_actions").get(r2.operationId);
  if (!r2Exists) pass("Action saine (r2) a été traitée malgré r1 défaillante");
  else fail(`r2 toujours présente : ${JSON.stringify(r2Exists)}`);
  const r1Final = await getDB().table("pending_actions").get(r1.operationId);
  if (r1Final && r1Final.status === "failed")
    pass(`r1 finit en 'failed' (attempts=${r1Final.attempts})`);
  else fail(`r1 statut inattendu : ${JSON.stringify(r1Final)}`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
  const tests = [
    test1_online_success,
    test2_offline_enqueue,
    test3_online_network_error_fallback,
    test4_processQueue_success,
    test5_processQueue_conflict,
    test6_retry_then_success,
    test7_max_attempts_then_failed,
    test8_fifo_order,
    test9_mutex_prevents_concurrent_processing,
    test10_resetStuckSyncing,
    test11_counts,
    test12_idempotency_replay_same_opId_via_server,
    test13_validate_pickup_unknown_code_at_sync,
    test14_mixed_queue_preserve_fifo,
    test15_failed_doesnt_block_others,
  ];
  for (const t of tests) {
    try {
      await t();
    } catch (e) {
      console.error(`ERREUR FATALE dans ${t.name}:`, e);
      totalFail++;
      failures.push(`${t.name}: ${e.message}`);
    }
  }
  console.log("\n" + "=".repeat(60));
  console.log(`Résultat : ${totalPass} pass, ${totalFail} fail`);
  if (totalFail > 0) {
    console.log("Échecs :");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log("✅ TOUS LES TESTS PASSENT");
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
