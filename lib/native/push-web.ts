"use client";

/**
 * Push web/PWA (navigateur, hors Capacitor) via Firebase Cloud Messaging.
 *
 * Symétrique de `push.ts` (natif Android) : même table `device_tokens`, même
 * canal d'envoi serveur (FCM HTTP v1, lib/fcm/send.ts). Un token web obtenu ici
 * est un token FCM standard → toutes les notifs existantes (commandes, suivi,
 * Express/Tournée, courses, promos…) atterrissent aussi sur navigateur, sans
 * code d'envoi supplémentaire.
 *
 * Tout est gracieux : sans config Firebase (variables NEXT_PUBLIC_FIREBASE_*),
 * navigateur non supporté, ou permission refusée → no-op silencieux.
 */

import type { PushRole } from "./push";

const cfg = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

/** Vrai si les 6 valeurs Firebase Web sont présentes (sinon push web inactif). */
export function isWebPushConfigured(): boolean {
  return Boolean(
    cfg.apiKey &&
    cfg.authDomain &&
    cfg.projectId &&
    cfg.messagingSenderId &&
    cfg.appId &&
    VAPID_KEY
  );
}

export async function registerWebPush(role: PushRole): Promise<boolean> {
  try {
    if (typeof window === "undefined") return false;
    if (!isWebPushConfigured()) return false;
    if (!("serviceWorker" in navigator) || !("Notification" in window)) {
      return false;
    }

    const { isSupported, getMessaging, getToken, onMessage } =
      await import("firebase/messaging");
    if (!(await isSupported().catch(() => false))) return false;

    // Permission notifications (idempotent).
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") return false;

    // SW Firebase sur un SCOPE DÉDIÉ → cohabite avec le SW PWA (/sw.js). La
    // config publique est passée en query (le fichier statique la relit).
    const qs = new URLSearchParams({
      apiKey: cfg.apiKey!,
      authDomain: cfg.authDomain!,
      projectId: cfg.projectId!,
      messagingSenderId: cfg.messagingSenderId!,
      appId: cfg.appId!,
    });
    const swReg = await navigator.serviceWorker.register(
      `/firebase-messaging-sw.js?${qs.toString()}`,
      { scope: "/firebase-cloud-messaging-push-scope" }
    );

    const { initializeApp, getApps, getApp } = await import("firebase/app");
    const app = getApps().length ? getApp() : initializeApp(cfg);
    const messaging = getMessaging(app);

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });
    if (!token) return false;

    const res = await fetch("/api/device-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, role, platform: "web" }),
    });
    if (!res.ok) {
      console.warn("[push-web] /api/device-tokens responded", res.status);
      return false;
    }

    // Push reçue ONGLET AU PREMIER PLAN (le SW ne fire pas) → notif locale +
    // navigation au clic via la route du payload.
    onMessage(messaging, (payload) => {
      const n = payload.notification;
      const data = (payload.data ?? {}) as { route?: string };
      const title = n?.title ?? "Coligo";
      const body = n?.body ?? "";
      try {
        const local = new Notification(title, {
          body,
          icon: "/icon-192.png",
        });
        local.onclick = () => {
          window.focus();
          if (data.route && data.route.startsWith("/")) {
            window.location.assign(data.route);
          }
          local.close();
        };
      } catch {
        /* Notification indisponible : on ignore (la push système suffit). */
      }
    });

    return true;
  } catch (err) {
    console.warn("[push-web] registerWebPush failed:", err);
    return false;
  }
}
