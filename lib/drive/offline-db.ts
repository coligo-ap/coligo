/**
 * File hors-ligne Drive (Dexie / IndexedDB) — checklist C8.
 *
 * Une demande de course créée sans réseau est stockée ici (payload complet,
 * `operation_id` = idempotence côté serveur) puis envoyée automatiquement au
 * retour du réseau. File de 1 : une seule demande en attente à la fois
 * (anti-spam aligné sur request_ride). Client UNIQUEMENT (IndexedDB).
 */

import Dexie, { type Table } from "dexie";

export type PendingRideRequest = {
  /** = operation_id envoyé au serveur (idempotence request_ride). */
  id: string;
  payload: Record<string, unknown>;
  createdAt: number;
};

class DriveOfflineDB extends Dexie {
  pending_rides!: Table<PendingRideRequest, string>;
  constructor() {
    super("coligo_drive_offline");
    this.version(1).stores({ pending_rides: "id, createdAt" });
  }
}

let db: DriveOfflineDB | null = null;
function getDb(): DriveOfflineDB | null {
  if (typeof window === "undefined") return null;
  if (!db) db = new DriveOfflineDB();
  return db;
}

/** Met la demande en file (remplace l'éventuelle demande précédente). */
export async function queueRideRequest(
  operationId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const d = getDb();
  if (!d) return;
  await d.pending_rides.clear();
  await d.pending_rides.put({
    id: operationId,
    payload,
    createdAt: Date.now(),
  });
}

/** Demande en attente (ou null). */
export async function getPendingRide(): Promise<PendingRideRequest | null> {
  const d = getDb();
  if (!d) return null;
  const rows = await d.pending_rides.orderBy("createdAt").toArray();
  return rows[0] ?? null;
}

/** Vide la file (envoyée ou annulée par le client). */
export async function clearPendingRide(): Promise<void> {
  const d = getDb();
  if (!d) return;
  await d.pending_rides.clear();
}
