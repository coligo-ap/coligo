/**
 * Notifications locales (app ouverte).
 *
 * Le push système (app fermée) demande VAPID/FCM côté serveur OU l'APK ; il
 * est volontairement isolé hors de ce module. Ici, on couvre uniquement la
 * notification quand l'onglet/app est ouvert(e).
 */

export type NotifyOptions = {
  body?: string;
  icon?: string;
  tag?: string;
  silent?: boolean;
};

export function notifyPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window))
    return "unsupported";
  return Notification.permission;
}

export async function requestNotifyPermission(): Promise<
  NotificationPermission | "unsupported"
> {
  if (typeof window === "undefined" || !("Notification" in window))
    return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

export function notify(title: string, opts: NotifyOptions = {}): boolean {
  if (typeof window === "undefined" || !("Notification" in window))
    return false;
  if (Notification.permission !== "granted") return false;
  try {
    new Notification(title, {
      body: opts.body,
      icon: opts.icon ?? "/icon-192.png",
      badge: "/icon-192.png",
      tag: opts.tag,
      silent: opts.silent,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Renvoie `true` si le push web (app fermée) est techniquement possible côté
 * navigateur. Ne signifie PAS que le serveur backend est branché — c'est juste
 * un capability check pour préparer l'option « notifications hors-app ».
 */
export function pushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}
