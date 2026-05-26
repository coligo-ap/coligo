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

function buildStyle() {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (key) {
    return `https://api.maptiler.com/maps/streets/style.json?key=${key}`;
  }
  return {
    version: 8 as const,
    sources: {
      osm: {
        type: "raster" as const,
        tiles: [
          "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors",
      },
    },
    layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
  };
}

export type MapPositionPickerProps = {
  initial?: LatLng | null;
  defaultCenter?: LatLng;
  onChange: (pos: LatLng) => void;
  /** Hauteur en classes Tailwind. Défaut : h-[280px] */
  heightClass?: string;
  /** Texte du bouton GPS. */
  gpsLabel?: string;
};

export function MapPositionPicker({
  initial,
  defaultCenter,
  onChange,
  heightClass = "h-[280px]",
  gpsLabel = "Ma position",
}: MapPositionPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const [loading, setLoading] = useState(false);

  const start = initial ?? defaultCenter ?? DEFAULT_CENTER;

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    void import("maplibre-gl").then(({ Map }) => {
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
      // Émet aussi une valeur initiale (utile si parent attendait un value).
      map.once("load", emit);
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
      className={`relative w-full overflow-hidden rounded-[12px] ${heightClass}`}
    >
      <div ref={containerRef} className="absolute inset-0" />
      {/* Marqueur central fixe (overlay HTML). */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full">
        <MapPin
          className="text-primary-700 size-9 drop-shadow-md"
          fill="currentColor"
        />
      </div>
      <button
        type="button"
        onClick={useGps}
        disabled={loading}
        className="bg-surface border-border absolute right-2 bottom-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow"
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
