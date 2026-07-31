"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { syncStatusBar } from "@/lib/native/status-bar";

/**
 * Garde le contraste de la barre de statut juste : re-synchronise à chaque
 * navigation, au retour au premier plan, au changement de thème (clair/sombre)
 * et après un court délai (le temps que l'en-tête soit peint). Composant
 * INVISIBLE, monté une fois dans la coque — no-op hors application native.
 */
export function StatusBarSync() {
  const pathname = usePathname();

  useEffect(() => {
    // Deux passes : immédiate, puis après peinture (héros/dégradés animés).
    syncStatusBar();
    const t1 = setTimeout(syncStatusBar, 120);
    const t2 = setTimeout(syncStatusBar, 600);

    const onVisible = () => {
      if (document.visibilityState === "visible") syncStatusBar();
    };
    document.addEventListener("visibilitychange", onVisible);

    // Bascule clair/sombre : le thème pose une classe sur <html>.
    const obs = new MutationObserver(() => syncStatusBar());
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme", "data-space"],
    });

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      document.removeEventListener("visibilitychange", onVisible);
      obs.disconnect();
    };
  }, [pathname]);

  return null;
}
