"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { Crosshair, Loader2, MapPin } from "lucide-react";
import { getPosition } from "@/lib/native/geolocation";
import { toast } from "@/components/ui/toast";

/**
 * Sélecteur de position sur carte — réutilisable client + commerçant.
 *
 * UX : le marqueur reste au CENTRE du viewport (overlay fixe). L'utilisateur
 * peut soit déplacer la carte, soit TAPER directement sur le point qu'il
 * veut (la carte recentre dessus avec animation). Bouton « Ma position GPS »
 * pour recentrer rapidement sur sa position réelle.
 *
 * Source tuiles : MapTiler si NEXT_PUBLIC_MAPTILER_KEY défini, sinon
 * OpenFreeMap (fallback gratuit sans clé).
 */

type LatLng = { lat: number; lng: number };

const DEFAULT_CENTER: LatLng = { lat: 36.7538, lng: 3.0588 }; // Alger

function buildStyle() {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (key) {
    return `https://api.maptiler.com/maps/streets/style.json?key=${key}`;
  }
  return "https://tiles.openfreemap.org/styles/liberty";
}

export type MapPositionPickerProps = {
  initial?: LatLng | null;
  defaultCenter?: LatLng;
  onChange: (pos: LatLng) => void;
  /**
   * Hauteur de la carte (px ou string CSS). Défaut : 280.
   * Note : on évite les classes Tailwind dynamiques (h-[XYZpx]) qui peuvent
   * être purgées si elles ne sont pas écrites en littéral dans le source —
   * un `style={{ height }}` inline est toujours appliqué.
   */
  height?: number | string;
  /** Texte du bouton GPS. */
  gpsLabel?: string;
  /**
   * Si true, tente d'obtenir automatiquement la position GPS ACTUELLE dès que
   * la carte est prête (sans clic) pour centrer dessus. Utile au checkout :
   * « par défaut = ma position actuelle exacte ». Si la permission est
   * refusée/indispo, on reste sur `initial`/`defaultCenter` sans bloquer.
   */
  autoLocate?: boolean;
  /**
   * Cible de recentrage IMPÉRATIF : à chaque fois que cet objet change
   * d'identité, la carte vole vers ce point (ex. centre de la commune choisie).
   * `null`/undefined = aucun recentrage.
   */
  focusTarget?: (LatLng & { zoom?: number }) | null;
};

export function MapPositionPicker({
  initial,
  defaultCenter,
  onChange,
  height = 280,
  gpsLabel = "Ma position",
  autoLocate = false,
  focusTarget = null,
}: MapPositionPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const [loading, setLoading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  // onChange peut changer entre renders (closure différente). On le passe via
  // ref pour que les handlers MapLibre (attachés une seule fois) appellent
  // toujours la dernière version.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const start = initial ?? defaultCenter ?? DEFAULT_CENTER;

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    // Test WebGL d'abord : sur certains Android/PWA, WebGL est désactivé.
    // MapLibre throw un message peu clair, on préfère un message explicite.
    const probe = document.createElement("canvas");
    const gl =
      probe.getContext("webgl2") ||
      probe.getContext("webgl") ||
      probe.getContext("experimental-webgl");
    if (!gl) {
      setMapError(
        "Ton navigateur ne supporte pas WebGL — impossible d'afficher la carte. Active l'accélération matérielle ou utilise un autre navigateur."
      );
      return;
    }

    let triedFallback = false;

    const init = (styleUrl: string) => {
      if (disposed || !containerRef.current) return;

      void import("maplibre-gl")
        .then(({ Map }) => {
          if (disposed || !containerRef.current) return;

          let map: import("maplibre-gl").Map;
          try {
            map = new Map({
              container: containerRef.current,
              style: styleUrl as never,
              center: [start.lng, start.lat],
              zoom: initial ? 16 : 14,
              attributionControl: { compact: true },
            });
          } catch (err) {
            setMapError(
              "Échec init carte : " +
                (err instanceof Error ? err.message : String(err))
            );
            return;
          }
          mapRef.current = map;

          map.dragPan.enable();
          map.scrollZoom.enable();
          map.touchZoomRotate.enable();
          map.doubleClickZoom.enable();
          map.keyboard.enable();

          // Suit la première arrivée de données de style. Sert à décider si une
          // erreur ultérieure est fatale (style jamais chargé) ou bénigne
          // (tuile/glyphe isolé qui échoue alors que la carte fonctionne déjà).
          let styleArrived = false;
          map.on("styledata", () => {
            styleArrived = true;
          });

          // Gestion d'erreur. IMPORTANT : on NE détruit PAS la carte sur une
          // simple erreur de tuile/sprite/glyphe — sinon une carte
          // parfaitement fonctionnelle est rasée pour un POI manquant. On ne
          // bascule sur le fallback OpenFreeMap QUE si le style lui-même n'a
          // jamais réussi à charger (échec réseau/clé sur MapTiler).
          map.on("error", (e) => {
            const msg = e?.error?.message ?? "Erreur carte inconnue";
            const styleFailed = !styleArrived;
            if (
              styleFailed &&
              !triedFallback &&
              styleUrl.includes("maptiler.com")
            ) {
              triedFallback = true;
              try {
                map.remove();
              } catch {}
              mapRef.current = null;
              init("https://tiles.openfreemap.org/styles/liberty");
              return;
            }
            // Erreur non fatale (tuile/glyphe) une fois le style chargé : on
            // log seulement, la carte reste utilisable.
            if (!styleArrived) setMapError("Erreur carte : " + msg);
          });

          const emit = () => {
            const c = map.getCenter();
            onChangeRef.current({ lat: c.lat, lng: c.lng });
          };
          // moveend = fin de drag/zoom/flyTo. Source unique de vérité pour
          // l'émission de coordonnées (évite les doubles emits).
          map.on("moveend", emit);

          // Clic / tap : recentre la carte sur le point cliqué. moveend
          // s'occupera de l'émission une fois l'animation terminée.
          map.on("click", (e) => {
            map.flyTo({
              center: [e.lngLat.lng, e.lngLat.lat],
              zoom: Math.max(map.getZoom(), 16),
              duration: 350,
            });
          });

          // On NE bloque PAS l'affichage sur l'évènement `load` : en prod, avec
          // la contention réseau de la home, une seule tuile/police qui traîne
          // peut empêcher `load`/`isStyleLoaded` de passer à true pendant très
          // longtemps → la carte restait masquée par l'overlay « Chargement… »
          // indéfiniment. MapLibre peint les tuiles disponibles au fur et à
          // mesure : dès que le style est arrivé OU au plus tard après un court
          // délai, on révèle la carte. Premier signal gagnant.
          let revealed = false;
          let autoLocated = false;
          const reveal = () => {
            if (revealed || disposed) return;
            revealed = true;
            setMapReady(true);
            setMapError(null);
            emit();
            // Position ACTUELLE par défaut : si demandé et qu'aucune position
            // explicite n'a été fournie, on récupère le GPS et on recentre
            // dessus une seule fois. Échec silencieux (permission refusée…) :
            // on garde le centre par défaut.
            if (autoLocate && !initial && !autoLocated) {
              autoLocated = true;
              setLoading(true);
              getPosition()
                .then((pos) => {
                  if (disposed) return;
                  map.flyTo({
                    center: [pos.longitude, pos.latitude],
                    zoom: 17,
                    duration: 700,
                  });
                  timers.push(
                    setTimeout(() => {
                      if (!disposed)
                        onChangeRef.current({
                          lat: pos.latitude,
                          lng: pos.longitude,
                        });
                    }, 800)
                  );
                })
                .catch(() => {
                  /* GPS indispo/refusé : on reste sur le centre par défaut */
                })
                .finally(() => {
                  if (!disposed) setLoading(false);
                });
            }
          };
          map.once("load", reveal);
          map.once("idle", reveal);
          map.once("styledata", () => {
            // Style parsé → la carte peut commencer à peindre. On laisse une
            // poignée de ms pour le premier rendu puis on révèle.
            timers.push(setTimeout(reveal, 400));
          });
          // Garde-fou ultime : quoi qu'il arrive, on révèle après 2,5 s pour ne
          // jamais laisser l'utilisateur bloqué sur le spinner.
          timers.push(setTimeout(reveal, 2500));

          // Plusieurs resize : MapLibre a besoin que le conteneur ait sa
          // taille finale, qui peut être délayée par layout shift / modal
          // fade-in / safe-area.
          timers.push(setTimeout(() => map.resize(), 100));
          timers.push(setTimeout(() => map.resize(), 500));
          timers.push(setTimeout(() => map.resize(), 1500));
        })
        .catch((err) => {
          if (!disposed) {
            setMapError(
              "Carte indisponible : " +
                (err instanceof Error ? err.message : String(err))
            );
          }
        });
    };

    init(buildStyle());

    return () => {
      disposed = true;
      timers.forEach(clearTimeout);
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recentrage impératif quand `focusTarget` change (commune choisie…). On vole
  // vers le point ; `moveend` émettra les nouvelles coordonnées du centre.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusTarget || !mapReady) return;
    map.flyTo({
      center: [focusTarget.lng, focusTarget.lat],
      zoom: focusTarget.zoom ?? 14,
      duration: 800,
    });
     
  }, [focusTarget, mapReady]);

  const useGps = async () => {
    setLoading(true);
    try {
      const pos = await getPosition();
      const map = mapRef.current;
      if (map) {
        map.flyTo({
          center: [pos.longitude, pos.latitude],
          zoom: 17,
          duration: 700,
        });
        // Fallback : si moveend n'arrive pas (animation interrompue, carte
        // déjà au point), on émet directement après un délai.
        setTimeout(() => {
          onChangeRef.current({ lat: pos.latitude, lng: pos.longitude });
        }, 800);
      } else {
        onChangeRef.current({ lat: pos.latitude, lng: pos.longitude });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Géoloc indisponible");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="bg-surface-2 relative w-full overflow-hidden rounded-[12px]"
      style={{ height: typeof height === "number" ? `${height}px` : height }}
    >
      {/* La classe `maplibregl-map` injectée par MapLibre force
          position:relative, ce qui annule un `absolute inset-0`. On utilise
          donc `h-full w-full` pour que le conteneur garde toujours la taille
          de son parent — sans ça, le canvas-container collapsait à 0
          (visible mais clics ignorés). */}
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ touchAction: "none" }}
      />

      {/* État de chargement / erreur — pointer-events-none CRITIQUE :
          sans ça l'overlay bloque tous les drags / clics sur la carte si
          mapReady ne devient pas true assez vite. */}
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

      {/* Marqueur central fixe (overlay HTML). pointer-events-none pour
          laisser passer les clics → carte. */}
      {mapReady && (
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full">
          <MapPin
            className="text-primary-700 size-9 drop-shadow-md"
            fill="currentColor"
          />
        </div>
      )}

      {/* Indice d'usage — discret en haut, disparait après interaction. */}
      {mapReady && (
        <div className="bg-foreground/75 pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-full px-2.5 py-1 text-[10px] font-medium text-white">
          Tape ou glisse pour ajuster
        </div>
      )}

      <button
        type="button"
        onClick={useGps}
        disabled={loading || !mapReady}
        className="bg-surface border-border absolute right-2 bottom-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Crosshair className="size-3.5" />
        )}
        {gpsLabel}
      </button>
    </div>
  );
}
