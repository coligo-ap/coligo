"use client";

import { useEffect, useRef, useState } from "react";
import { Flame, LocateFixed } from "lucide-react";
import { useDriverPosition } from "@/lib/native/use-driver-position";
import { MAP_STYLE_URL } from "@/lib/config/map";
import { getDemandZones } from "@/app/(driver)/actions";
import {
  DEMAND_LEVEL_META,
  zonesToGeoJSON,
  type DemandLevel,
  type DemandZone,
} from "@/lib/delivery/zones";

/**
 * Carte plein écran de l'accueil livreur (style Uber Eats Driver). Centrée sur
 * la position GPS du livreur (point violet qui pulse) avec les pins de ses
 * commerçants. FAB « recentrer » en bas à droite.
 *
 * Purement visuel : la géoloc utilise `watchPosition` (déjà câblé pour les
 * autres écrans), aucune logique métier ici.
 */

type MerchantPin = { id: string; name: string; lat: number; lng: number };

export function DriverHomeMap({ merchants }: { merchants: MerchantPin[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const meMarkerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const coords = useDriverPosition();
  const followedOnce = useRef(false);
  // Zones de forte demande (heatmap discret). `zonesRef` permet de réappliquer
  // les données dès que la couche est prête, sans dépendre de l'ordre des effets.
  const [zones, setZones] = useState<DemandZone[]>([]);
  const zonesRef = useRef<DemandZone[]>([]);
  const zonesLayerReady = useRef(false);

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
        style: MAP_STYLE_URL as never,
        center: fallback,
        zoom: 13,
        attributionControl: { compact: true },
      });
      mapRef.current = map;

      // Couche « zones de forte demande » — ajoutée au chargement du style.
      map.on("load", () => {
        try {
          if (map.getSource("demand-zones")) return;
          map.addSource("demand-zones", {
            type: "geojson",
            data: zonesToGeoJSON(zonesRef.current) as never,
          });
          // Halo flou (la « zone »). Rayon ~constant au sol (exponentiel base 2
          // ≈ échelle Mercator) × poids du niveau d'intensité.
          map.addLayer({
            id: "demand-zones-glow",
            type: "circle",
            source: "demand-zones",
            paint: {
              "circle-color": ["get", "color"],
              "circle-opacity": 0.28,
              "circle-blur": 0.85,
              "circle-radius": [
                "interpolate",
                ["exponential", 2],
                ["zoom"],
                10,
                ["*", 7, ["get", "w"]],
                14,
                ["*", 30, ["get", "w"]],
                17,
                ["*", 110, ["get", "w"]],
              ],
            } as never,
          });
          // Petit cœur net + compte de commandes au centre.
          map.addLayer({
            id: "demand-zones-core",
            type: "circle",
            source: "demand-zones",
            paint: {
              "circle-color": ["get", "color"],
              "circle-opacity": 0.9,
              "circle-radius": 13,
              "circle-stroke-color": "#fff",
              "circle-stroke-width": 2,
            } as never,
          });
          map.addLayer({
            id: "demand-zones-count",
            type: "symbol",
            source: "demand-zones",
            layout: {
              "text-field": ["get", "label"],
              "text-size": 12,
              "text-font": ["Open Sans Bold", "Noto Sans Bold"],
              "text-allow-overlap": true,
            } as never,
            paint: { "text-color": "#fff" } as never,
          });
          zonesLayerReady.current = true;
        } catch {
          // Style sans glyphes / autre incompat. → on dégrade silencieusement
          // (la carte reste fonctionnelle, juste sans la couche zones).
          zonesLayerReady.current = false;
        }
      });

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

  // Recentre la carte sur ma position en la plaçant dans la zone visible
  // AU-DESSUS du bottom sheet (padding bas ~ moitié de l'écran) pour que le
  // point ne soit pas caché derrière le sheet.
  const flyToMe = (zoom: number) => {
    const map = mapRef.current;
    const ll = meMarkerRef.current?.getLngLat();
    if (!map || !ll) return;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    map.easeTo({
      center: ll,
      zoom,
      duration: 600,
      padding: { top: 60, left: 24, right: 24, bottom: Math.round(vh * 0.5) },
    });
  };

  // Marqueur « moi » (point violet + halo concentrique qui pulse). Cliquable :
  // recentre la carte sur ma position. Suivi auto au premier fix GPS.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !coords) return;
    void import("maplibre-gl").then(({ Marker }) => {
      if (!meMarkerRef.current) {
        const el = document.createElement("div");
        el.style.cssText =
          "position:relative;width:20px;height:20px;cursor:pointer";
        // Pulse et point partagent le MÊME centre (left/top 50% + marges
        // négatives) → l'onde reste bien concentrique au point.
        el.innerHTML = `
          <div style="position:absolute;left:50%;top:50%;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;background:rgba(92,92,224,.25);animation:driver-me-pulse 2s infinite"></div>
          <div style="position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:#5c5ce0;border:3px solid #fff;box-shadow:0 0 0 2px rgba(92,92,224,.6),0 4px 12px rgba(0,0,0,.3)"></div>`;
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          flyToMe(16);
        });
        meMarkerRef.current = new Marker({ element: el, anchor: "center" })
          .setLngLat([coords.longitude, coords.latitude])
          .addTo(map);
      } else {
        meMarkerRef.current.setLngLat([coords.longitude, coords.latitude]);
      }
      if (!followedOnce.current) {
        followedOnce.current = true;
        flyToMe(15);
      }
    });
  }, [coords]);

  // Rafraîchit les zones de forte demande (temps réel léger : 60 s).
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const raw = await getDemandZones();
      if (!alive) return;
      // Filtre/normalise les niveaux côté client (anti-erreur si valeur exotique).
      const valid: DemandLevel[] = ["medium", "high", "very_high"];
      const next: DemandZone[] = raw
        .filter((z) => valid.includes(z.level as DemandLevel))
        .map((z) => ({
          lat: z.lat,
          lng: z.lng,
          cnt: z.cnt,
          level: z.level as DemandLevel,
        }));
      zonesRef.current = next;
      setZones(next);
    };
    void tick();
    const id = setInterval(tick, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Pousse les zones dans la couche dès qu'elles changent (si la couche existe).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !zonesLayerReady.current) return;
    const src = map.getSource("demand-zones") as
      | { setData: (d: unknown) => void }
      | undefined;
    src?.setData(zonesToGeoJSON(zones));
  }, [zones]);

  const hasZones = zones.length > 0;

  return (
    <div className="absolute inset-0">
      <div
        ref={containerRef}
        className="h-full w-full bg-[#e8e8e8]"
        style={{ touchAction: "none" }}
      />
      {/* Légende des zones de forte demande — visible uniquement s'il y en a. */}
      {hasZones && (
        <div className="absolute top-[max(14px,env(safe-area-inset-top))] left-3.5 z-[55] rounded-[14px] bg-white/95 px-3 py-2.5 shadow-[0_6px_16px_rgba(0,0,0,.15)] backdrop-blur">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-extrabold tracking-wide text-[#0a0a0a] uppercase">
            <Flame className="size-3.5 text-[#f97316]" />
            Zones de forte demande
          </p>
          <div className="flex flex-col gap-1">
            {(["very_high", "high", "medium"] as DemandLevel[]).map((lvl) => (
              <span
                key={lvl}
                className="flex items-center gap-2 text-[11px] font-semibold text-[#0a0a0a]"
              >
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: DEMAND_LEVEL_META[lvl].color }}
                />
                {DEMAND_LEVEL_META[lvl].label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* FAB recentrer — flotte au-dessus du bottom sheet. */}
      <button
        type="button"
        onClick={() => flyToMe(16)}
        aria-label="Recentrer sur ma position"
        className="absolute right-3.5 bottom-[calc(64vh+14px)] z-[55] grid size-12 place-items-center rounded-full bg-white text-[#0a0a0a] shadow-[0_6px_16px_rgba(0,0,0,.15)] active:scale-95"
      >
        <LocateFixed className="size-5" />
      </button>
    </div>
  );
}
