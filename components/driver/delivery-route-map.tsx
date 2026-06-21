"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Clock, ExternalLink, MapPin } from "lucide-react";
import { haversineKm } from "@/lib/delivery/distance";
import { useDriverPosition } from "@/lib/native/use-driver-position";
import { useRoute } from "@/lib/delivery/use-route";
import { MAP_STYLE_URL } from "@/lib/config/map";

/**
 * Carte montrant la position du livreur (live via watchPosition) et la cible
 * (commerçant ou client). Trace le VRAI itinéraire routier (OSRM) + affiche
 * l'ETA « À ~X min · Y km ». Façon UberEats/Yassir.
 *
 * - Itinéraire le long des rues via lib/delivery/routing.ts ; repli sur une
 *   ligne droite (en pointillés) si le routage est indisponible.
 * - Bouton « Ouvrir dans Google Maps » pour le guidage virage-par-virage.
 */

type LatLng = { lat: number; lng: number };

export function DeliveryRouteMap({
  target,
  label,
  height = 220,
}: {
  target: LatLng;
  /** Libellé optionnel au-dessus de la carte (ex. « Vers le client »). */
  label?: string;
  /** Hauteur en px ou string CSS. Inline pour échapper à la purge Tailwind. */
  height?: number | string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const driverMarkerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const coords = useDriverPosition();
  const [mapReady, setMapReady] = useState(false);
  const isAr = useLocale() === "ar";
  const [mapError, setMapError] = useState<string | null>(null);

  const from = coords ? { lat: coords.latitude, lng: coords.longitude } : null;
  const { path } = useRoute(from, target, true);

  // Init de la carte une fois
  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    void import("maplibre-gl")
      .then(({ Map, Marker }) => {
        if (disposed || !containerRef.current) return;

        const map = new Map({
          container: containerRef.current,
          style: MAP_STYLE_URL as never,
          center: [target.lng, target.lat],
          zoom: 14,
          attributionControl: { compact: true },
        });
        mapRef.current = map;

        // Marqueur cible — rouge vif.
        const targetEl = document.createElement("div");
        targetEl.innerHTML =
          '<div style="background:#dc2626;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font-weight:bold;font-size:14px;">●</div>';
        new Marker({ element: targetEl })
          .setLngLat([target.lng, target.lat])
          .addTo(map);

        map.dragPan.enable();
        map.scrollZoom.enable();
        map.touchZoomRotate.enable();
        map.doubleClickZoom.enable();

        const onLoad = () => {
          setMapReady(true);
          if (map.getSource("route")) return;
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
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#6c2bd9", "line-width": 5 },
          });
        };
        if (map.loaded()) onLoad();
        else map.once("load", onLoad);
        setTimeout(() => {
          if (!disposed) setMapReady(true);
        }, 3000);
        // Filet de sécurité : si le container avait 0 px au montage, on resize.
        setTimeout(() => map.resize(), 100);
        setTimeout(() => map.resize(), 500);
        setTimeout(() => map.resize(), 1500);
      })
      .catch((err) => {
        if (!disposed) {
          setMapError(
            (isAr ? "الخريطة غير متاحة: " : "Carte indisponible : ") +
              (err instanceof Error ? err.message : String(err))
          );
        }
      });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [target.lat, target.lng]);

  // Met à jour le marqueur livreur + recadre quand la position change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !coords) return;

    void import("maplibre-gl").then((mod) => {
      const { Marker, LngLatBounds } = mod;
      if (!driverMarkerRef.current) {
        const el = document.createElement("div");
        el.innerHTML =
          '<div style="background:#6c2bd9;color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font-weight:bold;font-size:11px;">🚗</div>';
        driverMarkerRef.current = new Marker({ element: el })
          .setLngLat([coords.longitude, coords.latitude])
          .addTo(map);
      } else {
        driverMarkerRef.current.setLngLat([coords.longitude, coords.latitude]);
      }

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

  // Trace l'itinéraire routier (ou la ligne droite de repli) dès qu'on l'a.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !path) return;
    const apply = () => {
      const src = map.getSource("route") as
        | import("maplibre-gl").GeoJSONSource
        | undefined;
      if (!src) return;
      src.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: path.coordinates },
      });
      // Pointillés si on est sur le repli (trajet approximatif), plein sinon
      // (undefined = on retire l'override → ligne pleine par défaut).
      map.setPaintProperty(
        "route-line",
        "line-dasharray",
        path.source === "fallback" ? [2, 2] : undefined
      );
    };
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [path]);

  const distanceKm =
    path?.distanceKm ??
    (coords
      ? haversineKm(
          { lat: coords.latitude, lng: coords.longitude },
          { lat: target.lat, lng: target.lng }
        )
      : null);

  const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`;

  return (
    <div className="space-y-2">
      {label && (
        <p className="text-muted text-xs font-semibold tracking-wide uppercase">
          {label}
        </p>
      )}
      <div
        className="bg-surface-2 relative w-full overflow-hidden rounded-[12px]"
        style={{ height: typeof height === "number" ? `${height}px` : height }}
      >
        <div
          ref={containerRef}
          className="h-full w-full"
          style={{ touchAction: "none" }}
        />

        {!mapReady && !mapError && (
          <div className="text-muted pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-white/60 text-sm">
            <ExternalLink className="size-4 animate-pulse" />
            Chargement de la carte…
          </div>
        )}
        {mapError && (
          <div className="text-danger-700 pointer-events-none absolute inset-0 flex items-center justify-center bg-white/90 px-4 text-center text-sm">
            {mapError}
          </div>
        )}

        {mapReady && !coords && (
          <div className="bg-surface/90 absolute top-2 left-1/2 -translate-x-1/2 rounded-full border px-3 py-1 text-xs">
            Activation GPS…
          </div>
        )}
        {(distanceKm != null || path != null) && (
          <div className="bg-primary-600/95 absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white">
            {path != null ? (
              <>
                <Clock className="size-3" />~{path.durationMin} min
                <span className="opacity-80">
                  · {path.distanceKm.toFixed(1)} km
                </span>
              </>
            ) : (
              <>
                <MapPin className="size-3" />
                {distanceKm!.toFixed(1)} km
              </>
            )}
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
