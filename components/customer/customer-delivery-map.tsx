"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTranslations } from "next-intl";
import { Loader2, Phone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { haversineKm } from "@/lib/delivery/distance";
import { useRoute } from "@/lib/delivery/use-route";
import { MAP_STYLE_URL } from "@/lib/config/map";

/**
 * Mini-carte de suivi LIVE côté CLIENT (refonte « suivi v2 », façon Uber) :
 * une carte compacte (~140px) montrant la position du livreur (mise à jour en
 * temps réel via Realtime sur la ligne `orders`) qui se rapproche du point de
 * livraison le long des rues (itinéraire OSRM). Sous la carte, une barre :
 * prénom du livreur + « en direct » + distance/ETA + bouton d'appel.
 *
 * - On s'abonne à l'UPDATE de SA commande : le payload contient
 *   driver_live_lat/lng/at + delivery_arrived_at → on déplace le marqueur et
 *   on bascule l'état « arrivé » sans recharger la page.
 * - ETA = durée de conduite réelle (OSRM) ; repli distance / 18 km/h.
 */

type LatLng = { lat: number; lng: number };

// Seuil « arrive bientôt / à ta porte » (km).
const NEAR_KM = 0.3;

export function CustomerDeliveryMap({
  orderId,
  destination,
  initialDriver,
  initialArrivedAt = null,
  driverName,
  driverPhone,
  height = 140,
}: {
  orderId: string;
  destination: LatLng;
  initialDriver: (LatLng & { at: string | null }) | null;
  initialArrivedAt?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  height?: number;
}) {
  const t = useTranslations("orders");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const driverMarkerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [driver, setDriver] = useState<(LatLng & { at: string | null }) | null>(
    initialDriver
  );
  const [arrivedAt, setArrivedAt] = useState<string | null>(initialArrivedAt);

  const { path } = useRoute(driver, destination, true);

  // Realtime : reçoit les updates de la commande → position du livreur + arrivée.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`customer-driverloc-${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `id=eq.${orderId}`,
        },
        (payload) => {
          const row = payload.new as {
            driver_live_lat: number | null;
            driver_live_lng: number | null;
            driver_live_at: string | null;
            delivery_arrived_at: string | null;
          };
          if (row.driver_live_lat != null && row.driver_live_lng != null) {
            setDriver({
              lat: row.driver_live_lat,
              lng: row.driver_live_lng,
              at: row.driver_live_at,
            });
          }
          if (row.delivery_arrived_at != null)
            setArrivedAt(row.delivery_arrived_at);
        }
      )
      .subscribe();
    // Filet de sécurité : re-lit la position + l'arrivée toutes les 12 s.
    const poll = setInterval(async () => {
      const { data } = await supabase
        .from("orders")
        .select(
          "driver_live_lat, driver_live_lng, driver_live_at, delivery_arrived_at"
        )
        .eq("id", orderId)
        .maybeSingle();
      if (data?.driver_live_lat != null && data?.driver_live_lng != null) {
        setDriver({
          lat: data.driver_live_lat,
          lng: data.driver_live_lng,
          at: data.driver_live_at,
        });
      }
      if (data?.delivery_arrived_at != null)
        setArrivedAt(data.delivery_arrived_at);
    }, 12_000);

    return () => {
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [orderId]);

  // Init carte une fois (centrée sur la destination).
  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    void import("maplibre-gl")
      .then(({ Map, Marker }) => {
        if (disposed || !containerRef.current) return;
        let map: import("maplibre-gl").Map;
        try {
          map = new Map({
            container: containerRef.current,
            style: MAP_STYLE_URL as never,
            center: [destination.lng, destination.lat],
            zoom: 14,
            attributionControl: { compact: true },
          });
        } catch (err) {
          setMapError(
            t("mapUnavailable") +
              " : " +
              (err instanceof Error ? err.message : String(err))
          );
          return;
        }
        mapRef.current = map;

        // Marqueur destination (maison du client).
        const destEl = document.createElement("div");
        destEl.innerHTML =
          '<div style="background:#16a34a;color:#fff;width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font-size:11px;">🏠</div>';
        new Marker({ element: destEl })
          .setLngLat([destination.lng, destination.lat])
          .addTo(map);

        const reveal = () => {
          if (disposed) return;
          setMapReady(true);
          setMapError(null);
        };
        map.once("load", reveal);
        map.once("idle", reveal);
        map.once("styledata", () => timers.push(setTimeout(reveal, 400)));
        timers.push(setTimeout(reveal, 2500));

        const onLoad = () => {
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
            paint: { "line-color": "#5c5ce0", "line-width": 5 },
          });
        };
        if (map.loaded()) onLoad();
        else map.once("load", onLoad);

        timers.push(setTimeout(() => map.resize(), 100));
        timers.push(setTimeout(() => map.resize(), 600));
        timers.push(setTimeout(() => map.resize(), 1500));
      })
      .catch((err) => {
        if (!disposed)
          setMapError(
            t("mapUnavailable") +
              " : " +
              (err instanceof Error ? err.message : String(err))
          );
      });

    return () => {
      disposed = true;
      timers.forEach(clearTimeout);
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Déplace le marqueur livreur + recadre à chaque nouvelle position.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !driver) return;
    void import("maplibre-gl").then(({ Marker, LngLatBounds }) => {
      if (!driverMarkerRef.current) {
        const el = document.createElement("div");
        el.innerHTML =
          '<div style="background:#5c5ce0;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 8px rgba(92,92,224,.5);font-size:13px;">🛵</div>';
        driverMarkerRef.current = new Marker({ element: el })
          .setLngLat([driver.lng, driver.lat])
          .addTo(map);
      } else {
        driverMarkerRef.current.setLngLat([driver.lng, driver.lat]);
      }
      try {
        const bounds = new LngLatBounds()
          .extend([driver.lng, driver.lat])
          .extend([destination.lng, destination.lat]);
        map.fitBounds(bounds, { padding: 40, duration: 700, maxZoom: 15 });
      } catch {
        /* reste centré sur la destination */
      }
    });
  }, [driver, destination.lat, destination.lng]);

  // Trace l'itinéraire routier (ou ligne droite de repli) dès qu'on l'a.
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

  const distanceKm =
    path?.distanceKm ??
    (driver
      ? haversineKm(
          { lat: driver.lat, lng: driver.lng },
          { lat: destination.lat, lng: destination.lng }
        )
      : null);
  const etaMin = path?.durationMin ?? null;
  const near = distanceKm != null && distanceKm < NEAR_KM;
  const arrived = arrivedAt != null;

  const name = driverName?.trim() || t("yourDriverCap");
  const initial = name.charAt(0).toUpperCase();

  // Sous-texte distance/ETA, façon « à 1,2 km — ~8 min ».
  const subline = arrived
    ? t("driverArrivedAtDoor")
    : near
      ? t("veryClose")
      : [
          distanceKm != null
            ? t("atKm", { km: distanceKm.toFixed(1).replace(".", ",") })
            : null,
          etaMin != null ? `~${etaMin} min` : null,
        ]
          .filter(Boolean)
          .join(" — ") || t("locating");

  return (
    <div className="border-border bg-surface overflow-hidden rounded-[18px] border shadow-sm">
      {/* carte compacte */}
      <div
        className="bg-surface-2 relative w-full"
        style={{ height: `${height}px` }}
      >
        <div
          ref={containerRef}
          className="h-full w-full"
          style={{ touchAction: "none" }}
        />
        {!mapReady && !mapError && (
          <div className="text-muted pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-white/60 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {t("mapLoading")}
          </div>
        )}
        {mapError && (
          <div className="text-danger-700 pointer-events-none absolute inset-0 flex items-center justify-center bg-white/90 px-4 text-center text-xs">
            {mapError}
          </div>
        )}
        {!driver && mapReady && !mapError && (
          <div className="bg-surface/90 absolute top-2 left-1/2 -translate-x-1/2 rounded-full border px-3 py-1 text-xs">
            {t("waitingDriverPosition")}
          </div>
        )}
      </div>

      {/* barre : livreur + en direct + distance/ETA + appel */}
      <div className="flex items-center justify-between gap-2 px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="bg-primary-50 text-primary-700 grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-extrabold">
            {initial}
          </span>
          <div className="min-w-0">
            <p className="text-foreground flex items-center gap-1.5 text-[13px] leading-tight font-bold">
              <span className="truncate">{name}</span>
              {!arrived && (
                <span className="text-success-700 inline-flex shrink-0 items-center gap-1 text-[11px] font-bold">
                  <span className="bg-success-500 size-1.5 animate-pulse rounded-full" />
                  {t("live")}
                </span>
              )}
            </p>
            <p className="text-muted truncate text-[11px] font-semibold">
              {subline}
            </p>
          </div>
        </div>
        {driverPhone && (
          <a
            href={`tel:${driverPhone}`}
            aria-label={t("callName", { name })}
            className="bg-success-50 text-success-700 hover:bg-success-100 grid size-9 shrink-0 place-items-center rounded-[11px] transition-colors"
          >
            <Phone className="size-4" />
          </a>
        )}
      </div>
    </div>
  );
}
