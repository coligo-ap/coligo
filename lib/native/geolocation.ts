/**
 * Géolocalisation — Web API uniquement (PWA).
 * En APK Capacitor : remplacer ces implémentations par `@capacitor/geolocation`
 * (le code appelant ne change pas, il importe `lib/native`).
 *
 * - `getPosition()` one-shot
 * - `watchPosition()` retourne un id à passer à `clearWatch()`
 * - `sharePosition()` via Web Share API, sinon fallback clipboard
 */

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
      return new GeolocationError("unknown", "Erreur inconnue.");
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
      timeout: 20_000,
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
