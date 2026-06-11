"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type maplibregl from "maplibre-gl";
import { MAP_STYLE_URL } from "@/lib/config/map";

/**
 * Carte plein écran du module Drive (MapLibre + OpenFreeMap).
 * Marqueurs HTML façon maquette : point « moi » (halo violet), voiture
 * (pastille noire), épingle destination, + tracé de route (ligne violette,
 * approche grise pointillée). La carte cadre automatiquement les points.
 */

export type LatLng = { lat: number; lng: number };

type Marker = { id: string; pos: LatLng; kind: "me" | "car" | "pin" };

export function DriveMap({
  markers,
  route,
  approach,
  interactive = false,
  onMove,
  className,
  padding = { top: 120, bottom: 340, left: 40, right: 40 },
}: {
  markers: Marker[];
  /** Tracé course (violet plein) : liste de points [départ → arrivée]. */
  route?: LatLng[] | null;
  /** Tracé approche (gris pointillé) : voiture → client. */
  approach?: LatLng[] | null;
  /** true = carte déplaçable (écran de choix du point). */
  interactive?: boolean;
  /** Émis à chaque fin de déplacement (centre courant). */
  onMove?: (center: LatLng) => void;
  className?: string;
  padding?: { top: number; bottom: number; left: number; right: number };
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerObjs = useRef<Map<string, maplibregl.Marker>>(new Map());
  const [ready, setReady] = useState(false);
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    void import("maplibre-gl").then(({ Map }) => {
      if (disposed || !containerRef.current) return;
      const first = markers[0]?.pos ?? { lat: 36.7538, lng: 3.0588 };
      let map: maplibregl.Map;
      try {
        map = new Map({
          container: containerRef.current,
          style: MAP_STYLE_URL as never,
          center: [first.lng, first.lat],
          zoom: 14,
          attributionControl: { compact: true },
        });
      } catch {
        return;
      }
      mapRef.current = map;
      if (!interactive) {
        map.dragPan.disable();
        map.scrollZoom.disable();
        map.doubleClickZoom.disable();
      }
      map.on("moveend", () => {
        const c = map.getCenter();
        onMoveRef.current?.({ lat: c.lat, lng: c.lng });
      });
      const reveal = () => {
        if (!disposed) setReady(true);
      };
      map.once("load", reveal);
      timers.push(setTimeout(reveal, 2200));
      timers.push(setTimeout(() => map.resize(), 150));
      timers.push(setTimeout(() => map.resize(), 600));
    });
    return () => {
      disposed = true;
      timers.forEach(clearTimeout);
      markerObjs.current.forEach((m) => m.remove());
      markerObjs.current.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marqueurs HTML (style maquette).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    void import("maplibre-gl").then(({ Marker: Mk }) => {
      const seen = new Set<string>();
      for (const m of markers) {
        seen.add(m.id);
        const existing = markerObjs.current.get(m.id);
        if (existing) {
          existing.setLngLat([m.pos.lng, m.pos.lat]);
          continue;
        }
        const el = document.createElement("div");
        if (m.kind === "me") {
          el.innerHTML =
            '<div style="width:20px;height:20px;border-radius:50%;background:#5B5BE6;border:4px solid #fff;box-shadow:0 0 0 6px rgba(91,91,230,.42)"></div>';
        } else if (m.kind === "car") {
          el.innerHTML =
            '<div style="width:38px;height:38px;border-radius:50%;background:#0B0C12;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 8px 18px -4px rgba(0,0,0,.4)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14l-1.5-5.5a2 2 0 0 0-1.9-1.5H8.4a2 2 0 0 0-1.9 1.5L5 17Z"/><circle cx="7.5" cy="18.5" r="1.5"/><circle cx="16.5" cy="18.5" r="1.5"/></svg></div>';
        } else {
          el.innerHTML =
            '<div style="width:28px;height:28px;border-radius:50% 50% 50% 4px;transform:rotate(45deg);background:#0B0C12;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 14px -3px rgba(0,0,0,.4)"><svg width="14" height="14" viewBox="0 0 24 24" style="transform:rotate(-45deg)" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="2.5"/></svg></div>';
        }
        const mk = new Mk({
          element: el,
          anchor: m.kind === "pin" ? "bottom" : "center",
        })
          .setLngLat([m.pos.lng, m.pos.lat])
          .addTo(map);
        markerObjs.current.set(m.id, mk);
      }
      markerObjs.current.forEach((mk, id) => {
        if (!seen.has(id)) {
          mk.remove();
          markerObjs.current.delete(id);
        }
      });
    });
  }, [markers, ready]);

  // Tracés (course violette / approche grise pointillée).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const setLine = (
      id: string,
      pts: LatLng[] | null | undefined,
      paint: Record<string, unknown>
    ) => {
      const data = {
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: (pts ?? []).map((p) => [p.lng, p.lat]),
        },
        properties: {},
      };
      const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(data);
      } else if (pts && pts.length > 1) {
        try {
          map.addSource(id, { type: "geojson", data });
          map.addLayer({
            id,
            type: "line",
            source: id,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: paint as never,
          });
        } catch {
          /* style pas encore prêt : retentera au prochain render */
        }
      }
    };
    setLine("drive-route", route, { "line-color": "#5B5BE6", "line-width": 6 });
    setLine("drive-approach", approach, {
      "line-color": "#B7BBC8",
      "line-width": 5,
      "line-dasharray": [2, 1.6],
    });
  }, [route, approach, ready]);

  // Cadrage automatique sur l'ensemble des points.
  const fitKey = JSON.stringify([
    markers.map((m) => [m.pos.lat.toFixed(4), m.pos.lng.toFixed(4)]),
  ]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || interactive) return;
    const pts = [
      ...markers.map((m) => m.pos),
      ...(route ?? []),
      ...(approach ?? []),
    ];
    if (pts.length === 0) return;
    if (pts.length === 1) {
      map.flyTo({ center: [pts[0].lng, pts[0].lat], zoom: 15, duration: 600 });
      return;
    }
    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding, duration: 700, maxZoom: 16 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, ready]);

  return (
    <div className={className ?? "absolute inset-0"}>
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ touchAction: interactive ? "none" : "auto" }}
      />
    </div>
  );
}
