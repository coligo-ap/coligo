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
    if (!isPushAvailable()) return;
    let cleanup: (() => void) | null = null;

    void registerPushToken(role);
    void attachPushNavigation((path) => router.push(path)).then((c) => {
      cleanup = c;
    });

    return () => {
      cleanup?.();
    };
  }, [role, router]);

  return null;
}
