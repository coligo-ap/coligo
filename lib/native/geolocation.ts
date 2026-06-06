/**
 * Géolocalisation — Web API uniquement (PWA).
 * En APK Capacitor : remplacer ces implémentations par `@capacitor/geolocation`
 * (le code appelant ne change pas, il importe `lib/native`).
 *
 * - `getPosition()` one-shot
 * - `watchPosition()` retourne un id à passer à `clearWatch()`
 * - `sharePosition()` via Web Share API, sinon fallback clipboard
 *
 * En APK Capacitor (isNative), on passe par `@capacitor/geolocation` : il gère
 * le RUNTIME GRANT Android (la WebView seule ne le demande pas → échec). En web
 * pur, on garde l'API Geolocation du navigateur.
 */

import { isNative } from "./context";

export type Coords = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
};

export type GeolocationErrorKind =
  | "unsupported"
  | "denied"
  | "unavailable"
  | "timeout"
  | "unknown";

export class GeolocationError extends Error {
  kind: GeolocationErrorKind;
  constructor(kind: GeolocationErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = "GeolocationError";
  }
}

function mapError(err: GeolocationPositionError): GeolocationError {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return new GeolocationError("denied", "Permission refusée.");
    case err.POSITION_UNAVAILABLE:
      return new GeolocationError(
        "unavailable",
        "Position indisponible (GPS/réseau)."
      );
    case err.TIMEOUT:
      return new GeolocationError(
        "timeout",
        "Délai dépassé pour obtenir la position."
      );
    default:
      return new GeolocationError(
        "unknown",
        "Localisation impossible. Choisis ta position sur la carte."
      );
  }
}

function toCoords(pos: GeolocationPosition): Coords {
  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    timestamp: pos.timestamp,
  };
}

export function geolocationSupported(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

// ───────────────────────── Natif (Capacitor) ─────────────────────────
// Importé dynamiquement pour ne pas alourdir le bundle web.

type CapPosition = {
  coords: { latitude: number; longitude: number; accuracy: number };
  timestamp: number;
};

function fromCap(pos: CapPosition): Coords {
  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    timestamp: pos.timestamp,
  };
}

/** Garantit le grant de localisation natif ; throw `denied` sinon. */
async function ensureNativePermission(
  Geolocation: typeof import("@capacitor/geolocation").Geolocation
): Promise<void> {
  let perm = await Geolocation.checkPermissions();
  if (perm.location !== "granted" && perm.coarseLocation !== "granted") {
    perm = await Geolocation.requestPermissions();
  }
  if (perm.location !== "granted" && perm.coarseLocation !== "granted") {
    throw new GeolocationError("denied", "Permission de localisation refusée.");
  }
}

async function nativeGetPosition(): Promise<Coords> {
  const { Geolocation } = await import("@capacitor/geolocation");
  await ensureNativePermission(Geolocation);
  try {
    return fromCap(
      await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 0,
      })
    );
  } catch {
    // Repli tolérant (basse précision + cache) si le fix précis échoue.
    return fromCap(
      await Geolocation.getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 20_000,
        maximumAge: 60_000,
      })
    );
  }
}

function nativeWatch(
  onUpdate: (coords: Coords) => void,
  onError?: (err: GeolocationError) => void
): WatchHandle {
  let watchId: string | null = null;
  let cancelled = false;
  void (async () => {
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      await ensureNativePermission(Geolocation);
      const id = await Geolocation.watchPosition(
        { enableHighAccuracy: true },
        (pos, err) => {
          if (err) {
            onError?.(
              new GeolocationError("unavailable", err.message ?? String(err))
            );
            return;
          }
          if (pos) onUpdate(fromCap(pos as CapPosition));
        }
      );
      if (cancelled) await Geolocation.clearWatch({ id });
      else watchId = id;
    } catch (e) {
      onError?.(
        e instanceof GeolocationError
          ? e
          : new GeolocationError("unknown", String(e))
      );
    }
  })();
  return {
    id: 0,
    stop: () => {
      cancelled = true;
      if (watchId) {
        const id = watchId;
        void import("@capacitor/geolocation").then(({ Geolocation }) =>
          Geolocation.clearWatch({ id })
        );
      }
    },
  };
}

/** Tentative unique `getCurrentPosition` enveloppée en Promise. */
function getOnce(opts: PositionOptions): Promise<Coords> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(toCoords(pos)),
      (err) => reject(mapError(err)),
      opts
    );
  });
}

/**
 * Position one-shot ROBUSTE (stratégie à deux niveaux) :
 *  1) haute précision, timeout court (8 s), pas de cache → meilleur fix rapide.
 *  2) si échec NON définitif (timeout / indisponible), repli basse précision
 *     (Wi-Fi/IP), timeout plus long, cache accepté (≤ 60 s) → beaucoup plus
 *     fiable sur desktop et mobiles à GPS lent/capricieux.
 * Un refus de permission (`denied`) ou l'absence de support sont définitifs :
 * on ne réessaie pas (inutile, et on évite un 2ᵉ prompt).
 */
export async function getPosition(opts?: PositionOptions): Promise<Coords> {
  // APK : plugin natif (gère le runtime grant Android).
  if (isNative()) return nativeGetPosition();

  if (!geolocationSupported()) {
    throw new GeolocationError("unsupported", "Géoloc non supportée.");
  }
  // Si l'appelant fournit des options explicites, on respecte son choix.
  if (opts) return getOnce(opts);

  try {
    return await getOnce({
      enableHighAccuracy: true,
      timeout: 8_000,
      maximumAge: 0,
    });
  } catch (err) {
    if (err instanceof GeolocationError && err.kind === "denied") throw err;
    // Repli tolérant : basse précision + cache récent accepté.
    return await getOnce({
      enableHighAccuracy: false,
      timeout: 12_000,
      maximumAge: 60_000,
    });
  }
}

export type WatchHandle = { id: number; stop: () => void };

export function watchPosition(
  onUpdate: (coords: Coords) => void,
  onError?: (err: GeolocationError) => void,
  opts: PositionOptions = { enableHighAccuracy: true, maximumAge: 5_000 }
): WatchHandle | null {
  // APK : plugin natif (gère le runtime grant Android).
  if (isNative()) return nativeWatch(onUpdate, onError);

  if (!geolocationSupported()) {
    onError?.(new GeolocationError("unsupported", "Géoloc non supportée."));
    return null;
  }
  const id = navigator.geolocation.watchPosition(
    (pos) => onUpdate(toCoords(pos)),
    (err) => onError?.(mapError(err)),
    opts
  );
  return { id, stop: () => navigator.geolocation.clearWatch(id) };
}

/**
 * Partage une position. Privilégie la Web Share API (UX native), sinon
 * copie un lien Google Maps dans le presse-papiers.
 */
export async function sharePosition(
  coords: Coords,
  label = "Ma position"
): Promise<"shared" | "copied" | "unavailable"> {
  const url = `https://www.google.com/maps?q=${coords.latitude},${coords.longitude}`;
  const text = `${label} : ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
  if (typeof navigator !== "undefined" && "share" in navigator) {
    try {
      await navigator.share({ title: label, text, url });
      return "shared";
    } catch {
      /* utilisateur a annulé ou erreur → on tente clipboard */
    }
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      return "copied";
    } catch {
      /* clipboard refusé → unavailable */
    }
  }
  return "unavailable";
}
