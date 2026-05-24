"use client";

/**
 * Cache local des commandes pour lecture offline.
 *
 * Le serveur reste la source de vérité : ce module n'écrit JAMAIS vers le
 * serveur, et le cache est systématiquement écrasé par les snapshots
 * serveur successifs (à chaque rendu SSR de /dashboard ou /orders qui
 * traverse `syncOrdersToCache`).
 */

import { getDB, isOfflineStorageAvailable, type CachedOrder } from "./db";
import type { OrderWithItems } from "@/lib/types";

const LAST_SYNC_KEY = "coligo:orders_cache:last_sync_at";

/**
 * Remplace les commandes du cache par le snapshot reçu (par PK).
 *
 * Stratégie : `bulkPut` (upsert) sur les commandes du snapshot uniquement.
 * On ne purge PAS les commandes absentes du snapshot : ce sont des commandes
 * plus anciennes que la fenêtre du dashboard (dernières 100) mais toujours
 * potentiellement utiles. La purge se fait par TTL via `pruneOlderThan`.
 */
export async function syncOrdersToCache(
  orders: OrderWithItems[]
): Promise<void> {
  if (!isOfflineStorageAvailable() || orders.length === 0) return;
  const now = Date.now();
  const cached: CachedOrder[] = orders.map((o) => ({ ...o, syncedAt: now }));
  try {
    await getDB().orders_cache.bulkPut(cached);
    try {
      window.localStorage.setItem(LAST_SYNC_KEY, String(now));
    } catch {
      /* localStorage indisponible (mode privé) : on ignore. */
    }
  } catch {
    // IndexedDB peut échouer (quota, mode privé) ; le offline est une
    // amélioration, jamais un bloquant.
  }
}

/** Lit toutes les commandes du cache, triées par created_at décroissant. */
export async function getCachedOrders(): Promise<CachedOrder[]> {
  if (!isOfflineStorageAvailable()) return [];
  try {
    const all = await getDB().orders_cache.toArray();
    return all.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  } catch {
    return [];
  }
}

/** Lit une commande du cache par id. */
export async function getCachedOrder(id: string): Promise<CachedOrder | null> {
  if (!isOfflineStorageAvailable()) return null;
  try {
    const row = await getDB().orders_cache.get(id);
    return row ?? null;
  } catch {
    return null;
  }
}

/** Timestamp ms de la dernière synchro, ou null si jamais synchronisé. */
export function getLastSyncAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_SYNC_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Purge les commandes du cache plus vieilles que `maxAgeMs` (basé sur
 * `syncedAt`). Évite que le cache enfle indéfiniment.
 */
export async function pruneOlderThan(maxAgeMs: number): Promise<void> {
  if (!isOfflineStorageAvailable()) return;
  const cutoff = Date.now() - maxAgeMs;
  try {
    await getDB().orders_cache.where("syncedAt").below(cutoff).delete();
  } catch {
    /* ignore */
  }
}
