"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { Loader2, Search, Undo2, Trash2, X } from "lucide-react";
import { MAP_STYLE_URL } from "@/lib/config/map";
import { zoneCircleGeoJSON } from "@/lib/driver/work-zone";
import { geocodeSearch } from "@/app/(customer)/actions";
import { INK, MAP } from "@/lib/design/tokens";

/**
 * Éditeur de zone sur carte (admin) — deux modes :
 *  - "radius"  : un centre (centre du viewport, croix fixe) + un rayon (km) →
 *                disque dessiné. moveend remonte le centre via onCenterChange.
 *  - "polygon" : tap = ajoute un sommet ; polygone + sommets dessinés ; undo /
 *                clear. onPolygonChange remonte l'anneau [[lng,lat],…].
 *
 * Recherche d'adresse (geocodeSearch) pour naviguer vite vers une ville.
 */
type LatLng = { lat: number; lng: number };

export function ZoneMapEditor({
  mode,
  radiusKm,
  initialCenter,
  initialPolygon,
  onCenterChange,
  onPolygonChange,
}: {
  mode: "radius" | "polygon";
  radiusKm: number;
  initialCenter?: LatLng | null;
  initialPolygon?: [number, number][] | null;
  onCenterChange?: (c: LatLng) => void;
  onPolygonChange?: (pts: [number, number][]) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const [ready, setReady] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const radiusRef = useRef(radiusKm);
  radiusRef.current = radiusKm;

  const [poly, setPoly] = useState<[number, number][]>(initialPolygon ?? []);
  const polyRef = useRef<[number, number][]>(poly);
  polyRef.current = poly;
  const onPolyRef = useRef(onPolygonChange);
  onPolyRef.current = onPolygonChange;
  const onCenterRef = useRef(onCenterChange);
  onCenterRef.current = onCenterChange;

  // Recherche d'adresse.
  const [q, setQ] = useState("");
  const [results, setResults] = useState<
    { display: string; lat: number; lng: number }[]
  >([]);
  const [searching, setSearching] = useState(false);

  const start =
    initialCenter ??
    (initialPolygon && initialPolygon[0]
      ? { lat: initialPolygon[0][1], lng: initialPolygon[0][0] }
      : { lat: 36.7538, lng: 3.0588 });

  // Init carte (une fois).
  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    void import("maplibre-gl").then(({ Map }) => {
      if (disposed || !containerRef.current) return;
      const map = new Map({
        container: containerRef.current,
        style: MAP_STYLE_URL as never,
        center: [start.lng, start.lat],
        zoom: 11,
        attributionControl: { compact: true },
      });
      mapRef.current = map;

      map.on("load", () => {
        // Source/couche du disque (radius).
        map.addSource("z-circle", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] } as never,
        });
        map.addLayer({
          id: "z-circle-fill",
          type: "fill",
          source: "z-circle",
          paint: { "fill-color": MAP.zoneLine, "fill-opacity": 0.12 } as never,
        });
        map.addLayer({
          id: "z-circle-line",
          type: "line",
          source: "z-circle",
          paint: {
            "line-color": MAP.zoneLine,
            "line-width": 2,
            "line-dasharray": [2, 1.5],
          } as never,
        });
        // Source/couches du polygone.
        map.addSource("z-poly", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] } as never,
        });
        map.addLayer({
          id: "z-poly-fill",
          type: "fill",
          source: "z-poly",
          paint: { "fill-color": MAP.green, "fill-opacity": 0.14 } as never,
        });
        map.addLayer({
          id: "z-poly-line",
          type: "line",
          source: "z-poly",
          paint: { "line-color": MAP.green, "line-width": 2.5 } as never,
        });
        map.addSource("z-poly-pts", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] } as never,
        });
        map.addLayer({
          id: "z-poly-pts-c",
          type: "circle",
          source: "z-poly-pts",
          paint: {
            "circle-radius": 5,
            "circle-color": MAP.green,
            "circle-stroke-color": INK.white,
            "circle-stroke-width": 2,
          } as never,
        });
        setReady(true);
        redraw(map);
        setTimeout(() => map.resize(), 150);
        setTimeout(() => map.resize(), 600);
      });

      // Radius : le centre suit le viewport.
      map.on("moveend", () => {
        if (modeRef.current !== "radius") return;
        const c = map.getCenter();
        onCenterRef.current?.({ lat: c.lat, lng: c.lng });
        redraw(map);
      });

      // Polygon : clic = ajoute un sommet.
      map.on("click", (e) => {
        if (modeRef.current !== "polygon") return;
        const next: [number, number][] = [
          ...polyRef.current,
          [e.lngLat.lng, e.lngLat.lat],
        ];
        setPoly(next);
        onPolyRef.current?.(next);
      });
    });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redessine selon le mode courant.
  const redraw = (map: import("maplibre-gl").Map) => {
    const circleSrc = map.getSource("z-circle") as
      | { setData: (d: unknown) => void }
      | undefined;
    const polySrc = map.getSource("z-poly") as
      | { setData: (d: unknown) => void }
      | undefined;
    const ptsSrc = map.getSource("z-poly-pts") as
      | { setData: (d: unknown) => void }
      | undefined;

    if (modeRef.current === "radius") {
      const c = map.getCenter();
      circleSrc?.setData(
        zoneCircleGeoJSON({
          lat: c.lat,
          lng: c.lng,
          radiusKm: radiusRef.current,
        })
      );
      polySrc?.setData({ type: "FeatureCollection", features: [] });
      ptsSrc?.setData({ type: "FeatureCollection", features: [] });
    } else {
      circleSrc?.setData({ type: "FeatureCollection", features: [] });
      const pts = polyRef.current;
      const ring = pts.length >= 3 ? [...pts, pts[0]] : pts;
      polySrc?.setData({
        type: "FeatureCollection",
        features:
          pts.length >= 3
            ? [
                {
                  type: "Feature",
                  geometry: { type: "Polygon", coordinates: [ring] },
                  properties: {},
                },
              ]
            : pts.length >= 2
              ? [
                  {
                    type: "Feature",
                    geometry: { type: "LineString", coordinates: pts },
                    properties: {},
                  },
                ]
              : [],
      });
      ptsSrc?.setData({
        type: "FeatureCollection",
        features: pts.map((p) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: p },
          properties: {},
        })),
      });
    }
  };

  // Redessine quand mode / rayon / polygone changent.
  useEffect(() => {
    const map = mapRef.current;
    if (map && ready) redraw(map);
  }, [mode, radiusKm, poly, ready]);

  // Recherche d'adresse (debounce 450 ms).
  useEffect(() => {
    const query = q.trim();
    if (query.length < 3) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const c = mapRef.current?.getCenter();
        const res = await geocodeSearch({ q: query, lat: c?.lat, lng: c?.lng });
        if (res.ok) setResults(res.results);
      } finally {
        setSearching(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [q]);

  const flyTo = (r: { lat: number; lng: number }) => {
    setResults([]);
    setQ("");
    mapRef.current?.flyTo({ center: [r.lng, r.lat], zoom: 13, duration: 700 });
  };

  const undo = () => {
    const next = polyRef.current.slice(0, -1);
    setPoly(next);
    onPolyRef.current?.(next);
  };
  const clear = () => {
    setPoly([]);
    onPolyRef.current?.([]);
  };

  return (
    <div className="border-border relative h-[340px] w-full overflow-hidden rounded-md border">
      <div
        ref={containerRef}
        className="h-full w-full bg-[#e8e8e8]"
        style={{ touchAction: "none" }}
      />

      {/* Recherche */}
      <div className="absolute top-2 right-2 left-2 z-30">
        <div className="bg-surface border-border flex items-center gap-2 rounded-full border px-3 py-2 shadow">
          <Search className="text-subtle size-4 shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher une ville, un quartier…"
            className="placeholder:text-subtle min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {searching ? (
            <Loader2 className="text-subtle size-4 shrink-0 animate-spin" />
          ) : q ? (
            <button
              type="button"
              onClick={() => {
                setQ("");
                setResults([]);
              }}
              className="text-subtle shrink-0"
              aria-label="Effacer"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        {results.length > 0 && (
          <ul className="bg-surface border-border mt-1.5 max-h-52 overflow-auto rounded-md border py-1 shadow-xl">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => flyTo(r)}
                  className="hover:bg-surface-2 text-body-sm w-full px-3 py-2 text-left"
                >
                  {r.display}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Croix centrale (radius). */}
      {mode === "radius" && ready && (
        <div className="pointer-events-none absolute top-1/2 left-1/2 z-[2] -translate-x-1/2 -translate-y-1/2">
          <div className="bg-primary-600 size-3 rounded-full ring-2 ring-white" />
        </div>
      )}

      {/* Outils polygone. */}
      {mode === "polygon" && ready && (
        <div className="absolute bottom-2 left-2 z-30 flex items-center gap-2">
          <span className="bg-surface/95 text-foreground text-caption rounded-full px-2.5 py-1 font-semibold shadow">
            {poly.length} point{poly.length > 1 ? "s" : ""} · tapez pour ajouter
          </span>
          <button
            type="button"
            onClick={undo}
            disabled={!poly.length}
            className="bg-surface border-border inline-flex size-8 items-center justify-center rounded-full border shadow disabled:opacity-40"
            aria-label="Annuler le dernier point"
          >
            <Undo2 className="size-4" />
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={!poly.length}
            className="bg-surface border-border text-danger-600 inline-flex size-8 items-center justify-center rounded-full border shadow disabled:opacity-40"
            aria-label="Tout effacer"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
