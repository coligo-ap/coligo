"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Maintient l'écran allumé via la Screen Wake Lock API.
 *
 * Support :
 *  - Chrome / Edge / Android WebView (depuis 2020).
 *  - Safari iOS 16.4+ (avec ou sans PWA installée).
 *  - Non supporté : Firefox < 126, Safari < 16.4.
 *
 * Détails iOS :
 *  - Le verrou s'auto-libère quand l'onglet passe en arrière-plan (logique
 *    système). On le réacquiert automatiquement au retour via
 *    `visibilitychange`.
 *  - L'utilisateur doit avoir interagi avec la page au moins une fois
 *    (geste utilisateur requis pour le 1er `request`).
 */
export function useWakeLock(enabled: boolean) {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    setSupported(typeof navigator !== "undefined" && "wakeLock" in navigator);
  }, []);

  const acquire = useCallback(async (): Promise<boolean> => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator))
      return false;
    if (sentinelRef.current) return true;
    try {
      // `wakeLock.request` est typé sur les nav récents ; cast minimal.
      const sentinel = await (
        navigator as Navigator & {
          wakeLock: { request: (type: "screen") => Promise<WakeLockSentinel> };
        }
      ).wakeLock.request("screen");
      sentinelRef.current = sentinel;
      setActive(true);
      sentinel.addEventListener("release", () => {
        if (sentinelRef.current === sentinel) {
          sentinelRef.current = null;
          setActive(false);
        }
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  const release = useCallback(async () => {
    const s = sentinelRef.current;
    if (!s) return;
    try {
      await s.release();
    } catch {
      /* ignoré */
    }
    sentinelRef.current = null;
    setActive(false);
  }, []);

  // Acquisition / relâchement quand le flag `enabled` change.
  useEffect(() => {
    if (!enabled) {
      void release();
      return;
    }
    void acquire();
    return () => {
      void release();
    };
  }, [enabled, acquire, release]);

  // iOS Safari libère le wake lock au passage en arrière-plan — on le
  // réacquiert dès le retour.
  useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [enabled, acquire]);

  return { supported, active };
}

// Minimal type fallback : `WakeLockSentinel` n'existe pas dans tous les targets TS.
type WakeLockSentinel = EventTarget & {
  release: () => Promise<void>;
  released: boolean;
};
