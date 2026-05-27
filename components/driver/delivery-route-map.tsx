"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { ExternalLink, MapPin } from "lucide-react";
import { watchPosition, type Coords } from "@/lib/native/geolocation";
import { haversineKm } from "@/lib/delivery/distance";

/**
 * Carte montrant la position du livreur (mise à jour live via watchPosition)
 * et le point de livraison (client). Affiche la distance restante en haut.
 *
 * - Pas de routing complexe (pas d'API tierce) : juste 2 marqueurs +
 *   un trait géodésique entre eux.
 * - Bouton "Ouvrir dans Google Maps" pour navigation guidée.
 * - Si géoloc indisponible, on cache le marqueur livreur ; la carte reste
 *   centrée sur le client.
 */

type LatLng = { lat: number; lng: number };

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

export function DeliveryRouteMap({
  target,
  heightClass = "h-[220px]",
}: {
  target: LatLng;
  heightClass?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const driverMarkerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const [coords, setCoords] = useState<Coords | null>(null);

  // Géoloc live
  useEffect(() => {
    const handle = watchPosition(
      (c) => setCoords(c),
      () => {},
      { enableHighAccuracy: true, maximumAge: 10_000 }
    );
    return () => handle?.stop();
  }, []);

  // Init de la carte une fois
  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    void import("maplibre-gl").then(({ Map, Marker }) => {
      if (disposed || !containerRef.current) return;

      const map = new Map({
        container: containerRef.current,
        style: buildStyle() as never,
        center: [target.lng, target.lat],
        zoom: 14,
        attributionControl: { compact: true },
      });
      mapRef.current = map;

      // Marqueur cible (client) — rouge vif.
      const targetEl = document.createElement("div");
      targetEl.innerHTML =
        '<div style="background:#dc2626;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font-weight:bold;font-size:14px;">●</div>';
      new Marker({ element: targetEl })
        .setLngLat([target.lng, target.lat])
        .addTo(map);

      // Ligne d'arrivée (sera dessinée quand on aura la position livreur).
      map.on("load", () => {
        map.addSource("route", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: [] },
          },
        });
        map.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          paint: {
            "line-color": "#5c5ce0",
            "line-width": 3,
            "line-dasharray": [2, 2],
          },
        });
      });
    });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [target.lat, target.lng]);

  // Met à jour le marqueur livreur + la ligne quand la position change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !coords) return;

    void import("maplibre-gl").then((mod) => {
      const { Marker, LngLatBounds } = mod;
      if (!driverMarkerRef.current) {
        const el = document.createElement("div");
        el.innerHTML =
          '<div style="background:#5c5ce0;color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font-weight:bold;font-size:11px;">🚗</div>';
        driverMarkerRef.current = new Marker({ element: el })
          .setLngLat([coords.longitude, coords.latitude])
          .addTo(map);
      } else {
        driverMarkerRef.current.setLngLat([coords.longitude, coords.latitude]);
      }

      // Trace la ligne livreur → cible.
      const src = map.getSource("route") as
        | import("maplibre-gl").GeoJSONSource
        | undefined;
      if (src) {
        src.setData({
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [coords.longitude, coords.latitude],
              [target.lng, target.lat],
            ],
          },
        });
      }

      // Recadre pour montrer les deux points.
      try {
        const bounds = new LngLatBounds()
          .extend([coords.longitude, coords.latitude])
          .extend([target.lng, target.lat]);
        map.fitBounds(bounds, { padding: 60, duration: 600, maxZoom: 15 });
      } catch {
        /* fallback : reste sur le marqueur cible */
      }
    });
  }, [coords, target.lat, target.lng]);

  const distanceKm = coords
    ? haversineKm(
        { lat: coords.latitude, lng: coords.longitude },
        { lat: target.lat, lng: target.lng }
      )
    : null;

  const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`;

  return (
    <div className="space-y-2">
      <div
        className={`relative w-full overflow-hidden rounded-[12px] ${heightClass}`}
      >
        <div ref={containerRef} className="absolute inset-0" />
        {!coords && (
          <div className="bg-surface/90 absolute top-2 left-1/2 -translate-x-1/2 rounded-full border px-3 py-1 text-xs">
            Activation GPS…
          </div>
        )}
        {distanceKm != null && (
          <div className="bg-primary-600/95 absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white">
            <MapPin className="size-3" />
            {distanceKm.toFixed(1)} km
          </div>
        )}
      </div>
      <a
        href={gmapsUrl}
        target="_blank"
        rel="noreferrer"
        className="border-border bg-surface flex w-full items-center justify-center gap-1.5 rounded-[10px] border px-3 py-2 text-sm font-semibold"
      >
        <ExternalLink className="size-4" />
        Ouvrir l&apos;itinéraire dans Google Maps
      </a>
    </div>
  );
}
