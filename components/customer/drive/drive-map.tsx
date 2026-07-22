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

// Thème courant (classe `theme-dark` posée sur <html> par le theme-switcher) +
// URL du style carte correspondant (clair / sombre OpenFreeMap).
function isDarkTheme(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("theme-dark")
  );
}
function mapStyleUrl(dark: boolean): string {
  // OpenFreeMap n'a PAS de style « dark » (un fond noir rendrait routes et
  // trajets illisibles, et `/styles/dark` n'existe pas → carte noire). En mode
  // sombre on bascule donc sur `positron` : fond GRIS CLAIR épuré où routes et
  // trajets restent parfaitement visibles (on ne se perd pas). En clair :
  // `liberty` (POI/commerces).
  return dark
    ? `${MAP_STYLE_URL.slice(0, MAP_STYLE_URL.lastIndexOf("/styles/"))}/styles/positron`
    : MAP_STYLE_URL;
}

// Caméra persistante (mode SUIVI = accueil chauffeur/livreur) : on mémorise le
// dernier centre + zoom pour ROUVRIR la carte exactement à cette vue après une
// navigation, SANS rejouer l'animation de zoom à chaque changement de page.
// Scopé à `follow` pour ne pas affecter les cartes route/sélection (client).
let lastFollowCam: { lng: number; lat: number; zoom: number } | null = null;

// Keep-alive (accueil chauffeur) : on CONSERVE l'instance MapLibre + son canvas
// WebGL d'une visite à l'autre, dans un conteneur détachable réattaché au
// montage. Évite de détruire/recréer le contexte WebGL (coûteux ~0,5-1 s) à
// chaque retour sur l'accueil. Scopé aux cartes `keepAlive` (une seule à la fois
// par session : l'accueil chauffeur), donc sans effet sur les cartes client.
let keptMap: maplibregl.Map | null = null;
let keptContainer: HTMLDivElement | null = null;
// Thème (clair/sombre) du style actuellement chargé dans la carte conservée :
// permet de re-styler au retour sur l'accueil si le thème a changé entre-temps.
let keptDark = false;
// Callback `onMove` courant pour la carte conservée (le handler `moveend` est
// lié une seule fois → on passe par cette réf mutable pour ne pas appeler un
// callback périmé après un remontage).
const keptOnMove: {
  current: ((c: { lat: number; lng: number }) => void) | undefined;
} = {
  current: undefined,
};

export type LatLng = { lat: number; lng: number };

/**
 * Sprite du véhicule. Les fichiers sont normalisés NEZ VERS LE HAUT par
 * `scripts/drive-vehicle-sprites.mjs` : la carte applique donc `rotate(cap)`
 * directement. Violet sur fond clair, blanc sur fond sombre — sinon le
 * véhicule violet se perd dans le fond gris du style « positron ».
 */
function vehicleSprite(kind: "car" | "moto", dark: boolean): string {
  const base = kind === "moto" ? "moto-coligo" : "voiture-coligo";
  return `/drive/vehicles/${base}-${dark ? "white" : "violet"}.png`;
}

/** État d'animation d'un véhicule (glissement + rotation entre deux relevés). */
type VehicleAnim = {
  marker: maplibregl.Marker;
  inner: HTMLElement | null;
  fromLat: number;
  fromLng: number;
  fromBearing: number;
  toLat: number;
  toLng: number;
  toBearing: number;
  curLat: number;
  curLng: number;
  curBearing: number;
  start: number;
};

type Marker = {
  id: string;
  pos: LatLng;
  kind: "me" | "car" | "pin";
  /** Étiquette A (départ) / B (arrivée) — affichée sur l'épingle pour bien
   *  comprendre le trajet sur la carte. */
  label?: "A" | "B";
  /** kind "me" seulement : vagues RADAR (partenaire EN LIGNE en attente de
   *  demandes, style Bolt) — rassure : la recherche est active. */
  radar?: boolean;
};

/** Véhicule disponible affiché sur la carte (sprite orienté + phares). */
export type MapVehicleMarker = {
  /** Jeton pseudonyme du jour (mig 0400) — sert d'identité de marqueur. */
  token: string;
  lat: number;
  lng: number;
  /** Cap en degrés, 0 = nord, sens horaire. */
  bearing: number;
  kind: "car" | "moto";
};

export function DriveMap({
  markers,
  vehicles,
  route,
  approach,
  heatZones,
  interactive = false,
  onMove,
  focusTarget = null,
  follow = false,
  className,
  padding = { top: 120, bottom: 340, left: 40, right: 40 },
  keepAlive = false,
  fallbackCenter,
}: {
  markers: Marker[];
  /**
   * Véhicules disponibles autour du client (façon Uber/Bolt) : sprite vu du
   * dessus, ORIENTÉ selon le cap, avec un faisceau de phares qui montre le sens
   * de circulation. Ils glissent d'un relevé à l'autre au lieu de sauter.
   */
  vehicles?: MapVehicleMarker[] | null;
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
  /**
   * Conserve l'instance MapLibre entre les montages (accueil chauffeur) : le
   * canvas WebGL n'est pas recréé au retour sur la page → affichage immédiat.
   */
  keepAlive?: boolean;
  /**
   * Centre de SECOURS de la caméra quand aucun marqueur n'est encore disponible
   * (ex. accueil chauffeur avant le 1er fix GPS) : évite de tomber sur Alger par
   * défaut. Idéalement la dernière position connue côté serveur (présence).
   */
  fallbackCenter?: LatLng | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerObjs = useRef<Map<string, maplibregl.Marker>>(new Map());
  // Animations des véhicules à proximité, indexées par jeton du jour.
  const vehicleAnim = useRef<Map<string, VehicleAnim>>(new Map());
  // Vrai une fois la carte centrée pour la 1re fois (mode suivi). Si une caméra
  // de suivi est déjà mémorisée, on considère le centrage « déjà fait » → on
  // PANNE doucement vers la position sans rejouer l'animation de zoom.
  const didInitialCenter = useRef(follow && lastFollowCam != null);
  const [ready, setReady] = useState(false);
  // Incrémenté après un changement de style (bascule de thème) → force la
  // re-création des couches (route/approche) qu'un setStyle efface.
  const [styleVersion, setStyleVersion] = useState(0);
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  // Vol vers la cible de recherche / recentrage. `padding` décale le centre
  // visuel pour que le point ne soit PAS caché par la feuille du bas (sinon il
  // tombe au centre géométrique de l'écran, sous la carte/feuille).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focusTarget) return;
    map.flyTo({
      center: [focusTarget.lng, focusTarget.lat],
      zoom: focusTarget.zoom ?? 17,
      padding,
      duration: 700,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget, ready]);

  // Garde `keptOnMove` à jour pour la carte conservée (accueil chauffeur).
  useEffect(() => {
    if (keepAlive) keptOnMove.current = onMove;
  }, [keepAlive, onMove]);

  // Bascule LIVE clair ↔ sombre : observe la classe `theme-dark` de <html> et
  // recharge le style (clair/sombre) de la carte sans la recréer. Les couches
  // route/approche (effacées par setStyle) sont re-créées via `styleVersion`.
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    let curDark = isDarkTheme();
    const obs = new MutationObserver(() => {
      const d = isDarkTheme();
      if (d === curDark) return;
      curDark = d;
      const m = mapRef.current;
      if (!m) return;
      void loadMapStyle(mapStyleUrl(d)).then((s) => {
        if (!mapRef.current) return;
        try {
          m.setStyle((s ?? mapStyleUrl(d)) as never);
        } catch {
          return;
        }
        if (keepAlive) keptDark = d;
        m.once("styledata", () => setStyleVersion((v) => v + 1));
      });
    });
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, [keepAlive]);

  useEffect(() => {
    const wrapper = containerRef.current;
    if (!wrapper) return;
    let disposed = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    // ── Réutilisation keep-alive : on ré-attache l'instance conservée ──────
    if (keepAlive && keptMap && keptContainer) {
      wrapper.appendChild(keptContainer);
      mapRef.current = keptMap;
      setReady(true);
      timers.push(setTimeout(() => keptMap?.resize(), 60));
      timers.push(setTimeout(() => keptMap?.resize(), 300));
      // Le thème a-t-il changé pendant qu'on était ailleurs ? Re-style si besoin.
      if (isDarkTheme() !== keptDark) {
        const d = isDarkTheme();
        void loadMapStyle(mapStyleUrl(d)).then((s) => {
          const m = mapRef.current ?? keptMap;
          if (!m) return;
          try {
            m.setStyle((s ?? mapStyleUrl(d)) as never);
            keptDark = d;
            m.once("styledata", () => setStyleVersion((v) => v + 1));
          } catch {
            /* style indispo */
          }
        });
      }
      return () => {
        disposed = true;
        timers.forEach(clearTimeout);
        markerObjs.current.forEach((m) => m.remove());
        markerObjs.current.clear();
        // Les véhicules vivent dans une table à part : si on ne la vide pas
        // ici, leurs marqueurs sont retirés de la carte mais considérés comme
        // « déjà présents » au relevé suivant → ils ne réapparaissent JAMAIS
        // (bug vécu : véhicules visibles une fois sur deux selon le moment où
        // le style de carte finit de charger).
        vehicleAnim.current.clear();
        // Détache SANS détruire (la carte survit pour la prochaine visite).
        if (keptContainer && keptContainer.parentNode === wrapper) {
          wrapper.removeChild(keptContainer);
        }
        mapRef.current = null;
      };
    }

    void import("maplibre-gl").then(async (maplibre) => {
      const { Map } = maplibre;
      ensureRtlPlugin(maplibre);
      if (disposed || !containerRef.current) return;
      // Conteneur de la carte : pour le keep-alive on crée un enfant DÉTACHABLE
      // (conservé entre les visites) ; sinon on utilise directement le wrapper.
      let target: HTMLElement = containerRef.current;
      if (keepAlive) {
        const el = document.createElement("div");
        el.style.height = "100%";
        el.style.width = "100%";
        containerRef.current.appendChild(el);
        target = el;
        keptContainer = el;
      }
      const first = markers[0]?.pos ??
        fallbackCenter ?? { lat: 36.7538, lng: 3.0588 };
      // Vue initiale : caméra de suivi mémorisée (pas de re-zoom au retour) ou
      // 1er marqueur à un zoom par défaut.
      const restore = follow ? lastFollowCam : null;
      const initCenter: [number, number] = restore
        ? [restore.lng, restore.lat]
        : [first.lng, first.lat];
      const initZoom = restore ? restore.zoom : 14;
      let map: maplibregl.Map;
      // Thème sombre = choix utilisateur (classe `theme-dark` sur <html>).
      const dark = isDarkTheme();
      const styleUrl = mapStyleUrl(dark);
      // Style depuis le cache module (clone) ; repli sur l'URL si indisponible.
      const cachedStyle = await loadMapStyle(styleUrl);
      if (disposed || !containerRef.current) return;
      try {
        map = new Map({
          container: target,
          style: (cachedStyle ?? styleUrl) as never,
          center: initCenter,
          zoom: initZoom,
          attributionControl: { compact: true },
        });
      } catch {
        return;
      }
      mapRef.current = map;
      if (keepAlive) {
        keptMap = map;
        keptDark = dark;
      }
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
        // Mémorise la vue de SUIVI (centre + zoom) pour la restaurer sans
        // re-zoom à la prochaine navigation.
        if (follow) {
          lastFollowCam = { lng: c.lng, lat: c.lat, zoom: map.getZoom() };
        }
        // Carte conservée : passer par la réf mutable (le handler est lié une
        // seule fois mais le composant se remonte avec un nouveau `onMove`).
        (keepAlive ? keptOnMove.current : onMoveRef.current)?.({
          lat: c.lat,
          lng: c.lng,
        });
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
      // Les véhicules vivent dans une table à part : si on ne la vide pas
      // ici, leurs marqueurs sont retirés de la carte mais considérés comme
      // « déjà présents » au relevé suivant → ils ne réapparaissent JAMAIS
      // (bug vécu : véhicules visibles une fois sur deux selon le moment où
      // le style de carte finit de charger).
      vehicleAnim.current.clear();
      if (keepAlive) {
        // Détache le conteneur conservé sans détruire la carte (réutilisée à la
        // prochaine visite). Si la création n'a pas encore eu lieu, rien à faire.
        if (keptContainer && keptContainer.parentNode) {
          keptContainer.parentNode.removeChild(keptContainer);
        }
        mapRef.current = null;
      } else {
        mapRef.current?.remove();
        mapRef.current = null;
      }
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
      const setRadar = (host: HTMLElement, on: boolean) => {
        const r = host.querySelector<HTMLElement>("[data-radar]");
        if (r) r.style.display = on ? "block" : "none";
      };
      for (const m of markers) {
        seen.add(m.id);
        const existing = markerObjs.current.get(m.id);
        if (existing) {
          existing.setLngLat([m.pos.lng, m.pos.lat]);
          // Vagues radar togglées SANS recréer le marqueur (l'élément vit).
          if (m.kind === "me") setRadar(existing.getElement(), !!m.radar);
          continue;
        }
        const el = document.createElement("div");
        if (m.label) {
          // Épingle étiquetée A (départ, violet) / B (arrivée, rose) : goutte +
          // lettre blanche → le client/chauffeur lit le trajet d'un coup d'œil.
          const color = m.label === "A" ? "#6C2BD9" : "#FF2D7A";
          el.innerHTML =
            '<div style="width:30px;height:30px;border-radius:50% 50% 50% 4px;transform:rotate(45deg);background:' +
            color +
            ';display:flex;align-items:center;justify-content:center;border:2.5px solid #fff;box-shadow:0 6px 14px -3px rgba(0,0,0,.45)"><span style="transform:rotate(-45deg);color:#fff;font-weight:800;font-size:14px;line-height:1;font-family:system-ui,-apple-system,sans-serif">' +
            m.label +
            "</span></div>";
        } else if (m.kind === "me") {
          // Point « moi » IDENTIQUE à avant ; les vagues radar (3 ondes
          // décalées, montrées quand m.radar) vivent DANS le point lui-même
          // (position:relative) → même centre garanti. ⚠️ Ne JAMAIS poser de
          // style de position sur `el` : il écraserait le position:absolute
          // de .maplibregl-marker → l'élément passe en flux, prend toute la
          // largeur de la carte et les ondes à left:50% partent au milieu de
          // l'écran (bug vécu). z-index:-1 : l'onde passe SOUS le remplissage
          // du point (le point ne crée pas de contexte d'empilement).
          const wave = (delay: string) =>
            `<div style="position:absolute;left:50%;top:50%;z-index:-1;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(108,43,217,.28);animation:me-radar-wave 2.4s ease-out ${delay} infinite"></div>`;
          el.innerHTML =
            '<div style="position:relative;width:20px;height:20px;border-radius:50%;background:#6C2BD9;border:4px solid #fff;box-shadow:0 0 0 6px rgba(108,43,217,.38)">' +
            `<div data-radar style="display:${m.radar ? "block" : "none"}">` +
            wave("0s") +
            wave(".8s") +
            wave("1.6s") +
            "</div></div>";
        } else if (m.kind === "car") {
          el.innerHTML =
            '<div style="width:38px;height:38px;border-radius:50%;background:#0B0C12;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 8px 18px -4px rgba(0,0,0,.4)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14l-1.5-5.5a2 2 0 0 0-1.9-1.5H8.4a2 2 0 0 0-1.9 1.5L5 17Z"/><circle cx="7.5" cy="18.5" r="1.5"/><circle cx="16.5" cy="18.5" r="1.5"/></svg></div>';
        } else {
          el.innerHTML =
            '<div style="width:28px;height:28px;border-radius:50% 50% 50% 4px;transform:rotate(45deg);background:#0B0C12;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 14px -3px rgba(0,0,0,.4)"><svg width="14" height="14" viewBox="0 0 24 24" style="transform:rotate(-45deg)" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="2.5"/></svg></div>';
        }
        const mk = new Mk({
          element: el,
          anchor: m.label || m.kind === "pin" ? "bottom" : "center",
        })
          .setLngLat([m.pos.lng, m.pos.lat])
          .addTo(map);
        markerObjs.current.set(m.id, mk);
      }
      markerObjs.current.forEach((mk, id) => {
        // Les véhicules (`veh-*`) et les halos (`heat-*`) ont leur PROPRE cycle
        // de vie : sans cette exclusion, cet effet — qui tourne à chaque
        // changement de `markers` — supprimait les véhicules aussitôt créés
        // (bug vécu : la carte appelait bien l'API mais n'affichait rien).
        if (
          !seen.has(id) &&
          !id.startsWith("heat-") &&
          !id.startsWith("veh-")
        ) {
          mk.remove();
          markerObjs.current.delete(id);
        }
      });
    });
  }, [markers, ready]);

  // ---------------------------------------------------------------------------
  // VÉHICULES DISPONIBLES — sprite orienté + phares, façon Uber/Bolt.
  //
  // Trois choix qui font la différence entre « des icônes posées » et une carte
  // vivante :
  //   - le marqueur GLISSE de l'ancienne à la nouvelle position (et tourne par
  //     le PLUS COURT chemin angulaire) au lieu de sauter à chaque relevé ;
  //   - le sprite est recyclé tant que le véhicule reste visible : on ne recrée
  //     pas un nœud DOM toutes les 7 s (sinon l'animation repart de zéro) ;
  //   - la rotation est posée sur un enfant, JAMAIS sur l'élément racine du
  //     marqueur : MapLibre y écrit sa propre `transform` de positionnement.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const list = vehicles ?? [];
    void import("maplibre-gl").then(({ Marker: Mk }) => {
      // Thème LU AU MOMENT DU RENDU : `keptDark` ne concerne que la carte
      // conservée (accueil chauffeur) — s'y fier ici donnerait le sprite violet
      // sur fond sombre. Un changement de thème recharge le style, ce qui vide
      // les marqueurs : les véhicules sont recréés avec la bonne couleur.
      const dark = isDarkTheme();
      const seen = new Set<string>();

      for (const v of list) {
        const id = `veh-${v.token}`;
        seen.add(id);
        const anim = vehicleAnim.current.get(id);
        if (anim) {
          // Nouvelle cible : on repart de la position/angle AFFICHÉS pour que
          // le mouvement reste continu même si un relevé arrive en plein vol.
          anim.fromLat = anim.curLat;
          anim.fromLng = anim.curLng;
          anim.fromBearing = anim.curBearing;
          anim.toLat = v.lat;
          anim.toLng = v.lng;
          anim.toBearing = v.bearing;
          anim.start = performance.now();
          continue;
        }

        const el = document.createElement("div");
        const sprite = vehicleSprite(v.kind, dark);
        const h = v.kind === "moto" ? 34 : 40;
        el.innerHTML =
          `<div data-veh style="position:relative;width:${h}px;height:${h}px;` +
          `display:flex;align-items:center;justify-content:center;` +
          `transform:rotate(${v.bearing}deg);will-change:transform">` +
          // Faisceau de phares : cône clair DEVANT le véhicule (haut du sprite,
          // donc toujours dans son sens de marche puisque tout tourne ensemble).
          `<div style="position:absolute;left:50%;bottom:52%;width:${h * 1.6}px;height:${h * 1.9}px;` +
          `margin-left:-${(h * 1.6) / 2}px;pointer-events:none;` +
          `clip-path:polygon(44% 100%, 56% 100%, 100% 0, 0 0);` +
          `background:linear-gradient(to top, rgba(255,236,170,${dark ? 0.72 : 0.55}) 0%, rgba(255,240,190,${dark ? 0.3 : 0.22}) 45%, rgba(255,240,190,0) 100%);` +
          `filter:blur(1.5px)"></div>` +
          `<img src="${sprite}" alt="" width="${h}" height="${h}" ` +
          `style="width:auto;height:${h}px;display:block;` +
          `filter:drop-shadow(0 4px 6px rgba(12,10,30,.38))"/>` +
          `</div>`;

        const mk = new Mk({ element: el, anchor: "center" })
          .setLngLat([v.lng, v.lat])
          .addTo(map);
        vehicleAnim.current.set(id, {
          marker: mk,
          inner: el.querySelector("[data-veh]") as HTMLElement,
          fromLat: v.lat,
          fromLng: v.lng,
          fromBearing: v.bearing,
          toLat: v.lat,
          toLng: v.lng,
          toBearing: v.bearing,
          curLat: v.lat,
          curLng: v.lng,
          curBearing: v.bearing,
          start: performance.now(),
        });
      }

      // Véhicules sortis du rayon : on retire marqueur ET animation.
      vehicleAnim.current.forEach((a, id) => {
        if (seen.has(id)) return;
        a.marker.remove();
        vehicleAnim.current.delete(id);
      });
    });
  }, [vehicles, ready]);

  // Boucle d'animation UNIQUE pour tous les véhicules (une seule rAF, pas une
  // par marqueur) — elle ne tourne que s'il y a des véhicules à animer.
  useEffect(() => {
    if (!ready || !(vehicles?.length ?? 0)) return;
    let raf = 0;
    const DURATION = 1400; // ms — durée du glissement entre deux relevés
    const loop = () => {
      const now = performance.now();
      vehicleAnim.current.forEach((a) => {
        const t = Math.min(1, (now - a.start) / DURATION);
        // Adoucissement (ease-out) : départ franc, arrivée posée.
        const k = 1 - Math.pow(1 - t, 3);
        a.curLat = a.fromLat + (a.toLat - a.fromLat) * k;
        a.curLng = a.fromLng + (a.toLng - a.fromLng) * k;
        // Rotation par le PLUS COURT arc : sans ça, passer de 350° à 10° ferait
        // faire un tour complet au véhicule.
        const delta = ((a.toBearing - a.fromBearing + 540) % 360) - 180;
        a.curBearing = a.fromBearing + delta * k;
        a.marker.setLngLat([a.curLng, a.curLat]);
        if (a.inner) {
          a.inner.style.transform = `rotate(${a.curBearing}deg)`;
        }
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ready, vehicles]);

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
    // `styleVersion` : re-crée les couches après un setStyle (bascule de thème).
  }, [route, approach, ready, styleVersion]);

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
      // `padding` décale le centre visuel : le point « moi » remonte dans la
      // zone visible AU-DESSUS de la feuille du bas (sinon il est masqué par
      // elle, au centre géométrique de l'écran).
      // Mode suivi : après le 1er centrage, on PANNE doucement vers la nouvelle
      // position sans toucher au zoom (la carte « colle » au chauffeur).
      if (follow && didInitialCenter.current) {
        map.easeTo({ center: [only.lng, only.lat], padding, duration: 600 });
      } else {
        map.flyTo({
          center: [only.lng, only.lat],
          zoom: follow ? 16.5 : 15,
          padding,
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
