"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { CheckCircle2, Clock, Loader2, MapPin, Truck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { haversineKm } from "@/lib/delivery/distance";
import { useRoute } from "@/lib/delivery/use-route";

/**
 * Carte de suivi LIVE côté CLIENT : montre la position du livreur (mise à
 * jour en temps réel via Realtime sur la ligne `orders`) qui se rapproche du
 * point de livraison, le long des rues (itinéraire OSRM), + un ETA. Façon
 * UberEats/Yassir.
 *
 * - On s'abonne à l'UPDATE de SA commande : le payload contient
 *   driver_live_lat/lng/at + delivery_arrived_at → on déplace le marqueur et
 *   on bascule l'état « arrivé » sans recharger la page.
 * - ETA = durée de conduite réelle (OSRM) ; repli distance / 18 km/h.
 */

type LatLng = { lat: number; lng: number };

// Seuil « arrive bientôt / à ta porte » (km).
const NEAR_KM = 0.3;

function buildStyle() {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (key) return `https://api.maptiler.com/maps/streets/style.json?key=${key}`;
  return "https://tiles.openfreemap.org/styles/liberty";
}

export function CustomerDeliveryMap({
  orderId,
  destination,
  initialDriver,
  initialArrivedAt = null,
  height = 240,
}: {
  orderId: string;
  destination: LatLng;
  initialDriver: (LatLng & { at: string | null }) | null;
  initialArrivedAt?: string | null;
  height?: number;
}) {
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
            style: buildStyle() as never,
            center: [destination.lng, destination.lat],
            zoom: 14,
            attributionControl: { compact: true },
          });
        } catch (err) {
          setMapError(
            "Carte indisponible : " +
              (err instanceof Error ? err.message : String(err))
          );
          return;
        }
        mapRef.current = map;

        // Marqueur destination (maison du client).
        const destEl = document.createElement("div");
        destEl.innerHTML =
          '<div style="background:#16a34a;color:#fff;width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);">🏠</div>';
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
            "Carte indisponible : " +
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
          '<div style="background:#5c5ce0;color:#fff;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font-size:14px;">🛵</div>';
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
        map.fitBounds(bounds, { padding: 60, duration: 700, maxZoom: 15 });
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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-foreground inline-flex items-center gap-1.5 text-sm font-semibold">
          <Truck className="text-primary-600 size-4" />
          Suivi du livreur en direct
        </p>
        {arrived ? (
          <span className="bg-success-600 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-white">
            <CheckCircle2 className="size-3.5" />
            Livreur arrivé
          </span>
        ) : near ? (
          <span className="bg-success-600 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-white">
            Arrive — à ta porte
          </span>
        ) : etaMin != null ? (
          <span className="bg-primary-600 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-white">
            <Clock className="size-3.5" />
            Arrive dans ~{etaMin} min
          </span>
        ) : null}
      </div>

      <div
        className="bg-surface-2 relative w-full overflow-hidden rounded-[12px]"
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
            Chargement de la carte…
          </div>
        )}
        {mapError && (
          <div className="text-danger-700 pointer-events-none absolute inset-0 flex items-center justify-center bg-white/90 px-4 text-center text-xs">
            {mapError}
          </div>
        )}
        {distanceKm != null && (
          <div className="bg-primary-600/95 absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white">
            <MapPin className="size-3" />
            {distanceKm.toFixed(1)} km
          </div>
        )}
        {!driver && mapReady && (
          <div className="bg-surface/90 absolute top-2 left-1/2 -translate-x-1/2 rounded-full border px-3 py-1 text-xs">
            En attente de la position du livreur…
          </div>
        )}
      </div>
    </div>
  );
}
