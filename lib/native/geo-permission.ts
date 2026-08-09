/**
 * État de la permission de LOCALISATION — lecture unifiée natif / web, SANS
 * jamais déclencher de dialogue.
 *
 * Pourquoi un module à part : la Permissions API du navigateur (`navigator.
 * permissions.query({name:"geolocation"})`) n'existe pas partout (Safari iOS
 * ancien) et, dans un WebView Capacitor, elle ne reflète PAS le grant Android
 * runtime — elle peut répondre « granted » alors que l'app n'a pas la
 * permission système. En natif, la seule source de vérité est
 * `Geolocation.checkPermissions()` du plugin.
 */

import { isNative } from "./context";

/** `unknown` = impossible à déterminer sans demander (Safari ancien). */
export type GeoPermission = "granted" | "denied" | "prompt" | "unknown";

/** Lit la permission SANS prompt. Ne throw jamais. */
export async function readGeoPermission(): Promise<GeoPermission> {
  if (typeof window === "undefined") return "unknown";

  if (isNative()) {
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      const p = await Geolocation.checkPermissions();
      // `coarseLocation` suffit à faire tourner l'app (précision réduite) :
      // on ne bloque pas un chauffeur qui a accordé la position approximative.
      if (p.location === "granted" || p.coarseLocation === "granted")
        return "granted";
      if (p.location === "denied" && p.coarseLocation === "denied")
        return "denied";
      return "prompt";
    } catch {
      return "unknown";
    }
  }

  try {
    if (navigator.permissions?.query) {
      const status = await navigator.permissions.query({
        name: "geolocation" as PermissionName,
      });
      return status.state as GeoPermission;
    }
  } catch {
    /* Permissions API indisponible → on ne peut pas savoir sans demander */
  }
  return "unknown";
}

/**
 * DEMANDE la permission (déclenche le dialogue système si l'OS l'autorise
 * encore). Retourne l'état obtenu. En natif, `requestPermissions()` ne
 * réaffiche RIEN si l'utilisateur a coché « Ne plus demander » : il renvoie
 * immédiatement `denied` — c'est ce qui fait basculer l'écran bloquant sur
 * « Ouvrir les réglages ».
 */
export async function requestGeoPermission(): Promise<GeoPermission> {
  if (typeof window === "undefined") return "unknown";
  if (isNative()) {
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      const p = await Geolocation.requestPermissions();
      if (p.location === "granted" || p.coarseLocation === "granted")
        return "granted";
      return "denied";
    } catch {
      return "denied";
    }
  }
  // Web : le seul moyen de demander est d'appeler getCurrentPosition.
  return new Promise<GeoPermission>((resolve) => {
    if (!navigator.geolocation) return resolve("unknown");
    navigator.geolocation.getCurrentPosition(
      () => resolve("granted"),
      (err) =>
        resolve(err.code === err.PERMISSION_DENIED ? "denied" : "prompt"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }
    );
  });
}

/**
 * S'abonne aux changements de permission quand la plateforme le permet
 * (Permissions API web). Retourne une fonction de désabonnement.
 *
 * En natif il n'existe AUCUN événement : le retour depuis les réglages du
 * téléphone est détecté par la reprise au premier plan (`useResumeResync`),
 * qui relance une lecture — c'est ce que font les apps natives.
 */
export function onGeoPermissionChange(cb: () => void): () => void {
  if (typeof window === "undefined" || isNative()) return () => {};
  let status: PermissionStatus | null = null;
  let cancelled = false;
  void (async () => {
    try {
      status = await navigator.permissions.query({
        name: "geolocation" as PermissionName,
      });
      if (cancelled) return;
      status.addEventListener("change", cb);
    } catch {
      /* pas de Permissions API → rien à écouter */
    }
  })();
  return () => {
    cancelled = true;
    status?.removeEventListener("change", cb);
  };
}
