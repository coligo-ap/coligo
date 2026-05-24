"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ACTION_RESOLVED_EVENT,
  getActiveCount,
  getFailedCount,
  processQueue,
  resetStuckSyncing,
  subscribeToQueueChange,
  type ActionResolvedDetail,
} from "@/lib/offline/queue";
import { useOnlineStatus } from "@/lib/hooks/use-online-status";

/**
 * Hook racine de la résilience offline :
 *   - démarre le processeur de file au boot (et nettoie les "syncing" coincés),
 *   - relance le processeur quand on repasse en ligne,
 *   - écoute l'évènement `online` du navigateur,
 *   - expose les compteurs (active / failed) pour l'indicateur de synchro.
 *
 * À monter UNE seule fois dans le shell commerçant.
 */
export function useOfflineSync(): {
  online: boolean;
  pendingCount: number;
  failedCount: number;
  syncing: boolean;
} {
  const online = useOnlineStatus();
  const counts = useQueueCounts();
  const [syncing, setSyncing] = useState(false);

  // Boot : on remet les "syncing" coincés en "queued" puis on lance un passage.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await resetStuckSyncing();
      if (cancelled) return;
      if (typeof navigator !== "undefined" && navigator.onLine) {
        setSyncing(true);
        await processQueue();
        if (!cancelled) setSyncing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Quand on repasse en ligne, on relance.
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    setSyncing(true);
    void (async () => {
      await processQueue();
      if (!cancelled) setSyncing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [online]);

  // Quand la file change (nouvelle action enfilée), on lance aussi.
  useEffect(() => {
    return subscribeToQueueChange(() => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      void processQueue();
    });
  }, []);

  return {
    online,
    pendingCount: counts.active,
    failedCount: counts.failed,
    syncing,
  };
}

type Counts = { active: number; failed: number };

const EMPTY: Counts = { active: 0, failed: 0 };

/**
 * Lit en temps réel les compteurs depuis IndexedDB via useSyncExternalStore.
 * Le snapshot DOIT être référentiellement stable entre deux notifications
 * (sinon useSyncExternalStore boucle) — on caches la dernière valeur lue.
 */
function useQueueCounts(): Counts {
  const [snapshot, setSnapshot] = useState<Counts>(EMPTY);

  // Subscribe re-lit les compteurs à chaque notification.
  const subscribe = (listener: () => void) => {
    return subscribeToQueueChange(() => {
      void refresh().then(() => listener());
    });
    async function refresh() {
      const [active, failed] = await Promise.all([
        getActiveCount(),
        getFailedCount(),
      ]);
      setSnapshot((prev) =>
        prev.active === active && prev.failed === failed
          ? prev
          : { active, failed }
      );
    }
  };

  // Lecture initiale (au montage).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [active, failed] = await Promise.all([
        getActiveCount(),
        getFailedCount(),
      ]);
      if (!cancelled) setSnapshot({ active, failed });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // useSyncExternalStore : le snapshot lui-même est notre state local
  // (déjà rendu stable). On l'utilise pour s'abonner correctement aux
  // changements externes.
  useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY
  );

  return snapshot;
}

/**
 * Hook utilitaire : exécute un callback à chaque résolution d'action
 * (succès / conflit / failed). Utile pour afficher un toast global.
 */
export function useOnActionResolved(
  handler: (detail: ActionResolvedDetail) => void
) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const fn = (e: Event) => {
      const detail = (e as CustomEvent<ActionResolvedDetail>).detail;
      handler(detail);
    };
    window.addEventListener(ACTION_RESOLVED_EVENT, fn);
    return () => window.removeEventListener(ACTION_RESOLVED_EVENT, fn);
  }, [handler]);
}
