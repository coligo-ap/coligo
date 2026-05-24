"use client";

import { useEffect } from "react";
import { syncOrdersToCache, pruneOlderThan } from "@/lib/offline/orders-cache";
import type { OrderWithItems } from "@/lib/types";

const PRUNE_AFTER_DAYS = 14;
const PRUNE_AFTER_MS = PRUNE_AFTER_DAYS * 24 * 60 * 60 * 1000;

/**
 * Composant invisible monté sur les pages qui chargent une liste de commandes
 * côté serveur (dashboard, /orders). À chaque rendu (donc à chaque
 * `router.refresh()` déclenché par le bridge Realtime), il pousse le snapshot
 * serveur dans le cache Dexie pour lecture offline ultérieure.
 *
 * Ne rend rien. Volontairement silencieux en cas d'erreur : le offline est une
 * couche de repli, jamais un bloquant.
 */
export function OrdersCacheSync({ orders }: { orders: OrderWithItems[] }) {
  useEffect(() => {
    void syncOrdersToCache(orders);
    void pruneOlderThan(PRUNE_AFTER_MS);
  }, [orders]);

  return null;
}
