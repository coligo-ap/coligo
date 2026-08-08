"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Expand, MapPin, Navigation, X } from "lucide-react";
import { MAP_STYLE_URL } from "@/lib/config/map";
import { Portal } from "@/components/ui/portal";
import { INK, PRIMARY } from "@/lib/design/tokens";

// =============================================================================
// MerchantMapCard — carte d'emplacement du commerçant (feuille « Plus d'infos »,
// style Bolt Food) : mini-carte NON interactive (un tap l'ouvre en PLEIN
// ÉCRAN, déplaçable/zoomable), adresse dessous + bouton « Itinéraire » qui
// ouvre l'app de navigation (URL Google Maps universelle : app native sur
// mobile, web sinon).
// =============================================================================

function pinElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.innerHTML = `<div style="width:30px;height:30px;border-radius:50% 50% 50% 4px;transform:rotate(45deg);background:${PRIMARY[600]};display:flex;align-items:center;justify-content:center;border:2.5px solid ${INK.white};box-shadow:0 6px 14px -3px rgba(0,0,0,.45)"><svg width="14" height="14" viewBox="0 0 24 24" style="transform:rotate(-45deg)" fill="none" stroke="${INK.white}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 12 4l9 5.5"/><path d="M5 10v9h14v-9"/></svg></div>`;
  return el;
}

function MiniMap({
  lat,
  lng,
  interactive,
  className,
}: {
  lat: number;
  lng: number;
  interactive: boolean;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let map: import("maplibre-gl").Map | null = null;
    void import("maplibre-gl").then(({ Map, Marker }) => {
      if (disposed || !container) return;
      map = new Map({
        container,
        style: MAP_STYLE_URL,
        center: [lng, lat],
        zoom: interactive ? 15 : 14.2,
        interactive,
        attributionControl: false,
      });
      new Marker({ element: pinElement(), anchor: "bottom" })
        .setLngLat([lng, lat])
        .addTo(map);
    });
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [lat, lng, interactive]);

  return <div ref={containerRef} className={className} />;
}

export function MerchantMapCard({
  lat,
  lng,
  name,
  address,
}: {
  lat: number;
  lng: number;
  name: string;
  address: string | null;
}) {
  const t = useTranslations("merchant");
  const [expanded, setExpanded] = useState(false);
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

  return (
    <div className="border-border rounded-card-lg overflow-hidden border">
      {/* Mini-carte : un tap = plein écran (aucune interaction accidentelle
          pendant le scroll de la feuille). */}
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label={t("mapExpand")}
        className="relative block h-40 w-full"
      >
        <MiniMap
          lat={lat}
          lng={lng}
          interactive={false}
          className="h-full w-full"
        />
        <span className="absolute end-2 top-2 grid size-8 place-items-center rounded-full bg-white/90 shadow-sm">
          <Expand className="text-foreground size-4" />
        </span>
      </button>

      <div className="flex items-center gap-3 px-3.5 py-3">
        <span className="min-w-0 flex-1">
          {address && (
            <span className="text-foreground text-body-sm flex items-start gap-1.5 font-semibold">
              <MapPin className="text-primary-600 mt-0.5 size-4 shrink-0" />
              {address}
            </span>
          )}
        </span>
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener"
          className="bg-primary-600 hover:bg-primary-700 text-label-lg inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 font-extrabold text-white"
        >
          <Navigation className="size-3.5" />
          {t("directions")}
        </a>
      </div>

      {/* Plein écran : carte interactive + adresse + itinéraire. */}
      {expanded && (
        <Portal>
          <div className="fixed inset-0 z-[110] flex flex-col bg-white">
            <MiniMap
              lat={lat}
              lng={lng}
              interactive
              className="min-h-0 flex-1"
            />
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label={t("close")}
              className="absolute end-3 top-[calc(env(safe-area-inset-top)+0.75rem)] grid size-10 place-items-center rounded-full bg-white shadow-lg"
            >
              <X className="text-foreground size-5" />
            </button>
            <div className="border-border flex items-center gap-3 border-t bg-white px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
              <span className="min-w-0 flex-1">
                <span className="text-foreground text-body-lg block truncate font-bold">
                  {name}
                </span>
                {address && (
                  <span className="text-muted text-label block truncate font-medium">
                    {address}
                  </span>
                )}
              </span>
              <a
                href={directionsUrl}
                target="_blank"
                rel="noopener"
                className="bg-primary-600 hover:bg-primary-700 text-body-sm inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2.5 font-extrabold text-white"
              >
                <Navigation className="size-4" />
                {t("directions")}
              </a>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}
