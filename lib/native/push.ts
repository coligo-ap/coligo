/**
 * Push notifications (app fermée) — pont Capacitor / FCM.
 *
 * Le module `notify.ts` couvre les notifications LOCALES (app ouverte, API
 * `Notification` du navigateur). Ce module-ci couvre les push DISTANTES
 * envoyées par FCM, reçues même app fermée — disponibles uniquement dans
 * le WebView Capacitor (APK Android pour l'instant).
 *
 * Toutes les fonctions sont safe à appeler en contexte web : elles
 * dégradent en no-op et `isPushAvailable()` permet à l'UI d'éviter d'afficher
 * les contrôles dédiés sur web.
 *
 * Le plugin `@capacitor/push-notifications` est dynamiquement importé pour ne
 * pas l'embarquer dans le bundle web — il est traité côté natif.
 */

import { getNativePlatform, isNative } from "./context";

export type PushRole = "merchant" | "customer" | "courier" | "chauffeur";

export function isPushAvailable(): boolean {
  return isNative() && getNativePlatform() === "android";
  // iOS sera ajouté quand on packagera l'APK iOS (Capacitor iOS + APNs).
}

type PushPluginModule = typeof import("@capacitor/push-notifications");

let cachedModule: PushPluginModule | null = null;
async function loadPlugin(): Promise<PushPluginModule | null> {
  if (cachedModule) return cachedModule;
  if (!isPushAvailable()) return null;
  try {
    cachedModule = await import("@capacitor/push-notifications");
    return cachedModule;
  } catch (err) {
    console.warn("[push] plugin import failed:", err);
    return null;
  }
}

/**
 * Demande la permission notifications puis s'enregistre auprès de FCM.
 * Retourne le token FCM obtenu, ou `null` si :
 *  - on n'est pas dans un contexte Capacitor natif (web pur)
 *  - l'utilisateur a refusé la permission
 *  - l'enregistrement FCM a échoué (Google Play Services manquants, etc.)
 *
 * L'enregistrement complet (token + role + user_id) côté serveur est fait
 * par `registerPushToken` — celle-ci ne fait que l'aller-retour natif.
 */
async function obtainFcmToken(): Promise<string | null> {
  const mod = await loadPlugin();
  if (!mod) return null;
  const { PushNotifications } = mod;

  // 1) Permission. Sur Android 13+, déclenche le dialog système POST_NOTIFICATIONS.
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive !== "granted") {
    perm = await PushNotifications.requestPermissions();
  }
  if (perm.receive !== "granted") return null;

  // 1b) Channel custom « coligo_orders » : importance HIGH, son + vibration.
  // Idempotent côté natif ; un createChannel sur un channel existant est un
  // no-op. Le helper d'envoi FCM cible ce channel via `android.notification.channel_id`.
  try {
    await PushNotifications.createChannel({
      id: "coligo_orders",
      name: "Commandes Coligo",
      description: "Nouvelles commandes et changements de statut",
      importance: 5, // IMPORTANCE_HIGH
      visibility: 1, // VISIBILITY_PUBLIC
      sound: "default",
      lights: true,
      vibration: true,
    });
  } catch (err) {
    console.warn("[push] createChannel failed (continue anyway):", err);
  }

  // 2) Enregistrement FCM : on attend l'event `registration` (token) OU
  // `registrationError` (échec). On évite un await infini avec un timeout.
  const token = await new Promise<string | null>((resolve) => {
    let done = false;
    const finish = (val: string | null) => {
      if (done) return;
      done = true;
      // Pas besoin de retirer les listeners (one-shot par appel) — le plugin
      // est singleton mais ces handlers se résolvent une fois et ignorent
      // les events suivants via `done`.
      resolve(val);
    };
    void PushNotifications.addListener("registration", (t) => finish(t.value));
    void PushNotifications.addListener("registrationError", (e) => {
      console.warn("[push] registrationError:", e);
      finish(null);
    });
    setTimeout(() => finish(null), 10_000);
    void PushNotifications.register();
  });

  return token;
}

/**
 * Récupère le token FCM et l'enregistre côté serveur pour ce user + role.
 * Idempotent : appelé à chaque montage du shell (commerçant / client), il
 * met simplement à jour `last_seen_at` si le token est déjà connu.
 *
 * Fire-and-forget : silencieux côté UI, on log les erreurs sans bloquer.
 */
export async function registerPushToken(role: PushRole): Promise<boolean> {
  if (!isPushAvailable()) return false;
  try {
    const token = await obtainFcmToken();
    if (!token) return false;
    const res = await fetch("/api/device-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        role,
        platform: getNativePlatform(),
      }),
    });
    if (!res.ok) {
      console.warn("[push] /api/device-tokens responded", res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[push] registerPushToken failed:", err);
    return false;
  }
}

/**
 * Branche les handlers de tap : quand l'utilisateur clique sur une push
 * (app fermée → ouverture, ou app au premier plan), on navigue vers la
 * route portée par le payload `data.route`. Le serveur d'envoi remplit
 * `data: { route: '/orders/<id>' }` ou similaire.
 *
 * Retourne une fonction de nettoyage à appeler au démontage.
 */
export async function attachPushNavigation(
  onNavigate: (path: string) => void
): Promise<() => void> {
  const mod = await loadPlugin();
  if (!mod) return () => {};
  const { PushNotifications } = mod;

  const tapHandle = await PushNotifications.addListener(
    "pushNotificationActionPerformed",
    (action) => {
      const route = action.notification?.data?.route;
      if (typeof route === "string" && route.startsWith("/")) {
        onNavigate(route);
      }
    }
  );

  // Si la push arrive app ouverte, on laisse `OrderRealtimeBridge` /
  // `CustomerOrderLive` gérer la mise à jour visuelle — pas besoin d'overlay
  // ici. On garde quand même un listener pour pouvoir logger.
  const recvHandle = await PushNotifications.addListener(
    "pushNotificationReceived",
    (notif) => {
      if (process.env.NODE_ENV !== "production") {
        console.info("[push] received in-app:", notif);
      }
    }
  );

  return () => {
    void tapHandle.remove();
    void recvHandle.remove();
  };
}
