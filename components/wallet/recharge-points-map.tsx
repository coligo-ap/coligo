"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { Loader2 } from "lucide-react";
import { MAP_STYLE_URL } from "@/lib/config/map";

export type MapPoint = {
  wallet_id: string;
  display_name: string | null;
  lat: number;
  lng: number;
  distance_km: number;
};

type LatLng = { lat: number; lng: number };

/**
 * Carte read-only des points de recharge (marqueurs multiples) — réutilisable
 * dans tous les espaces. Affiche la position de l'utilisateur + un pin par
 * point ; tap sur un pin → `onSelect`. Robuste : sonde WebGL, révélation
 * garantie (timers), n'est jamais bloquée par une tuile manquante.
 */
export function RechargePointsMap({
  origin,
  points,
  selectedId,
  onSelect,
  onMapError,
  height = 320,
}: {
  origin: LatLng;
  points: MapPoint[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMapError?: () => void;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const markersRef = useRef<Map<string, import("maplibre-gl").Marker>>(
    new Map()
  );
  const elsRef = useRef<Map<string, HTMLElement>>(new Map());
  const [ready, setReady] = useState(false);

  // Dernière valeur des props pour les handlers attachés une seule fois.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // ── Init carte (une fois) ────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const probe = document.createElement("canvas");
    const gl =
      probe.getContext("webgl2") ||
      probe.getContext("webgl") ||
      probe.getContext("experimental-webgl");
    if (!gl) {
      onMapError?.();
      return;
    }

    void import("maplibre-gl")
      .then((maplibre) => {
        if (disposed || !containerRef.current) return;
        let map: import("maplibre-gl").Map;
        try {
          map = new maplibre.Map({
            container: containerRef.current,
            style: MAP_STYLE_URL as never,
            center: [origin.lng, origin.lat],
            zoom: 13,
            attributionControl: { compact: true },
          });
        } catch {
          onMapError?.();
          return;
        }
        mapRef.current = map;

        let styleArrived = false;
        map.on("styledata", () => {
          styleArrived = true;
        });
        map.on("error", (e) => {
          if (!styleArrived) onMapError?.();
          void e;
        });

        const reveal = () => {
          if (disposed || ready) return;
          setReady(true);
        };
        map.once("load", reveal);
        map.once("idle", reveal);
        timers.push(setTimeout(reveal, 1200));
        timers.push(setTimeout(reveal, 2500));
        timers.push(setTimeout(() => map.resize(), 200));
        timers.push(setTimeout(() => map.resize(), 800));
      })
      .catch(() => onMapError?.());

    return () => {
      disposed = true;
      timers.forEach(clearTimeout);
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      elsRef.current.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── (Re)pose les marqueurs quand la carte est prête / les points changent ─
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const maplibrePromise = import("maplibre-gl");

    void maplibrePromise.then((maplibre) => {
      // Nettoyage
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      elsRef.current.clear();

      // Marqueur utilisateur (point bleu pulsé)
      const userEl = document.createElement("div");
      userEl.className = "cg-rp-user";
      new maplibre.Marker({ element: userEl })
        .setLngLat([origin.lng, origin.lat])
        .addTo(map);

      // Marqueurs des points (pins violets cliquables)
      const bounds = new maplibre.LngLatBounds();
      bounds.extend([origin.lng, origin.lat]);
      points.forEach((p) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "cg-rp-pin";
        el.setAttribute("aria-label", p.display_name ?? "Point de recharge");
        el.innerHTML = pinSvg();
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          onSelectRef.current(p.wallet_id);
          map.flyTo({ center: [p.lng, p.lat], zoom: 15, duration: 500 });
        });
        const marker = new maplibre.Marker({ element: el, anchor: "bottom" })
          .setLngLat([p.lng, p.lat])
          .addTo(map);
        markersRef.current.set(p.wallet_id, marker);
        elsRef.current.set(p.wallet_id, el);
        bounds.extend([p.lng, p.lat]);
      });

      // Cadre sur l'ensemble (utilisateur + points)
      if (points.length > 0) {
        try {
          map.fitBounds(bounds, {
            padding: 56,
            maxZoom: 15,
            duration: 500,
          });
        } catch {
          /* bounds dégénéré : on garde le centre courant */
        }
      }
    });
  }, [ready, points, origin.lat, origin.lng]);

  // ── Surbrillance du marqueur sélectionné ─────────────────────────────────
  useEffect(() => {
    elsRef.current.forEach((el, id) => {
      el.classList.toggle("cg-rp-pin--active", id === selectedId);
    });
  }, [selectedId, ready, points]);

  return (
    <div
      className="bg-surface-2 relative w-full overflow-hidden rounded-lg"
      style={{ height }}
    >
      <div ref={containerRef} className="h-full w-full" />
      {!ready && (
        <div className="text-muted pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-white/60 text-sm">
          <Loader2 className="size-4 animate-spin" /> Chargement de la carte…
        </div>
      )}
      {/* Styles des marqueurs (scopés via classes dédiées). */}
      <style>{markerCss}</style>
    </div>
  );
}

function pinSvg(): string {
  return `<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true">
    <path d="M12 2c-3.9 0-7 3.1-7 7 0 5 7 13 7 13s7-8 7-13c0-3.9-3.1-7-7-7z"/>
    <circle cx="12" cy="9" r="2.6" fill="#fff"/>
  </svg>`;
}

const markerCss = `
.cg-rp-pin{background:none;border:0;padding:0;cursor:pointer;color:#6C2BD9;line-height:0;
  filter:drop-shadow(0 2px 3px rgba(20,22,40,.35));transition:transform .15s ease;transform-origin:bottom center}
.cg-rp-pin:hover{transform:scale(1.08)}
.cg-rp-pin--active{color:#FF2D7A;transform:scale(1.22);z-index:2}
.cg-rp-user{width:16px;height:16px;border-radius:9999px;background:#2563eb;border:3px solid #fff;
  box-shadow:0 0 0 4px rgba(37,99,235,.25)}
`;
