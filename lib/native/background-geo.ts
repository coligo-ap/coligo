"use client";

import { isNative } from "./context";

/**
 * Géolocalisation EN ARRIÈRE-PLAN du livreur EN SERVICE (APK Capacitor).
 *
 * But : garder la position du livreur fraîche côté serveur (driver_presence,
 * mig 0130) MÊME quand l'app est en arrière-plan / écran éteint, pour qu'il
 * « sonne » quand une course Express apparaît près de lui (réseau global
 * géolocalisé). Sur le web (PWA), c'est un NO-OP : le poll au premier plan
 * (ZoneDispatch) suffit déjà.
 *
 * Implémentation : plugin natif `@capacitor-community/background-geolocation`,
 * importé dynamiquement et UNIQUEMENT en natif (le bundle web ne l'exécute
 * jamais — même pattern que lib/native/geolocation.ts). Le plugin lance un
 * service de PREMIER PLAN Android (notification persistante « en ligne ») qui
 * maintient le suivi en arrière-plan. Permissions requises dans le Manifest
 * (ACCESS_BACKGROUND_LOCATION, FOREGROUND_SERVICE[_LOCATION]).
 */

type BgLocation = {
  latitude?: number | null;
  longitude?: number | null;
};
type BgError = { code?: string; message?: string };
type BgGeoPlugin = {
  addWatcher(
    options: {
      backgroundTitle?: string;
      backgroundMessage?: string;
      requestPermissions?: boolean;
      stale?: boolean;
      distanceFilter?: number;
    },
    callback: (location?: BgLocation, error?: BgError) => void
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
};

export type BackgroundGeoHandle = { stop: () => void };

/**
 * Démarre le suivi de position en arrière-plan. `onLocation` est appelé à
 * chaque relevé (en service, au premier plan ET en arrière-plan). Retourne un
 * handle `{ stop }` à appeler quand le livreur passe hors-ligne. NO-OP web.
 */
export function startBackgroundGeo(
  onLocation: (lat: number, lng: number) => void
): BackgroundGeoHandle {
  if (!isNative()) return { stop: () => {} };

  let watchId: string | null = null;
  let cancelled = false;

  void (async () => {
    try {
      const { registerPlugin } = await import("@capacitor/core");
      const Bg = registerPlugin<BgGeoPlugin>("BackgroundGeolocation");
      const id = await Bg.addWatcher(
        {
          backgroundTitle: "Coligo — vous êtes en ligne",
          backgroundMessage: "Réception des courses Express à proximité.",
          requestPermissions: true,
          stale: false,
          distanceFilter: 60, // m : un relevé tous les ~60 m (économe batterie)
        },
        (location, error) => {
          if (error || !location) return;
          const lat = location.latitude;
          const lng = location.longitude;
          if (typeof lat === "number" && typeof lng === "number") {
            onLocation(lat, lng);
          }
        }
      );
      if (cancelled) await Bg.removeWatcher({ id });
      else watchId = id;
    } catch {
      /* plugin indisponible (web / non installé) → on ignore proprement */
    }
  })();

  return {
    stop: () => {
      cancelled = true;
      if (watchId) {
        const id = watchId;
        void import("@capacitor/core").then(({ registerPlugin }) =>
          registerPlugin<BgGeoPlugin>("BackgroundGeolocation")
            .removeWatcher({ id })
            .catch(() => {})
        );
      }
    },
  };
}
