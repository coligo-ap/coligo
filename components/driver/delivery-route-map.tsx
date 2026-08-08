"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ExternalLink, Navigation } from "lucide-react";
import { haversineKm } from "@/lib/delivery/distance";
import { useDriverPosition } from "@/lib/native/use-driver-position";
import { useRoute } from "@/lib/delivery/use-route";
import { MAP_STYLE_URL } from "@/lib/config/map";
import {
  INK,
  MAP,
  PARTNER,
  PRIMARY,
  WARNING,
  withAlpha,
} from "@/lib/design/tokens";

/**
 * Carte de TRAÇAGE de la course (avant / pendant l'offre). Elle montre d'un coup
 * d'œil, avec un CODE COULEUR net :
 *   • MOI (livreur) — pastille VIOLETTE qui pulse (position live).
 *   • Commerçant (RETRAIT) — pin AMBRE 🏪.
 *   • Client (LIVRAISON) — pin VERT 🏠.
 *   • Jambe 1 (moi → commerçant) — trait VIOLET plein.
 *   • Jambe 2 (commerçant → client) — trait VERT plein.
 * Le tracé suit les VRAIES rues (OSRM, lib/delivery/routing.ts) et l'ETA est
 * calculée façon SCOOTER (lib/delivery/scooter.ts). Badges de distance par jambe
 * en surimpression. Repli ligne droite pointillée si le routage est indispo.
 */

type LatLng = { lat: number; lng: number };

const VIOLET = PRIMARY[600];
const GREEN = PARTNER.go;
const AMBER = WARNING[500];

const fmtKm = (km: number | null | undefined) =>
  km == null ? "—" : km.toFixed(1).replace(".", ",");

/** Pin plat (cercle coloré + anneau blanc + ombre légère, PAS de 3D). */
function pinHtml(color: string, iconPath: string) {
  return `<div style="width:30px;height:30px;border-radius:50%;background:${color};display:grid;place-items:center;border:2.5px solid ${INK.white};box-shadow:0 1px 4px rgba(11,12,18,.28)"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="${INK.white}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg></div>`;
}
const STORE_PATH = '<path d="M3 9l1-5h16l1 5M5 9v11h14V9M9 13h6"/>';
const HOME_PATH = '<path d="M3 11l9-8 9 8M5 10v10h14V10"/>';

export function DeliveryRouteMap({
  target,
  via,
  label,
  targetKind = "drop",
  height = 220,
  fill = false,
}: {
  target: LatLng;
  /** Étape intermédiaire (le commerçant). Trace alors deux jambes. */
  via?: LatLng | null;
  /** Libellé optionnel au-dessus de la carte (ex. « Vers le client »). */
  label?: string;
  /** Nature de la cible en mode 1 jambe : retrait (violet) ou livraison (vert). */
  targetKind?: "pickup" | "drop";
  /** Hauteur en px ou string CSS. Inline pour échapper à la purge Tailwind. */
  height?: number | string;
  /** Remplit son parent : ni cadre, ni libellé, ni bouton Google Maps. */
  fill?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const driverMarkerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const coords = useDriverPosition();
  const [mapReady, setMapReady] = useState(false);
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [mapError, setMapError] = useState<string | null>(null);

  const from = coords ? { lat: coords.latitude, lng: coords.longitude } : null;
  // Couleur de la jambe 1 : violet si elle mène au commerçant (retrait), sinon
  // la nature de la cible (une tournée mène directement au client = vert).
  const leg1Color = via ? VIOLET : targetKind === "pickup" ? VIOLET : GREEN;
  // Jambe 1 : du livreur vers son PREMIER arrêt (le commerçant s'il y en a un).
  const { path } = useRoute(from, via ?? target, true);
  // Jambe 2 : du commerçant vers le client. Le hook s'auto-désactive sans `via`.
  const { path: path2 } = useRoute(via ?? null, target, Boolean(via));

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

        // Marqueur du commerçant (étape RETRAIT) — pin ambre 🏪.
        if (via) {
          const viaEl = document.createElement("div");
          viaEl.innerHTML = pinHtml(AMBER, STORE_PATH);
          new Marker({ element: viaEl })
            .setLngLat([via.lng, via.lat])
            .addTo(map);
        }

        // Marqueur cible — vert 🏠 (livraison) ou ambre 🏪 (retrait direct).
        const targetEl = document.createElement("div");
        targetEl.innerHTML =
          via || targetKind === "drop"
            ? pinHtml(GREEN, HOME_PATH)
            : pinHtml(AMBER, STORE_PATH);
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
            paint: { "line-color": leg1Color, "line-width": 5 },
          });
          // Seconde jambe (commerçant → client) : VERTE, dessinée sous la 1re.
          map.addSource("route-2", {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: [] },
            },
          });
          map.addLayer(
            {
              id: "route-line-2",
              type: "line",
              source: "route-2",
              layout: { "line-cap": "round", "line-join": "round" },
              paint: { "line-color": GREEN, "line-width": 4.5 },
            },
            "route-line"
          );
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
      // Carte recréée si la cible/étape change : on oublie le marqueur livreur
      // de l'ancienne carte pour qu'il soit recréé sur la nouvelle.
      driverMarkerRef.current = null;
    };
    // `via` est lu à l'init (marqueur du commerçant) : il en est une dépendance.
  }, [target.lat, target.lng, via?.lat, via?.lng]);

  // Met à jour le marqueur livreur (pastille violette qui pulse) + recadre.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !coords) return;

    void import("maplibre-gl").then((mod) => {
      const { Marker, LngLatBounds } = mod;
      if (!driverMarkerRef.current) {
        const el = document.createElement("div");
        el.style.cssText = "position:relative;width:20px;height:20px";
        el.innerHTML = `
          <div style="position:absolute;left:50%;top:50%;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;background:${withAlpha(MAP.me, 0.22)};animation:driver-me-pulse 2s infinite"></div>
          <div style="position:absolute;left:50%;top:50%;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:${VIOLET};border:3px solid ${INK.white};box-shadow:0 1px 4px rgba(11,12,18,.3)"></div>`;
        driverMarkerRef.current = new Marker({ element: el, anchor: "center" })
          .setLngLat([coords.longitude, coords.latitude])
          .addTo(map);
      } else {
        driverMarkerRef.current.setLngLat([coords.longitude, coords.latitude]);
      }

      try {
        const bounds = new LngLatBounds()
          .extend([coords.longitude, coords.latitude])
          .extend([target.lng, target.lat]);
        if (via) bounds.extend([via.lng, via.lat]);
        map.fitBounds(bounds, {
          // En mode `fill` (offre), la carte d'offre couvre le bas : gros padding
          // bas pour remonter le tracé + les marqueurs dans la bande VISIBLE.
          padding: fill ? { top: 84, bottom: 280, left: 48, right: 48 } : 56,
          duration: 600,
          maxZoom: 15,
        });
      } catch {
        /* fallback : reste sur le marqueur cible */
      }
    });
  }, [coords, target.lat, target.lng, via?.lat, via?.lng, fill]);

  // Trace la jambe 1 (routier ou ligne droite de repli) dès qu'on l'a.
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
      map.setPaintProperty(
        "route-line",
        "line-dasharray",
        path.source === "fallback" ? [2, 2] : undefined
      );
    };
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [path]);

  // Trace la seconde jambe (commerçant → client).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !path2) return;
    const apply = () => {
      const src = map.getSource("route-2") as
        | import("maplibre-gl").GeoJSONSource
        | undefined;
      if (!src) return;
      src.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: path2.coordinates },
      });
      map.setPaintProperty(
        "route-line-2",
        "line-dasharray",
        path2.source === "fallback" ? [2, 2] : undefined
      );
    };
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [path2]);

  const leg1Km =
    path?.distanceKm ?? (from ? haversineKm(from, via ?? target) : null);
  const leg2Km = via ? (path2?.distanceKm ?? null) : null;

  const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`;

  return (
    <div className={fill ? "absolute inset-0" : "space-y-2"}>
      {label && !fill && (
        <p className="text-muted text-xs font-semibold tracking-wide uppercase">
          {label}
        </p>
      )}
      <div
        className={
          fill
            ? "bg-surface-2 absolute inset-0 overflow-hidden"
            : "bg-surface-2 rounded-card-lg relative w-full overflow-hidden"
        }
        style={
          fill
            ? undefined
            : { height: typeof height === "number" ? `${height}px` : height }
        }
      >
        <div
          ref={containerRef}
          className="h-full w-full"
          style={{ touchAction: "none" }}
        />

        {!mapReady && !mapError && (
          <div className="text-muted pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-white/60 text-sm">
            <Navigation className="size-4 animate-pulse" />
            {tr("Chargement de la carte…", "جارٍ تحميل الخريطة…")}
          </div>
        )}
        {mapError && (
          <div className="text-danger-700 pointer-events-none absolute inset-0 flex items-center justify-center bg-white/90 px-4 text-center text-sm">
            {mapError}
          </div>
        )}

        {mapReady && !coords && (
          <div className="bg-surface/90 absolute top-2 left-1/2 -translate-x-1/2 rounded-full border px-3 py-1 text-xs">
            {tr("Activation GPS…", "تفعيل GPS…")}
          </div>
        )}

        {/* Badges de distance CODE COULEUR par jambe (retrait violet / livraison
            vert), en surimpression haut-gauche. Distance = info « d'un coup
            d'œil » ; le temps total vit dans la carte d'offre (pas de doublon). */}
        {(leg1Km != null || leg2Km != null) && (
          <div className="pointer-events-none absolute top-2.5 left-2.5 flex flex-col gap-1.5">
            {leg1Km != null && (
              <span
                className="text-caption-lg inline-flex items-center gap-1.5 self-start rounded-full px-2.5 py-1 font-bold text-white shadow-sm backdrop-blur"
                style={{ background: `${via ? VIOLET : leg1Color}ee` }}
              >
                <span className="size-2 rounded-full bg-white/90" />
                {via
                  ? tr("Retrait", "استلام")
                  : targetKind === "pickup"
                    ? tr("Retrait", "استلام")
                    : tr("Livraison", "توصيل")}{" "}
                · {fmtKm(leg1Km)} km
              </span>
            )}
            {leg2Km != null && (
              <span
                className="text-caption-lg inline-flex items-center gap-1.5 self-start rounded-full px-2.5 py-1 font-bold text-white shadow-sm backdrop-blur"
                style={{ background: `${GREEN}ee` }}
              >
                <span className="size-2 rounded-full bg-white/90" />
                {tr("Livraison", "توصيل")} · {fmtKm(leg2Km)} km
              </span>
            )}
          </div>
        )}
      </div>
      {!fill && (
        <a
          href={gmapsUrl}
          target="_blank"
          rel="noreferrer"
          className="border-border bg-surface flex w-full items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-semibold"
        >
          <ExternalLink className="size-4" />
          {tr("Ouvrir dans Google Maps", "افتح في خرائط Google")}
        </a>
      )}
    </div>
  );
}
