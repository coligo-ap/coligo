"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isNative } from "@/lib/native/context";

/**
 * App Links Android (flavor client `app.coligo.client`, publié sur Google
 * Play) : quand l'OS ouvre l'app via un lien vérifié `https://coligo.app/...`
 * (e-mail de confirmation, lien partagé…), Capacitor émet `appUrlOpen` avec
 * l'URL complète — on navigue la SPA vers ce chemin au lieu de laisser
 * l'utilisateur sur l'écran où l'app s'était endormie.
 *
 * No-op hors Capacitor (web / PWA) — le plugin est importé dynamiquement pour
 * ne pas alourdir le bundle web (même pattern que lib/native/push.ts).
 */
export function AppUrlListener() {
  const router = useRouter();

  useEffect(() => {
    if (!isNative()) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("appUrlOpen", ({ url }) => {
          try {
            const u = new URL(url);
            // Seuls les liens de NOTRE domaine naviguent en interne — tout
            // autre host est ignoré (l'intent-filter ne matche que coligo.app,
            // ceinture + bretelles).
            if (!/(^|\.)coligo\.app$/i.test(u.hostname)) return;
            router.push(u.pathname + u.search + u.hash);
          } catch {
            /* URL invalide : ignorer */
          }
        });
        if (cancelled) void handle.remove();
        else cleanup = () => void handle.remove();
      } catch {
        /* plugin absent (contexte web) : rien à brancher */
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [router]);

  return null;
}
