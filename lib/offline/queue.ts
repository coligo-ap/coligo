"use client";

/**
 * File d'actions différées + processeur de synchronisation.
 *
 * Garanties de sécurité (cf. PARTIE A du prompt de résilience) :
 *
 * 1. **Idempotency** : chaque action en file porte un `client_operation_id`
 *    (UUID stable) qui est aussi sa PK. Les Server Actions
 *    `updateOrderStatus` / `validatePickupCode` rejettent toute opération dont
 *    l'`client_operation_id` est déjà présent dans `order_events`. Rejouer
 *    une action N fois = 1 seul effet serveur.
 *
 * 2. **FIFO strict** : on traite une seule action à la fois (await), par
 *    `createdAt` ASC. Les actions concurrentes sont sérialisées via un mutex
 *    en mémoire (`isProcessing`).
 *
 * 3. **Conflit serveur = serveur gagne** : si la transition est refusée par
 *    le serveur (commande déjà avancée), on jette l'action proprement (pas
 *    de retry sans fin) et on notifie l'utilisateur.
 *
 * 4. **Retry borné** : 3 tentatives sur erreur transitoire (réseau). Au-delà,
 *    statut local `failed` + UI pour rejouer manuellement.
 *
 * 5. **Pas de blocage en cascade** : une action `failed` ne bloque pas les
 *    suivantes — on les traite toutes et on laisse les `failed` en file pour
 *    décision utilisateur.
 */

import {
  getDB,
  isOfflineStorageAvailable,
  type PendingAction,
  type UpdateStatusPayload,
  type ValidatePickupPayload,
} from "./db";
import type { OrderStatus } from "@/lib/types";
import {
  updateOrderStatus,
  validatePickupCode,
  type OrderActionResult,
} from "@/app/(merchant)/orders/actions";

const MAX_ATTEMPTS = 3;

/** Évènement DOM diffusé à chaque mutation de file pour rafraîchir l'UI. */
const QUEUE_CHANGE_EVENT = "coligo:offline-queue-changed";

/** Évènement DOM diffusé quand une action est résolue (succès / conflit). */
export const ACTION_RESOLVED_EVENT = "coligo:offline-action-resolved";

export type ActionResolvedDetail = {
  action: PendingAction;
  result: "success" | "conflict" | "failed";
  message: string;
};

function notifyQueueChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(QUEUE_CHANGE_EVENT));
}

function notifyResolved(detail: ActionResolvedDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ActionResolvedDetail>(ACTION_RESOLVED_EVENT, { detail })
  );
}

/** Abonnement React au changement de file (compteurs). */
export function subscribeToQueueChange(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(QUEUE_CHANGE_EVENT, listener);
  return () => window.removeEventListener(QUEUE_CHANGE_EVENT, listener);
}

/** UUID v4 robuste (utilise `crypto.randomUUID` si dispo). */
function newOperationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback minimaliste — extrêmement rare en pratique côté browser moderne.
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// API publique : enqueueOrExecute
// ---------------------------------------------------------------------------

export type EnqueueResult =
  | {
      /** Action exécutée en direct contre le serveur (online). */
      mode: "online";
      operationId: string;
      result: OrderActionResult & { orderId?: string };
    }
  | {
      /** Action mise en file (offline ou IndexedDB indispo → forcé en file
       *  pour ne pas perdre l'action). */
      mode: "queued";
      operationId: string;
    };

export type ActionInput =
  | { type: "update_status"; orderId: string; to: OrderStatus }
  | { type: "validate_pickup"; code: string };

/**
 * Point d'entrée unique pour les actions résilientes.
 *
 * - Si on est en ligne (et IndexedDB dispo) → on tente l'exécution directe ;
 *   sur erreur réseau, on bascule en file (l'action n'est jamais perdue).
 * - Si on est hors ligne → on enfile.
 */
export async function enqueueOrExecute(
  input: ActionInput
): Promise<EnqueueResult> {
  const operationId = newOperationId();

  const isOnline = typeof navigator === "undefined" ? true : navigator.onLine;

  // Si on est online, on tente. Si IndexedDB n'est pas dispo, on tente aussi
  // (sans fallback file) et on remonte l'erreur — c'est le comportement legacy.
  if (isOnline) {
    try {
      const result = await execActionOnServer(input, operationId);
      return { mode: "online", operationId, result };
    } catch (err) {
      // Erreur réseau pendant l'appel → on enfile pour rejouer si IndexedDB
      // est dispo. Sinon on remonte.
      if (!isOfflineStorageAvailable()) {
        throw err;
      }
      await enqueueAction(input, operationId);
      return { mode: "queued", operationId };
    }
  }

  if (!isOfflineStorageAvailable()) {
    // Cas dégénéré (offline + pas d'IndexedDB) : on échoue net.
    throw new Error(
      "Vous êtes hors ligne et le stockage local n'est pas disponible."
    );
  }

  await enqueueAction(input, operationId);
  return { mode: "queued", operationId };
}

async function enqueueAction(
  input: ActionInput,
  operationId: string
): Promise<void> {
  const action: PendingAction = {
    id: operationId,
    type: input.type,
    payload:
      input.type === "update_status"
        ? ({
            orderId: input.orderId,
            to: input.to,
          } satisfies UpdateStatusPayload)
        : ({ code: input.code } satisfies ValidatePickupPayload),
    orderId: input.type === "update_status" ? input.orderId : null,
    createdAt: Date.now(),
    status: "queued",
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
  };
  await getDB().pending_actions.put(action);
  notifyQueueChange();
}

// ---------------------------------------------------------------------------
// Exécution serveur
// ---------------------------------------------------------------------------

async function execActionOnServer(
  input: ActionInput,
  operationId: string
): Promise<OrderActionResult & { orderId?: string }> {
  if (input.type === "update_status") {
    return updateOrderStatus(input.orderId, input.to, operationId);
  }
  // validate_pickup
  return validatePickupCode(input.code, operationId);
}

function actionAsInput(action: PendingAction): ActionInput {
  if (action.type === "update_status") {
    const p = action.payload as UpdateStatusPayload;
    return { type: "update_status", orderId: p.orderId, to: p.to };
  }
  const p = action.payload as ValidatePickupPayload;
  return { type: "validate_pickup", code: p.code };
}

// ---------------------------------------------------------------------------
// Détection de conflit
// ---------------------------------------------------------------------------

/**
 * Détecte si une erreur serveur signifie « le serveur est plus avancé »
 * (commande déjà au statut cible, déjà récupérée, transition non autorisée).
 * Dans ce cas on jette l'action proprement (pas de retry).
 *
 * On reste sur du pattern matching texte parce que les Server Actions
 * renvoient `{ error: string }` (pas de code structuré). Si les messages
 * évoluent, mettre à jour cette fonction.
 */
function isConflictError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("transition non autorisée") ||
    m.includes("introuvable") ||
    m.includes("ne correspond") || // code de retrait inconnu
    m.includes("déjà été récupérée") ||
    m.includes("a été annulée") ||
    m.includes("pas encore prête") ||
    m.includes("doit comporter")
  );
}

// ---------------------------------------------------------------------------
// Processeur de file
// ---------------------------------------------------------------------------

let isProcessing = false;

/**
 * Rejoue toutes les actions `queued` en FIFO. Idempotent : appels concurrents
 * sont sérialisés via le flag `isProcessing`.
 *
 * Trigger : `online` event, montage du shell, après chaque enqueue.
 *
 * Retourne quand toute la file pour l'instant est traitée. Les actions
 * arrivées pendant le traitement seront ramassées par le prochain appel
 * (déclenché par notifyQueueChange → useOfflineSync).
 */
export async function processQueue(): Promise<void> {
  if (!isOfflineStorageAvailable()) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  if (isProcessing) return;
  isProcessing = true;

  try {
    // Snapshot : on récupère la liste UNE fois pour ce passage. Les actions
    // ajoutées pendant le traitement seront prises par le prochain trigger.
    const queue = await getDB()
      .pending_actions.where("status")
      .equals("queued")
      .sortBy("createdAt");

    for (const action of queue) {
      // Re-check de l'état réseau au cas où ça coupe pendant la boucle.
      if (typeof navigator !== "undefined" && !navigator.onLine) break;
      await processOne(action);
    }
  } finally {
    isProcessing = false;
  }
}

async function processOne(action: PendingAction): Promise<void> {
  const db = getDB();

  // Passe en "syncing" (pour l'UI). En cas de crash, le statut restera
  // "syncing" — au prochain démarrage on les remet en "queued" via
  // `resetStuckSyncing()` au boot.
  await db.pending_actions.update(action.id, {
    status: "syncing",
    attempts: action.attempts + 1,
    lastAttemptAt: Date.now(),
  });
  notifyQueueChange();

  try {
    const result = await execActionOnServer(actionAsInput(action), action.id);

    if (result.error) {
      if (isConflictError(result.error)) {
        // Le serveur fait foi : on jette proprement.
        await db.pending_actions.delete(action.id);
        notifyQueueChange();
        notifyResolved({
          action,
          result: "conflict",
          message: result.error,
        });
        return;
      }

      // Erreur applicative non-conflictuelle (rare) : on traite comme un
      // échec et on garde l'action pour décision utilisateur.
      await markFailed(action, result.error);
      return;
    }

    // Succès (incl. "Déjà appliqué" : idempotency triggerée côté serveur).
    await db.pending_actions.delete(action.id);
    notifyQueueChange();
    notifyResolved({
      action,
      result: "success",
      message: result.success ?? "Synchronisé.",
    });
  } catch (err) {
    // Erreur réseau / serveur down → retry si attempts < MAX, sinon failed.
    const message = err instanceof Error ? err.message : String(err);
    const next = action.attempts + 1;
    if (next < MAX_ATTEMPTS) {
      await db.pending_actions.update(action.id, {
        status: "queued",
        lastError: message,
      });
      notifyQueueChange();
    } else {
      await markFailed(action, message);
    }
  }
}

async function markFailed(action: PendingAction, message: string) {
  await getDB().pending_actions.update(action.id, {
    status: "failed",
    lastError: message,
  });
  notifyQueueChange();
  notifyResolved({ action, result: "failed", message });
}

// ---------------------------------------------------------------------------
// Helpers UI
// ---------------------------------------------------------------------------

export async function getPendingActions(): Promise<PendingAction[]> {
  if (!isOfflineStorageAvailable()) return [];
  try {
    return await getDB().pending_actions.orderBy("createdAt").toArray();
  } catch {
    return [];
  }
}

/** Compte les actions qui ne sont pas encore résolues (queued + syncing). */
export async function getActiveCount(): Promise<number> {
  if (!isOfflineStorageAvailable()) return 0;
  try {
    return await getDB()
      .pending_actions.where("status")
      .anyOf(["queued", "syncing"])
      .count();
  } catch {
    return 0;
  }
}

/** Compte les actions en échec (à présenter pour retry manuel). */
export async function getFailedCount(): Promise<number> {
  if (!isOfflineStorageAvailable()) return 0;
  try {
    return await getDB()
      .pending_actions.where("status")
      .equals("failed")
      .count();
  } catch {
    return 0;
  }
}

/** Compte les actions en attente pour une commande donnée (affichage UI). */
export async function getPendingForOrder(
  orderId: string
): Promise<PendingAction[]> {
  if (!isOfflineStorageAvailable()) return [];
  try {
    return await getDB()
      .pending_actions.where("orderId")
      .equals(orderId)
      .toArray();
  } catch {
    return [];
  }
}

/** Replace une action failed en queue (re-tentative manuelle). */
export async function retryAction(id: string): Promise<void> {
  await getDB().pending_actions.update(id, {
    status: "queued",
    lastError: null,
  });
  notifyQueueChange();
  void processQueue();
}

/** Jette une action (l'utilisateur abandonne). */
export async function discardAction(id: string): Promise<void> {
  await getDB().pending_actions.delete(id);
  notifyQueueChange();
}

/**
 * Remet en "queued" les actions bloquées en "syncing" (cas d'un crash /
 * rechargement de page en plein milieu d'un appel). À appeler au boot.
 */
export async function resetStuckSyncing(): Promise<void> {
  if (!isOfflineStorageAvailable()) return;
  try {
    const stuck = await getDB()
      .pending_actions.where("status")
      .equals("syncing")
      .toArray();
    for (const a of stuck) {
      await getDB().pending_actions.update(a.id, { status: "queued" });
    }
    if (stuck.length > 0) notifyQueueChange();
  } catch {
    /* ignore */
  }
}
