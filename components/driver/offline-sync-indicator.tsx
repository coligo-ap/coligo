"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { CloudOff, Loader2, RefreshCw } from "lucide-react";
import { toast } from "@/components/ui/toast";
import {
  listPending,
  markPendingError,
  removePending,
  type PendingAction,
} from "@/lib/driver-offline/db";
import { validateDelivery } from "@/app/(driver)/actions";

/**
 * Indicateur + processeur de file offline.
 *
 * - Détecte online/offline (`navigator.onLine` + events).
 * - Affiche un badge si offline OU si la file n'est pas vide.
 * - Au retour du réseau, rejoue les actions en attente (one-by-one,
 *   strictement idempotent côté serveur via `client_operation_id`).
 * - Si le serveur refuse (code invalide / pas attribué / déjà livré non
 *   attendu), on retire l'action de la file + toast pour signaler.
 */
export function OfflineSyncIndicator() {
  const router = useRouter();
  const isAr = useLocale() === "ar";
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshCount = useCallback(async () => {
    const list = await listPending();
    setPendingCount(list.length);
  }, []);

  const processQueue = useCallback(async () => {
    setSyncing(true);
    try {
      const queue = await listPending();
      for (const action of queue) {
        await processOne(action, router);
      }
      await refreshCount();
    } finally {
      setSyncing(false);
    }
  }, [router, refreshCount]);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setOnline(navigator.onLine);
    void refreshCount();

    const goOnline = () => {
      setOnline(true);
      void processQueue();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    // Tente une fois au mount au cas où des actions traînent.
    if (navigator.onLine) void processQueue();

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [processQueue, refreshCount]);

  if (online && pendingCount === 0) return null;

  return (
    <div className="border-warning-200 bg-warning-50 text-warning-700 above-nav fixed left-1/2 z-[45] flex -translate-x-1/2 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow">
      {syncing ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : !online ? (
        <CloudOff className="size-3.5" />
      ) : (
        <RefreshCw className="size-3.5" />
      )}
      {!online && (isAr ? "غير متصل" : "Hors ligne")}
      {pendingCount > 0 && (
        <span>
          {pendingCount} {isAr ? "بانتظار المزامنة" : "à synchroniser"}
        </span>
      )}
    </div>
  );
}

async function processOne(
  action: PendingAction,
  router: ReturnType<typeof useRouter>
) {
  if (action.kind !== "validate_delivery") return;
  const r = await validateDelivery({
    orderId: action.order_id,
    code: action.code ?? undefined,
    skipCode: action.skip_code,
  });
  const ar =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("dir") === "rtl";
  if (r.ok) {
    await removePending(action.id);
    toast.success(ar ? "تمت مزامنة التوصيلة" : "Livraison synchronisée");
    router.refresh();
  } else if (
    r.reason === "bad_code" ||
    r.reason === "online_requires_code" ||
    r.reason === "not_attributed_to_you" ||
    r.reason === "order_not_found"
  ) {
    // Refus définitif du serveur — on retire l'action et signale.
    await removePending(action.id);
    toast.error((ar ? "رُفض التأكيد: " : "Validation refusée : ") + r.reason);
  } else {
    // Erreur transitoire — on garde, on incrémente.
    await markPendingError(action.id, r.reason ?? "unknown");
  }
}
