"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { Crosshair, Loader2, MapPin } from "lucide-react";
import { getPosition } from "@/lib/native/geolocation";
import { toast } from "@/components/ui/toast";

/**
 * Sélecteur de position sur carte — réutilisable client + commerçant.
 *
 * UX : le marqueur reste au CENTRE du viewport (overlay fixe), le user
 * déplace la carte pour le pointer où il veut. Bouton « Ma position GPS »
 * pour recentrer rapidement. Idem si l'utilisateur est déjà géoloc.
 *
 * Source tuiles : MapTiler si NEXT_PUBLIC_MAPTILER_KEY défini, sinon OSM.
 */

type LatLng = { lat: number; lng: number };

const DEFAULT_CENTER: LatLng = { lat: 36.7538, lng: 3.0588 }; // Alger

/**
 * Style de carte par priorité :
 *  1. MapTiler streets (si NEXT_PUBLIC_MAPTILER_KEY défini) — couverture
 *     Algérie excellente, vectoriel, label arabe + latin.
 *  2. OpenFreeMap "liberty" — vectoriel, GRATUIT, sans clé, hébergé en EU,
 *     basé sur OSM, très rapide comparé aux tuiles OSM raster.
 */
function buildStyle() {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (key) {
    return `https://api.maptiler.com/maps/streets/style.json?key=${key}`;
  }
  return "https://tiles.openfreemap.org/styles/liberty";
}

export type MapPositionPickerProps = {
  initial?: LatLng | null;
  defaultCenter?: LatLng;
  onChange: (pos: LatLng) => void;
  /**
   * Hauteur de la carte (px ou string CSS). Défaut : 280.
   * Note : on évite les classes Tailwind dynamiques (h-[XYZpx]) qui peuvent
   * être purgées si elles ne sont pas écrites en littéral dans le source —
   * un `style={{ height }}` inline est toujours appliqué.
   */
  height?: number | string;
  /** Texte du bouton GPS. */
  gpsLabel?: string;
};

export function MapPositionPicker({
  initial,
  defaultCenter,
  onChange,
  height = 280,
  gpsLabel = "Ma position",
}: MapPositionPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const [loading, setLoading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [debug, setDebug] = useState<string>("init");

  const start = initial ?? defaultCenter ?? DEFAULT_CENTER;

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    // Test WebGL d'abord : sur certains Android/PWA, WebGL est désactivé ou
    // crashé. MapLibre throw un message peu clair, on préfère un message
    // explicite.
    setDebug("webgl-probe");
    const probe = document.createElement("canvas");
    const gl =
      probe.getContext("webgl2") ||
      probe.getContext("webgl") ||
      probe.getContext("experimental-webgl");
    if (!gl) {
      setDebug("no-webgl");
      setMapError(
        "Ton navigateur ne supporte pas WebGL — impossible d'afficher la carte. Active l'accélération matérielle ou utilise un autre navigateur."
      );
      return;
    }
    setDebug("webgl-ok");

    // Tentative 1 : style configuré (MapTiler si clé, sinon OpenFreeMap).
    // Tentative 2 (fallback) : OpenFreeMap si le style 1 échoue (réseau,
    // domaine bloqué, clé invalide…).
    let triedFallback = false;

    const init = (styleUrl: string) => {
      if (disposed || !containerRef.current) return;
      setDebug(
        "loading-" + (styleUrl.includes("maptiler") ? "maptiler" : "openfm")
      );

      void import("maplibre-gl")
        .then(({ Map }) => {
          if (disposed || !containerRef.current) return;
          setDebug("maplibre-imported");

          let map: import("maplibre-gl").Map;
          try {
            map = new Map({
              container: containerRef.current,
              style: styleUrl as never,
              center: [start.lng, start.lat],
              zoom: initial ? 16 : 14,
              attributionControl: { compact: true },
            });
            setDebug("map-instantiated");
          } catch (err) {
            setDebug("init-fail");
            setMapError(
              "Échec init carte : " +
                (err instanceof Error ? err.message : String(err))
            );
            return;
          }
          mapRef.current = map;

          map.dragPan.enable();
          map.scrollZoom.enable();
          map.touchZoomRotate.enable();
          map.doubleClickZoom.enable();
          map.keyboard.enable();

          // Capture toutes les erreurs runtime (tile failed, style failed,
          // network…). Sans ça, MapLibre log dans la console et l'écran
          // reste gris sans explication pour l'utilisateur.
          map.on("error", (e) => {
            const msg = e?.error?.message ?? "Erreur carte inconnue";
            setDebug("map-error: " + msg.slice(0, 40));
            if (!triedFallback && styleUrl.includes("maptiler.com")) {
              triedFallback = true;
              setDebug("falling-back-to-openfm");
              try {
                map.remove();
              } catch {}
              mapRef.current = null;
              init("https://tiles.openfreemap.org/styles/liberty");
              return;
            }
            setMapError("Erreur carte : " + msg);
          });

          const emit = () => {
            const c = map.getCenter();
            onChange({ lat: c.lat, lng: c.lng });
          };
          map.on("moveend", emit);

          const markReady = () => {
            setDebug("ready");
            setMapReady(true);
            setMapError(null);
            emit();
          };
          if (map.loaded()) markReady();
          else map.once("load", markReady);

          setTimeout(() => map.resize(), 100);
          setTimeout(() => map.resize(), 500);
          setTimeout(() => map.resize(), 1500);
        })
        .catch((err) => {
          if (!disposed) {
            setDebug("import-fail");
            setMapError(
              "Carte indisponible : " +
                (err instanceof Error ? err.message : String(err))
            );
          }
        });
    };

    init(buildStyle());

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useGps = async () => {
    setLoading(true);
    try {
      const pos = await getPosition();
      mapRef.current?.flyTo({
        center: [pos.longitude, pos.latitude],
        zoom: 17,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Géoloc indisponible");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="bg-surface-2 relative w-full overflow-hidden rounded-[12px]"
      style={{ height: typeof height === "number" ? `${height}px` : height }}
    >
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ touchAction: "none" }}
      />

      {/* État de chargement / erreur — pointer-events-none CRITIQUE :
          sans ça l'overlay bloque tous les drags / clics sur la carte si
          mapReady ne devient pas true assez vite. */}
      {!mapReady && !mapError && (
        <div className="text-muted pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-white/60 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Chargement de la carte…
        </div>
      )}
      {mapError && (
        <div className="text-danger-700 pointer-events-none absolute inset-0 flex items-center justify-center bg-white/90 px-4 text-center text-xs">
          {mapError}
        </div>
      )}

      {/* Badge debug TEMPORAIRE — affiche l'état réel de l'init carte pour
          diagnostiquer pourquoi le canvas reste gris sur certains devices.
          À retirer une fois le bug identifié. */}
      <div className="bg-foreground/85 pointer-events-none absolute top-2 left-2 rounded-full px-2 py-0.5 font-mono text-[10px] text-white">
        {debug}
      </div>

      {/* Marqueur central fixe (overlay HTML). */}
      {mapReady && (
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full">
          <MapPin
            className="text-primary-700 size-9 drop-shadow-md"
            fill="currentColor"
          />
        </div>
      )}
      <button
        type="button"
        onClick={useGps}
        disabled={loading || !mapReady}
        className="bg-surface border-border absolute right-2 bottom-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Crosshair className="size-3.5" />
        )}
        {gpsLabel}
      </button>
    </div>
  );
}
