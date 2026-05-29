"use client";

import { useEffect, useRef } from "react";
import { LocateFixed } from "lucide-react";
import { useDriverPosition } from "@/lib/native/use-driver-position";

/**
 * Carte plein écran de l'accueil livreur (style Uber Eats Driver). Centrée sur
 * la position GPS du livreur (point violet qui pulse) avec les pins de ses
 * commerçants. FAB « recentrer » en bas à droite.
 *
 * Purement visuel : la géoloc utilise `watchPosition` (déjà câblé pour les
 * autres écrans), aucune logique métier ici.
 */

type MerchantPin = { id: string; name: string; lat: number; lng: number };

function buildStyle() {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (key) {
    return `https://api.maptiler.com/maps/streets-v2-light/style.json?key=${key}`;
  }
  return "https://tiles.openfreemap.org/styles/positron";
}

export function DriverHomeMap({ merchants }: { merchants: MerchantPin[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const meMarkerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const coords = useDriverPosition();
  const followedOnce = useRef(false);

  // Init carte (une fois). Centre par défaut : 1er commerçant ou Béjaïa.
  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    const fallback = merchants[0]
      ? ([merchants[0].lng, merchants[0].lat] as [number, number])
      : ([5.0667, 36.75] as [number, number]);

    void import("maplibre-gl").then(({ Map, Marker }) => {
      if (disposed || !containerRef.current) return;
      const map = new Map({
        container: containerRef.current,
        style: buildStyle() as never,
        center: fallback,
        zoom: 13,
        attributionControl: { compact: true },
      });
      mapRef.current = map;

      // Pins commerçants — goutte noire avec 🏪.
      for (const m of merchants) {
        const el = document.createElement("div");
        el.innerHTML = `<div style="width:34px;height:34px;border-radius:50% 50% 50% 0;background:#000;transform:rotate(-45deg);display:grid;place-items:center;box-shadow:0 6px 14px rgba(0,0,0,.3)"><span style="transform:rotate(45deg);font-size:14px">🏪</span></div>`;
        new Marker({ element: el, anchor: "bottom" })
          .setLngLat([m.lng, m.lat])
          .addTo(map);
      }

      setTimeout(() => map.resize(), 120);
      setTimeout(() => map.resize(), 600);
    });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // merchants est stable au montage (props serveur) — init une seule fois.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marqueur « moi » (point violet + halo qui pulse) + suivi initial.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !coords) return;
    void import("maplibre-gl").then(({ Marker }) => {
      if (!meMarkerRef.current) {
        const el = document.createElement("div");
        el.style.position = "relative";
        el.innerHTML = `
          <div style="position:absolute;inset:-13px;border-radius:50%;background:rgba(92,92,224,.18);animation:driver-me-pulse 2s infinite"></div>
          <div style="position:relative;width:18px;height:18px;border-radius:50%;background:#5c5ce0;border:3px solid #fff;box-shadow:0 0 0 2px #5c5ce0,0 4px 12px rgba(0,0,0,.25)"></div>`;
        meMarkerRef.current = new Marker({ element: el })
          .setLngLat([coords.longitude, coords.latitude])
          .addTo(map);
      } else {
        meMarkerRef.current.setLngLat([coords.longitude, coords.latitude]);
      }
      if (!followedOnce.current) {
        followedOnce.current = true;
        map.easeTo({
          center: [coords.longitude, coords.latitude],
          zoom: 14,
          duration: 700,
        });
      }
    });
  }, [coords]);

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
      {/* FAB recentrer — au-dessus du bottom sheet. */}
      <button
        type="button"
        onClick={recenter}
        aria-label="Recentrer sur ma position"
        className="absolute right-3.5 bottom-[400px] z-[55] grid size-12 place-items-center rounded-full bg-white text-[#0a0a0a] shadow-[0_6px_16px_rgba(0,0,0,.15)] active:scale-95"
      >
        <LocateFixed className="size-5" />
      </button>
    </div>
  );
}
