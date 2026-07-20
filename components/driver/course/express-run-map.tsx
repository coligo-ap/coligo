"use client";

import { useEffect, useRef } from "react";
import { useLocale } from "next-intl";
import "maplibre-gl/dist/maplibre-gl.css";
import { LocateFixed } from "lucide-react";
import { haversineKm } from "@/lib/delivery/distance";
import { useDriverPosition } from "@/lib/native/use-driver-position";
import { useRoute } from "@/lib/delivery/use-route";
import { MAP_STYLE_URL } from "@/lib/config/map";

/**
 * Carte PLEIN ÉCRAN de la course en cours (écran navigation, style Bolt Driver).
 *
 * - Trace le VRAI itinéraire routier (OSRM via useRoute) entre la position live
 *   du livreur et la cible (commerçant si récupération, client si livraison).
 * - CODE COULEUR par phase : trajet VIOLET vers le commerçant (retrait), VERT
 *   vers le client (livraison). Le pin de destination prend la même couleur.
 * - Point « moi » violet qui pulse + pin de destination plat (pas de 3D).
 * - ETA façon SCOOTER remontée (min + km) au parent via `onEta`.
 *
 * Purement visuel : aucune logique métier. La géoloc réutilise `watchPosition`
 * déjà câblé ailleurs ; le routage réutilise lib/delivery/use-route.
 */

type LatLng = { lat: number; lng: number };

// Code couleur des deux phases (retrait / livraison).
const PHASE = {
  pickup: { main: "#6c2bd9", deep: "#4b1fa6", icon: "🏪" },
  drop: { main: "#16b364", deep: "#0e8c4d", icon: "🏠" },
} as const;

export function ExpressRunMap({
  target,
  kind,
  onEta,
}: {
  target: LatLng;
  /** Type de destination → choix de l'icône du pin. */
  kind: "pickup" | "drop";
  onEta?: (eta: { min: number; km: number } | null) => void;
}) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const phase = PHASE[kind];
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const meMarkerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const targetMarkerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const followedOnce = useRef(false);
  const coords = useDriverPosition();

  const from = coords ? { lat: coords.latitude, lng: coords.longitude } : null;
  const { path } = useRoute(from, target, true);

  // Init de la carte (une fois) + les deux couches du tracé néon.
  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    void import("maplibre-gl").then(({ Map }) => {
      if (disposed || !containerRef.current) return;
      const map = new Map({
        container: containerRef.current,
        style: MAP_STYLE_URL as never,
        center: [target.lng, target.lat],
        zoom: 14,
        attributionControl: { compact: true },
      });
      mapRef.current = map;

      const onLoad = () => {
        if (map.getSource("run-route")) return;
        map.addSource("run-route", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: [] },
          },
        });
        // Couche basse : contour épais (teinte foncée de la phase).
        map.addLayer({
          id: "run-route-base",
          type: "line",
          source: "run-route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": phase.deep, "line-width": 7 },
        });
        // Couche haute : trait fin par-dessus (effet « néon » Bolt).
        map.addLayer({
          id: "run-route-neon",
          type: "line",
          source: "run-route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": phase.main, "line-width": 3.5 },
        });
      };
      if (map.loaded()) onLoad();
      else map.once("load", onLoad);

      setTimeout(() => map.resize(), 120);
      setTimeout(() => map.resize(), 600);
      setTimeout(() => map.resize(), 1500);
    });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      // La carte est recréée quand la cible change (retrait → livraison) : on
      // oublie les marqueurs de l'ancienne carte pour qu'ils soient RECRÉÉS sur
      // la nouvelle (sinon le pin de destination resterait détaché).
      meMarkerRef.current = null;
      targetMarkerRef.current = null;
      followedOnce.current = false;
    };
  }, [target.lat, target.lng]);

  // Pin de destination PLAT (cercle coloré + anneau blanc + ombre légère, PAS
  // de 3D) : ambre-violet 🏪 pour le retrait, vert 🏠 pour la livraison.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    void import("maplibre-gl").then(({ Marker }) => {
      const html = `<div style="width:34px;height:34px;border-radius:50%;background:${phase.main};display:grid;place-items:center;border:3px solid #fff;box-shadow:0 2px 6px rgba(11,12,18,.22);font-size:15px">${phase.icon}</div>`;
      if (!targetMarkerRef.current) {
        const el = document.createElement("div");
        el.innerHTML = html;
        targetMarkerRef.current = new Marker({ element: el, anchor: "center" })
          .setLngLat([target.lng, target.lat])
          .addTo(map);
      } else {
        targetMarkerRef.current.setLngLat([target.lng, target.lat]);
        const box = targetMarkerRef.current.getElement()
          .firstElementChild as HTMLElement | null;
        if (box) box.style.background = phase.main;
      }
    });
  }, [target.lat, target.lng, kind, phase.main, phase.icon]);

  // Marqueur « moi » (point violet + halo qui pulse) + cadrage.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !coords) return;
    void import("maplibre-gl").then(({ Marker, LngLatBounds }) => {
      if (!meMarkerRef.current) {
        const el = document.createElement("div");
        el.style.cssText = "position:relative;width:20px;height:20px";
        // Pulse et point concentriques (même centre).
        el.innerHTML = `
          <div style="position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(108,43,217,.22);animation:driver-me-pulse 2s infinite"></div>
          <div style="position:absolute;left:50%;top:50%;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:#6c2bd9;border:3px solid #fff;box-shadow:0 1px 4px rgba(11,12,18,.3)"></div>`;
        meMarkerRef.current = new Marker({ element: el, anchor: "center" })
          .setLngLat([coords.longitude, coords.latitude])
          .addTo(map);
      } else {
        meMarkerRef.current.setLngLat([coords.longitude, coords.latitude]);
      }
      // Premier fix GPS : cadrer pour voir moi + la destination.
      if (!followedOnce.current) {
        followedOnce.current = true;
        try {
          const bounds = new LngLatBounds()
            .extend([coords.longitude, coords.latitude])
            .extend([target.lng, target.lat]);
          map.fitBounds(bounds, { padding: 90, duration: 700, maxZoom: 15 });
        } catch {
          /* repli : reste centré sur la cible */
        }
      }
    });
  }, [coords, target.lat, target.lng]);

  // Trace l'itinéraire (les deux couches partagent la même source).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !path) return;
    const apply = () => {
      const src = map.getSource("run-route") as
        | import("maplibre-gl").GeoJSONSource
        | undefined;
      if (!src) return;
      src.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: path.coordinates },
      });
      // Repli ligne droite → pointillés sur les deux couches.
      const dash = path.source === "fallback" ? [2, 2] : undefined;
      map.setPaintProperty("run-route-base", "line-dasharray", dash);
      map.setPaintProperty("run-route-neon", "line-dasharray", dash);
    };
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [path]);

  // Remonte l'ETA au parent (bandeau d'étape).
  useEffect(() => {
    if (!onEta) return;
    if (path) {
      onEta({ min: path.durationMin, km: path.distanceKm });
    } else if (from) {
      const km = haversineKm(from, target);
      onEta({ min: Math.max(1, Math.round(km * 5)), km });
    } else {
      onEta(null);
    }
    // Dépend des VALEURS lat/lng (pas de l'identité de `from`/`target`, qui
    // change à chaque render) pour ne pas boucler — même parti-pris qu'useRoute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, from?.lat, from?.lng, target.lat, target.lng, onEta]);

  const recenter = () => {
    const map = mapRef.current;
    if (!map || !coords) return;
    map.easeTo({
      center: [coords.longitude, coords.latitude],
      zoom: 15,
      duration: 600,
    });
  };

  return (
    <div className="absolute inset-0">
      <div
        ref={containerRef}
        className="h-full w-full bg-[#e8e8e8]"
        style={{ touchAction: "none" }}
      />
      <button
        type="button"
        onClick={recenter}
        aria-label={tr("Recentrer sur ma position", "إعادة التمركز على موقعي")}
        className="absolute right-3.5 bottom-[calc(var(--run-sheet-h,300px)+16px)] z-[55] grid size-12 place-items-center rounded-full border border-black/5 bg-white text-[color:var(--violet)] shadow-[0_2px_10px_rgba(11,12,18,.12)] active:scale-95"
      >
        <LocateFixed className="size-5" />
      </button>
    </div>
  );
}
