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

  const start = initial ?? defaultCenter ?? DEFAULT_CENTER;

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    void import("maplibre-gl")
      .then(({ Map }) => {
        if (disposed || !containerRef.current) return;

        const map = new Map({
          container: containerRef.current,
          style: buildStyle() as never,
          center: [start.lng, start.lat],
          zoom: initial ? 16 : 14,
          attributionControl: { compact: true },
        });
        mapRef.current = map;

        const emit = () => {
          const c = map.getCenter();
          onChange({ lat: c.lat, lng: c.lng });
        };
        map.on("moveend", emit);
        map.once("load", () => {
          setMapReady(true);
          emit();
        });
        // Filet de sécurité : si le container avait 0 px au moment de l'init
        // (ex: parent qui anime sa hauteur), MapLibre dessine vide.
        // map.resize() à 100/500/1500 ms recouvre tous les cas usuels.
        setTimeout(() => map.resize(), 100);
        setTimeout(() => map.resize(), 500);
        setTimeout(() => map.resize(), 1500);
      })
      .catch((err) => {
        if (!disposed) {
          setMapError(
            "Carte indisponible : " +
              (err instanceof Error ? err.message : String(err))
          );
        }
      });

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
      <div ref={containerRef} className="absolute inset-0" />

      {/* État de chargement / erreur */}
      {!mapReady && !mapError && (
        <div className="text-muted absolute inset-0 flex items-center justify-center gap-2 bg-white/60 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Chargement de la carte…
        </div>
      )}
      {mapError && (
        <div className="text-danger-700 absolute inset-0 flex items-center justify-center bg-white/90 px-4 text-center text-sm">
          {mapError}
        </div>
      )}

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
