"use client";

import { useEffect } from "react";

/**
 * Log au mount le contenu du runtime Capacitor → visible dans logcat même
 * sans naviguer sur /dev/capacitor. Utile pour diagnostiquer si :
 *  - le runtime Capacitor est bien injecté côté WebView (mode Remote URL)
 *  - le plugin `SunmiPrinter` (et autres plugins natifs) est bien exposé
 *
 * Aucune sortie visible côté utilisateur — c'est purement console.
 * À monter dans le `RootLayout`, ne s'exécute qu'une fois par session.
 */
export function CapacitorBootLog() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const cap = (
      window as unknown as {
        Capacitor?: {
          Plugins?: Record<string, unknown>;
          isNativePlatform?: () => boolean;
          getPlatform?: () => string;
        };
      }
    ).Capacitor;
    const info = {
      hasCapacitor: !!cap,
      isNative: cap?.isNativePlatform?.() ?? null,
      platform: cap?.getPlatform?.() ?? null,
      plugins: cap?.Plugins ? Object.keys(cap.Plugins) : [],
    };
    try {
      console.info("[coligo-boot] capacitor " + JSON.stringify(info));
    } catch {
      /* ignored */
    }
  }, []);
  return null;
}
