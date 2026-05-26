/**
 * Cache + file d'actions hors-ligne pour la PWA livreur.
 *
 * Portée volontairement restreinte (cf. PROMPT 10 — PARTIE A) :
 *  - Cache des commandes/tournées chargées → visibles offline.
 *  - File `pending_actions` pour les confirmations de livraison faites
 *    offline. Chaque action porte un `client_operation_id` → idempotent.
 *  - PAS d'attribution offline. Pas de checkout offline.
 *
 * Serveur = vérité. Conflit → on abandonne proprement et on notifie l'UI.
 */

import Dexie, { Table } from "dexie";

export type CachedOrder = {
  id: string;
  payload: unknown; // snapshot brut de l'API
  cached_at: number;
};

export type PendingAction = {
  id: string; // uuid local = client_operation_id
  kind: "validate_delivery";
  order_id: string;
  code: string | null;
  skip_code: boolean;
  enqueued_at: number;
  attempts: number;
  last_error: string | null;
};

class DriverOfflineDb extends Dexie {
  orders!: Table<CachedOrder, string>;
  pending_actions!: Table<PendingAction, string>;

  constructor() {
    super("coligo-driver-offline");
    this.version(1).stores({
      orders: "id, cached_at",
      pending_actions: "id, enqueued_at, kind, order_id",
    });
  }
}

let _db: DriverOfflineDb | null = null;
export function getDriverDb(): DriverOfflineDb {
  if (!_db) _db = new DriverOfflineDb();
  return _db;
}

export async function cacheOrder(id: string, payload: unknown) {
  await getDriverDb().orders.put({ id, payload, cached_at: Date.now() });
}

export async function getCachedOrder(id: string): Promise<unknown | null> {
  const row = await getDriverDb().orders.get(id);
  return row?.payload ?? null;
}

export async function enqueueValidation(input: {
  orderId: string;
  code: string | null;
  skipCode: boolean;
}): Promise<string> {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `op-${Date.now()}-${Math.random()}`;
  await getDriverDb().pending_actions.put({
    id,
    kind: "validate_delivery",
    order_id: input.orderId,
    code: input.code,
    skip_code: input.skipCode,
    enqueued_at: Date.now(),
    attempts: 0,
    last_error: null,
  });
  return id;
}

export async function listPending(): Promise<PendingAction[]> {
  return getDriverDb().pending_actions.orderBy("enqueued_at").toArray();
}

export async function removePending(id: string) {
  await getDriverDb().pending_actions.delete(id);
}

export async function markPendingError(id: string, error: string) {
  const row = await getDriverDb().pending_actions.get(id);
  if (!row) return;
  await getDriverDb().pending_actions.update(id, {
    attempts: row.attempts + 1,
    last_error: error,
  });
}
