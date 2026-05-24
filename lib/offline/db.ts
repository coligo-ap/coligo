/**
 * Base locale Dexie (IndexedDB) pour la résilience offline du commerçant.
 *
 * Deux usages :
 * 1. `orders_cache` — copie des commandes récentes pour lecture offline.
 * 2. `pending_actions` — file d'actions différées (changement de statut,
 *    validation de retrait) à rejouer à la reconnexion.
 *
 * Périmètre VOLONTAIREMENT restreint : lecture + transitions de statut.
 * Le serveur reste la source de vérité ; ce cache n'est qu'une copie pour
 * affichage + une file d'actions en attente.
 *
 * Côté client UNIQUEMENT (IndexedDB n'existe pas côté serveur).
 */

import Dexie, { type Table } from "dexie";
import type { OrderStatus, OrderWithItems } from "@/lib/types";

/** Type d'action différée. Reste minimaliste : seulement ce qui est offline. */
export type PendingActionType = "update_status" | "validate_pickup";

/** Statut local d'une action dans la file. */
export type PendingActionStatus = "queued" | "syncing" | "failed";

/** Payload d'une action `update_status`. */
export type UpdateStatusPayload = {
  orderId: string;
  to: OrderStatus;
};

/** Payload d'une action `validate_pickup`. */
export type ValidatePickupPayload = {
  /** Code à 6 chiffres (déjà nettoyé). */
  code: string;
};

export type PendingActionPayload = UpdateStatusPayload | ValidatePickupPayload;

/** Une ligne de la file d'actions différées. */
export type PendingAction = {
  /** UUID stable (= `client_operation_id` envoyé au serveur, idempotency). */
  id: string;
  type: PendingActionType;
  payload: PendingActionPayload;
  /** Order ID rattaché (utile pour l'affichage local & le tri / dédup). */
  orderId: string | null;
  /** Timestamp création (FIFO). */
  createdAt: number;
  /** Statut local. */
  status: PendingActionStatus;
  /** Nombre de tentatives déjà effectuées. */
  attempts: number;
  /** Dernière erreur (string utilisateur), si statut `failed`. */
  lastError: string | null;
  /** Timestamp dernier essai (debug + back-off potentiel). */
  lastAttemptAt: number | null;
};

/** Une commande dans le cache local (snapshot serveur). */
export type CachedOrder = OrderWithItems & {
  /** Timestamp local de la dernière synchro de cette commande. */
  syncedAt: number;
};

class ColigoOfflineDB extends Dexie {
  orders_cache!: Table<CachedOrder, string>;
  pending_actions!: Table<PendingAction, string>;

  constructor() {
    super("coligo_offline");
    // v1 — schéma initial. Bumper la version si on ajoute une table / un index.
    this.version(1).stores({
      // PK = id de la commande ; index sur created_at pour trier; status pour
      // filtrer par colonne kanban hors ligne.
      orders_cache: "id, created_at, status, merchant_id, syncedAt",
      // PK = id (UUID = client_operation_id) ; index createdAt pour FIFO,
      // status pour filtrer la file, orderId pour retrouver les actions d'une
      // commande (affichage optimiste).
      pending_actions: "id, createdAt, status, orderId, type",
    });
  }
}

let dbInstance: ColigoOfflineDB | null = null;

/**
 * Accesseur singleton. Lazy pour éviter de toucher IndexedDB côté serveur
 * (Next.js peut exécuter du code « client » au build pour le tree-shaking).
 */
export function getDB(): ColigoOfflineDB {
  if (typeof window === "undefined") {
    throw new Error("getDB() ne peut être appelé que côté client");
  }
  if (!dbInstance) {
    dbInstance = new ColigoOfflineDB();
  }
  return dbInstance;
}

/** True si IndexedDB est utilisable (browser + pas SSR + pas mode privé bloqué). */
export function isOfflineStorageAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return "indexedDB" in window && window.indexedDB !== null;
  } catch {
    return false;
  }
}
