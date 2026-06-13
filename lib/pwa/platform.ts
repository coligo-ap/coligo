/**
 * Détections de plateforme côté client — partagées entre la bannière d'install,
 * le guide iOS, le mode comptoir et les pages publiques.
 *
 * Toutes les fonctions renvoient `false` côté serveur (pas de `navigator`).
 */

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPad récent se présente comme « Macintosh » → on regarde aussi le touch.
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/.test(ua) || iPadOS;
}

export function isAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent || "");
}

export function isIosSafari(): boolean {
  if (!isIos()) return false;
  const ua = navigator.userAgent || "";
  // Exclut les WebViews intégrées (Chrome iOS = « CriOS », Firefox iOS = « FxiOS »,
  // apps tierces in-app browser = absence de « Safari/ »).
  if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return false;
  return /Safari\//.test(ua);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

/**
 * Version iOS détectée (ex. 17.2 → 17.2). Retourne `null` hors iOS ou si le
 * user-agent ne porte pas la version.
 */
export function iosVersion(): number | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent || "";
  const m = ua.match(/OS (\d+)[_.](\d+)(?:[_.](\d+))?/);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2] ?? "0");
  if (!Number.isFinite(major)) return null;
  return major + minor / 100;
}

/**
 * `true` si l'appareil iOS supporte le push web une fois la PWA installée
 * (iOS 16.4+). Renvoie aussi `true` sur Android / desktop modernes — le check
 * de capability réel se fait via `pushSupported()` côté `lib/native/notify`.
 */
export function supportsPushIfInstalled(): boolean {
  if (typeof window === "undefined") return false;
  if (!isIos()) return true;
  const v = iosVersion();
  return v !== null && v >= 16.4;
}
