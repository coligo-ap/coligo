"use client";

import { useEffect } from "react";

/**
 * Enregistre `/sw.js` au boot. Limité à la prod par défaut pour ne pas
 * polluer le HMR en dev — on peut forcer l'activation en posant
 * `NEXT_PUBLIC_ENABLE_SW=true` dans `.env.local`.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

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
