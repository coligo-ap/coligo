"use client";

import { useEffect } from "react";
import { isNative } from "@/lib/native/context";

/**
 * Enregistre `/sw.js` au boot — PWA/navigateur UNIQUEMENT.
 *
 * Dans les apps NATIVES (WebView Capacitor iOS/Android), le service worker
 * est non seulement inutile (l'app charge coligo.app en direct, le repli
 * hors-ligne natif est server.errorPath) mais NUISIBLE : sa course
 * réseau ⟷ cache peut servir un HTML périmé DANS l'app (vieux bundle → les
 * correctifs web « n'arrivent jamais », bug vécu iOS build 22-24), et son
 * cache gaspille la mémoire du WebView. On DÉSENREGISTRE donc tout worker
 * hérité d'une session précédente et on purge ses caches — auto-guérison
 * des appareils déjà contaminés, sans rebuild d'app.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // App native : jamais de SW — et nettoyage de l'existant.
    if (isNative()) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {});
      if ("caches" in window) {
        void caches
          .keys()
          .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
          .catch(() => {});
      }
      return;
    }

    const enabled =
      process.env.NODE_ENV === "production" ||
      process.env.NEXT_PUBLIC_ENABLE_SW === "true";
    if (!enabled) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Volontairement silencieux : un échec d'enregistrement ne doit
        // jamais bloquer le rendu de l'app (Algérie : réseau instable).
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
