"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  attachPushNavigation,
  isPushAvailable,
  registerPushToken,
  type PushRole,
} from "@/lib/native/push";

/**
 * Monté dans le shell (commerçant / client) une fois l'utilisateur connu.
 * S'occupe en arrière-plan de :
 *  - demander la permission push et envoyer le token FCM au serveur ;
 *  - brancher le tap sur push → navigation Next.js vers la route portée
 *    par le payload (`data.route`).
 *
 * No-op sur web (PWA) : `isPushAvailable()` retourne false hors Capacitor.
 */
export function PushRegistrar({ role }: { role: PushRole }) {
  const router = useRouter();

  useEffect(() => {
    // Enregistre le token push : natif (Capacitor Android) OU web (Firebase JS,
    // navigateur/PWA) — la bascule est gérée dans registerPushToken.
    void registerPushToken(role);

    // La navigation au tap n'a de listener dédié qu'en natif ; sur web, le clic
    // est géré par le service worker (notificationclick) / la notif locale.
    if (!isPushAvailable()) return;
    let cleanup: (() => void) | null = null;
    void attachPushNavigation((path) => router.push(path)).then((c) => {
      cleanup = c;
    });
    return () => {
      cleanup?.();
    };
  }, [role, router]);

  return null;
}
