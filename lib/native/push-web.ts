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
import { isDispatchActive } from "@/lib/realtime/dispatch-presence";

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

    // Push reçue ONGLET AU PREMIER PLAN (le SW ne fire pas) → notif locale.
    // Via le SW (`showNotification`) et non `new Notification()` : le
    // constructeur n'existe pas sur iOS (PWA). Le clic est géré par le
    // listener `notificationclick` du SW (navigation vers data.route).
    onMessage(messaging, (payload) => {
      const n = payload.notification;
      const data = (payload.data ?? {}) as { route?: string; kind?: string };
      // DÉDUP dispatch : si l'écran de dispatch in-app écoute déjà (broadcast
      // Realtime), il affiche le popup riche → on NE double PAS avec une notif
      // système. Si le partenaire est ailleurs (pas d'écoute), on la garde.
      if (data.kind === "chauffeur_new_ride" && isDispatchActive("chauffeur"))
        return;
      if (data.kind === "driver_new_express" && isDispatchActive("courier"))
        return;
      void swReg
        .showNotification(n?.title ?? "Coligo", {
          body: n?.body ?? "",
          icon: "/icon-192.png",
          data: { route: data.route ?? "/" },
        })
        .catch(() => {
          /* Notification indisponible : on ignore (la push système suffit). */
        });
    });

    return true;
  } catch (err) {
    console.warn("[push-web] registerWebPush failed:", err);
    return false;
  }
}

/**
 * Token push web COURANT sans JAMAIS prompter (null si permission ≠ « granted »)
 * et SANS écrire dans device_tokens. Pour l'abonnement MARKETING silencieux aux
 * topics de zone (y compris déconnecté). Best-effort.
 */
export async function getWebPushTokenSilent(): Promise<string | null> {
  try {
    if (typeof window === "undefined") return null;
    if (!isWebPushConfigured()) return null;
    if (!("serviceWorker" in navigator) || !("Notification" in window))
      return null;
    if (Notification.permission !== "granted") return null;

    const { isSupported, getMessaging, getToken } =
      await import("firebase/messaging");
    if (!(await isSupported().catch(() => false))) return null;

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
    return token || null;
  } catch (err) {
    console.warn("[push-web] getWebPushTokenSilent failed:", err);
    return null;
  }
}
