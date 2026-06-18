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

// Façonnage RTL (arabe) : sans ce plugin, MapLibre affiche les libellés
// arabes inversés et avec des lettres détachées. Chargé une seule fois,
// en lazy (uniquement si la carte contient du texte RTL).
let rtlReady = false;
function ensureRtlPlugin(maplibre: typeof import("maplibre-gl")) {
  if (rtlReady) return;
  rtlReady = true;
  try {
    void maplibre.setRTLTextPlugin(
      "https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.js",
      true
    );
  } catch {
    /* déjà chargé par une autre carte */
  }
}

// Cache module du STYLE carte (JSON OpenFreeMap) : récupéré et parsé UNE seule
// fois par variante (clair/sombre) pour toute la session → les cartes suivantes
// (re)démarrent sans refetch ni reparse, ce qui réduit nettement le temps avant
// affichage à chaque (re)montage de DriveMap. Chaque instance reçoit un CLONE
// (MapLibre mute le style en interne). Repli silencieux sur l'URL si l'échec.
const styleCache: Record<string, Promise<unknown | null>> = {};
function cloneStyle(o: unknown): unknown {
  return typeof structuredClone === "function"
    ? structuredClone(o)
    : JSON.parse(JSON.stringify(o));
}
function loadMapStyle(url: string): Promise<unknown | null> {
  if (!styleCache[url]) {
    styleCache[url] = fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return styleCache[url].then((s) => (s ? cloneStyle(s) : null));
}

export type LatLng = { lat: number; lng: number };

type Marker = { id: string; pos: LatLng; kind: "me" | "car" | "pin" };

export function DriveMap({
  markers,
  route,
  approach,
  heatZones,
  interactive = false,
  onMove,
  focusTarget = null,
  follow = false,
  className,
  padding = { top: 120, bottom: 340, left: 40, right: 40 },
}: {
  markers: Marker[];
  /** Tracé course (violet plein) : liste de points [départ → arrivée]. */
  route?: LatLng[] | null;
  /** Tracé approche (gris pointillé) : voiture → client. */
  approach?: LatLng[] | null;
  /** Halos violets « zones de forte demande » (accueil chauffeur). */
  heatZones?: { lat: number; lng: number; count: number }[] | null;
  /** true = carte déplaçable (écran de choix du point). */
  interactive?: boolean;
  /** Émis à chaque fin de déplacement (centre courant). */
  onMove?: (center: LatLng) => void;
  /**
   * Recentrage IMPÉRATIF (recherche d'adresse) : à chaque changement
   * d'identité, la carte vole vers ce point — l'épingle centrale se
   * retrouve EXACTEMENT dessus, `moveend` émet la position.
   */
  focusTarget?: (LatLng & { zoom?: number }) | null;
  /**
   * Suivi de position (accueil chauffeur/livreur) : quand un SEUL marqueur est
   * affiché (« moi »), la carte se centre dessus au 1er fix puis SUIT la
   * position en douceur (`easeTo`) en conservant le zoom choisi — au lieu de
   * « sauter » (flyTo + reset zoom) à chaque relevé GPS.
   */
  follow?: boolean;
  className?: string;
  padding?: { top: number; bottom: number; left: number; right: number };
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerObjs = useRef<Map<string, maplibregl.Marker>>(new Map());
  // Vrai une fois la carte centrée sur la position pour la 1re fois (mode suivi).
  const didInitialCenter = useRef(false);
  const [ready, setReady] = useState(false);
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  // Vol vers la cible de recherche (l'épingle suit le centre de la carte).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focusTarget) return;
    map.flyTo({
      center: [focusTarget.lng, focusTarget.lat],
      zoom: focusTarget.zoom ?? 17,
      duration: 700,
    });
  }, [focusTarget, ready]);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    void import("maplibre-gl").then(async (maplibre) => {
      const { Map } = maplibre;
      ensureRtlPlugin(maplibre);
      if (disposed || !containerRef.current) return;
      const first = markers[0]?.pos ?? { lat: 36.7538, lng: 3.0588 };
      let map: maplibregl.Map;
      // Thème sombre = choix utilisateur (classe `theme-dark` posée sur
      // <html> par le layout racine) — plus de suivi du réglage système.
      const prefersDark =
        typeof document !== "undefined" &&
        document.documentElement.classList.contains("theme-dark");
      const styleUrl = prefersDark
        ? `${MAP_STYLE_URL.slice(0, MAP_STYLE_URL.lastIndexOf("/styles/"))}/styles/dark`
        : MAP_STYLE_URL;
      // Style depuis le cache module (clone) ; repli sur l'URL si indisponible.
      const cachedStyle = await loadMapStyle(styleUrl);
      if (disposed || !containerRef.current) return;
      try {
        map = new Map({
          container: containerRef.current,
          style: (cachedStyle ?? styleUrl) as never,
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
      } else {
        // Tap/clic = sélection directe : on recentre sur le point touché,
        // `moveend` émettra alors la position exacte sous l'épingle.
        map.on("click", (e) => {
          map.flyTo({
            center: [e.lngLat.lng, e.lngLat.lat],
            zoom: Math.max(map.getZoom(), 16),
            duration: 350,
          });
        });
      }
      map.on("moveend", () => {
        const c = map.getCenter();
        onMoveRef.current?.({ lat: c.lat, lng: c.lng });
      });
      const reveal = () => {
        if (disposed) return;
        setReady(true);
        // En mode interactif, émettre la position initiale tout de suite
        // (sinon l'écran reste sur « Déplacez la carte… » avant le 1er drag).
        if (interactive) {
          const c = map.getCenter();
          onMoveRef.current?.({ lat: c.lat, lng: c.lng });
        }
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

  // Halos de demande (heatmap accueil chauffeur) — marqueurs HTML dédiés.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    void import("maplibre-gl").then(({ Marker: Mk }) => {
      // Purge les anciens halos puis pose les nouveaux.
      markerObjs.current.forEach((mk, id) => {
        if (id.startsWith("heat-")) {
          mk.remove();
          markerObjs.current.delete(id);
        }
      });
      (heatZones ?? []).forEach((z, i) => {
        const size = Math.min(170, 90 + z.count * 22);
        const el = document.createElement("div");
        el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;pointer-events:none;background:radial-gradient(circle,rgba(91,91,230,.4),rgba(91,91,230,.16) 55%,transparent 72%)`;
        const mk = new Mk({ element: el, anchor: "center" })
          .setLngLat([z.lng, z.lat])
          .addTo(map);
        markerObjs.current.set(`heat-${i}`, mk);
      });
    });
  }, [heatZones, ready]);

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
            '<div style="width:20px;height:20px;border-radius:50%;background:#6C2BD9;border:4px solid #fff;box-shadow:0 0 0 6px rgba(108,43,217,.38)"></div>';
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
        if (!seen.has(id) && !id.startsWith("heat-")) {
          mk.remove();
          markerObjs.current.delete(id);
        }
      });
    });
  }, [markers, ready]);

  // Tracés (course aux couleurs Coligo / approche grise pointillée).
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
    // Liseré blanc sous la route : contraste sur fond clair ET sombre.
    setLine("drive-route-casing", route, {
      "line-color": "#FFFFFF",
      "line-width": 10,
      "line-opacity": 0.85,
    });
    setLine("drive-route", route, { "line-color": "#6C2BD9", "line-width": 6 });
    // Pointillés animés (rose Coligo) qui « avancent » vers l'arrivée.
    setLine("drive-route-anim", route, {
      "line-color": "#FF2D7A",
      "line-width": 2.5,
      "line-dasharray": [0, 4, 3],
    });
    setLine("drive-approach", approach, {
      "line-color": "#B7BBC8",
      "line-width": 5,
      "line-dasharray": [2, 1.6],
    });
  }, [route, approach, ready]);

  // Animation du tracé : on fait défiler la séquence de pointillés d'un cran
  // à intervalle fixe (technique MapLibre standard) → le rose file de D vers A.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !route || route.length < 2) return;
    const seq: number[][] = [
      [0, 4, 3],
      [0.5, 4, 2.5],
      [1, 4, 2],
      [1.5, 4, 1.5],
      [2, 4, 1],
      [2.5, 4, 0.5],
      [3, 4, 0],
      [0, 0.5, 3, 3.5],
      [0, 1, 3, 3],
      [0, 1.5, 3, 2.5],
      [0, 2, 3, 2],
      [0, 2.5, 3, 1.5],
      [0, 3, 3, 1],
      [0, 3.5, 3, 0.5],
    ];
    let step = 0;
    const timer = setInterval(() => {
      step = (step + 1) % seq.length;
      try {
        if (map.getLayer("drive-route-anim")) {
          map.setPaintProperty("drive-route-anim", "line-dasharray", seq[step]);
        }
      } catch {
        /* style en cours de rechargement */
      }
    }, 80);
    return () => clearInterval(timer);
  }, [route, ready]);

  // Cadrage automatique sur l'ensemble des points. La bbox du tracé fait
  // partie de la clé : quand la vraie route (OSRM) remplace la ligne droite,
  // la carte se recadre (dézoome) pour montrer le trajet complet D → A.
  const fitKey = JSON.stringify([
    markers.map((m) => [m.pos.lat.toFixed(4), m.pos.lng.toFixed(4)]),
    route && route.length > 0
      ? [
          Math.min(...route.map((p) => p.lat)).toFixed(3),
          Math.min(...route.map((p) => p.lng)).toFixed(3),
          Math.max(...route.map((p) => p.lat)).toFixed(3),
          Math.max(...route.map((p) => p.lng)).toFixed(3),
        ]
      : null,
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
      const only = pts[0];
      // Mode suivi : après le 1er centrage, on PANNE doucement vers la nouvelle
      // position sans toucher au zoom (la carte « colle » au chauffeur).
      if (follow && didInitialCenter.current) {
        map.easeTo({ center: [only.lng, only.lat], duration: 600 });
      } else {
        map.flyTo({
          center: [only.lng, only.lat],
          zoom: follow ? 16 : 15,
          duration: 600,
        });
        didInitialCenter.current = true;
      }
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
