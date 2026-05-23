"use client";

import { useCallback, useEffect, useState } from "react";
import { notifyPermission, requestNotifyPermission } from "@/lib/native";

type State = NotificationPermission | "unsupported";

/**
 * Wrapper React autour de l'API Notification + Permissions API (`notifications`).
 * Re-rend automatiquement quand l'utilisateur change la permission via les
 * réglages du navigateur (event `onchange` du PermissionStatus).
 */
export function useNotifyPermission() {
  const [permission, setPermission] = useState<State>("default");

  useEffect(() => {
    setPermission(notifyPermission());

    if (typeof navigator === "undefined" || !("permissions" in navigator))
      return;
    let status: PermissionStatus | null = null;
    let mounted = true;
    (async () => {
      try {
        status = await navigator.permissions.query({
          name: "notifications" as PermissionName,
        });
        if (!mounted) return;
        const sync = () => setPermission(status?.state as State);
        sync();
        status.addEventListener("change", sync);
      } catch {
        /* `notifications` non supportée par Permissions API → on garde l'état initial */
      }
    })();

    return () => {
      mounted = false;
      status?.removeEventListener?.("change", () =>
        setPermission(notifyPermission())
      );
    };
  }, []);

  const request = useCallback(async () => {
    const next = await requestNotifyPermission();
    setPermission(next);
    return next;
  }, []);

  return { permission, request };
}
