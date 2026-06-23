"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Check,
  Crosshair,
  Loader2,
  MapPin,
  Maximize2,
  Search,
  Star,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getPosition } from "@/lib/native/geolocation";
import { toast } from "@/components/ui/toast";
import {
  geocodeSearch,
  listFavoritePlaces,
  recordPlacePick,
  toggleFavoritePlace,
  type FavPlace,
} from "@/app/(customer)/actions";
import { MAP_STYLE_URL } from "@/lib/config/map";
import { useGeoClientConfig } from "@/lib/geo/use-geo-client-config";

/**
 * Sélecteur de position sur carte — réutilisable client + commerçant.
 *
 * UX : le marqueur reste au CENTRE du viewport (overlay fixe). L'utilisateur
 * peut soit déplacer la carte, soit TAPER directement sur le point qu'il
 * veut (la carte recentre dessus avec animation). Bouton « Ma position GPS »
 * pour recentrer rapidement sur sa position réelle.
 *
 * Source tuiles : OpenFreeMap (gratuit, sans clé). Cf. lib/config/map.ts.
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

type LatLng = { lat: number; lng: number };

const DEFAULT_CENTER: LatLng = { lat: 36.7538, lng: 3.0588 }; // Alger

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
  /**
   * Confirmation EXPLICITE depuis le plein écran (« Confirmer ma position »).
   * Si fourni, le bouton appelle ceci au lieu de onChange → le parent peut
   * marquer la position comme confirmée sans case à cocher redondante.
   */
  onConfirm?: (pos: LatLng) => void;
  /** Affiche une barre de recherche d'adresse (forward geocoding). */
  searchEnabled?: boolean;
  /** Placeholder traduit de la barre de recherche (défaut : FR). */
  searchPlaceholder?: string;
  /**
   * Active les favoris « Tes lieux » (étoile + accès rapide) — pertinent côté
   * client (livraison), pas pour le commerçant. Défaut false.
   */
  favoritesEnabled?: boolean;
  /** Statut de la géoloc auto : true = obtenue, false = refusée/indispo. */
  onLocate?: (ok: boolean) => void;
  /**
   * Halo qui pulse + chute du pin au chargement (touche premium du checkout
   * livraison). Défaut false → marqueur statique (usage commerçant inchangé).
   */
  pulse?: boolean;
  /**
   * Classe de couleur du marqueur central (ex. "text-primary-700",
   * "text-danger-600" hors zone). Défaut : violet primaire.
   */
  markerColorClass?: string;
};

export function MapPositionPicker({
  initial,
  defaultCenter,
  onChange,
  height = 280,
  gpsLabel = "Ma position",
  autoLocate = false,
  focusTarget = null,
  onConfirm,
  searchEnabled = false,
  searchPlaceholder = "Rechercher une adresse, un lieu…",
  favoritesEnabled = false,
  onLocate,
  pulse = false,
  markerColorClass = "text-primary-700",
}: MapPositionPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const [loading, setLoading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  // Mode plein écran : la même carte passe en overlay fixe pour ajuster
  // précisément la position, puis retour au checkout.
  const [fullscreen, setFullscreen] = useState(false);
  // Court loader « Enregistrement… » à la confirmation depuis le plein écran.
  const [confirming, setConfirming] = useState(false);

  // onChange peut changer entre renders (closure différente). On le passe via
  // ref pour que les handlers MapLibre (attachés une seule fois) appellent
  // toujours la dernière version.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const onConfirmRef = useRef(onConfirm);
  useEffect(() => {
    onConfirmRef.current = onConfirm;
  }, [onConfirm]);
  const onLocateRef = useRef(onLocate);
  useEffect(() => {
    onLocateRef.current = onLocate;
  }, [onLocate]);

  // Barre de recherche d'adresse (forward geocoding).
  const geoCfg = useGeoClientConfig();
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<
    {
      display: string;
      secondary?: string;
      lat: number;
      lng: number;
      kind?: "merchant";
    }[]
  >([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Favoris « Tes lieux » (si activés) : étoile + accès rapide quand vide.
  const [favorites, setFavorites] = useState<FavPlace[]>([]);
  const [favCells, setFavCells] = useState<Set<string>>(new Set());
  const [favOpen, setFavOpen] = useState(false);
  useEffect(() => {
    if (!favoritesEnabled) return;
    void listFavoritePlaces().then((favs) => {
      setFavorites(favs);
      setFavCells(
        new Set(favs.map((f) => `${f.lat.toFixed(4)},${f.lng.toFixed(4)}`))
      );
    });
  }, [favoritesEnabled]);
  const favKey = (la: number, ln: number) =>
    `${la.toFixed(4)},${ln.toFixed(4)}`;
  const toggleFav = (r: { display: string; lat: number; lng: number }) => {
    const k = favKey(r.lat, r.lng);
    const on = !favCells.has(k);
    setFavCells((s) => {
      const n = new Set(s);
      if (on) n.add(k);
      else n.delete(k);
      return n;
    });
    setFavorites((list) =>
      on
        ? [
            { label: r.display, lat: r.lat, lng: r.lng },
            ...list.filter((f) => favKey(f.lat, f.lng) !== k),
          ]
        : list.filter((f) => favKey(f.lat, f.lng) !== k)
    );
    void toggleFavoritePlace({ lat: r.lat, lng: r.lng, label: r.display, on });
  };

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

    const init = (styleUrl: string) => {
      if (disposed || !containerRef.current) return;

      void import("maplibre-gl")
        .then((maplibre) => {
          const { Map } = maplibre;
          ensureRtlPlugin(maplibre);
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
          // signale une erreur que si le style lui-même n'a jamais chargé.
          map.on("error", (e) => {
            const msg = e?.error?.message ?? "Erreur carte inconnue";
            if (!styleArrived) setMapError("Erreur carte : " + msg);
          });

          const emit = () => {
            const c = map.getCenter();
            onChangeRef.current({ lat: c.lat, lng: c.lng });
          };
          // moveend = fin de drag/zoom/flyTo. Source unique de vérité pour
          // l'émission de coordonnées (évite les doubles emits).
          map.on("moveend", emit);

          // Toute interaction avec la carte (tap, glisser, zoom) referme les
          // panneaux de recherche / « Tes lieux » → ils ne masquent jamais le
          // curseur de positionnement central.
          const closePanels = () => {
            setFavOpen(false);
            setSearchOpen(false);
          };
          map.on("movestart", closePanels);
          map.on("dragstart", closePanels);

          // Clic / tap : referme les panneaux PUIS recentre la carte sur le
          // point cliqué. moveend s'occupera de l'émission une fois l'animation
          // terminée.
          map.on("click", (e) => {
            closePanels();
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
                  onLocateRef.current?.(true);
                })
                .catch(() => {
                  /* GPS indispo/refusé : on reste sur le centre par défaut */
                  onLocateRef.current?.(false);
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

    init(MAP_STYLE_URL);

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

  // Quand on bascule plein écran / retour, le conteneur change de taille →
  // MapLibre doit recalculer son viewport.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const ts = [50, 250, 550].map((t) => setTimeout(() => map.resize(), t));
    // Bloque le scroll du body en plein écran.
    if (fullscreen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        ts.forEach(clearTimeout);
        document.body.style.overflow = prev;
      };
    }
    return () => ts.forEach(clearTimeout);
  }, [fullscreen]);

  // Confirme la position depuis le plein écran : émet le centre courant, montre
  // un court loader (« enregistré »), puis revient au checkout (sort du plein
  // écran). La position est déjà capturée en continu via `moveend`.
  const confirmFullscreen = () => {
    if (confirming) return;
    const map = mapRef.current;
    if (map) {
      const c = map.getCenter();
      // Confirmation EXPLICITE : le parent marque la position comme confirmée
      // (plus de case « Je confirme » redondante). Fallback sur onChange.
      if (onConfirmRef.current)
        onConfirmRef.current({ lat: c.lat, lng: c.lng });
      else onChangeRef.current({ lat: c.lat, lng: c.lng });
    }
    setConfirming(true);
    window.setTimeout(() => {
      setConfirming(false);
      setFullscreen(false);
    }, 650);
  };

  // Recherche d'adresse : debounce 450 ms.
  useEffect(() => {
    if (!searchEnabled) return;
    const q = searchQ.trim();
    if (q.length < 3) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        // Biais de proximité : le centre actuel de la carte départage les
        // homonymes (plusieurs lieux portent le même nom en Algérie).
        const c = mapRef.current?.getCenter();
        const res = await geocodeSearch({ q, lat: c?.lat, lng: c?.lng });
        if (res.ok) {
          setSearchResults(res.results);
          setSearchOpen(true);
        }
      } finally {
        setSearching(false);
      }
    }, geoCfg.addressSearchDebounceMs);
    return () => clearTimeout(t);
  }, [searchQ, searchEnabled, geoCfg.addressSearchDebounceMs]);

  const flyToResult = (r: { display: string; lat: number; lng: number }) => {
    setSearchOpen(false);
    setFavOpen(false);
    // Apprentissage : ce choix fait remonter ce lieu pour les recherches futures.
    void recordPlacePick({ lat: r.lat, lng: r.lng, label: r.display });
    const map = mapRef.current;
    if (map) {
      map.flyTo({ center: [r.lng, r.lat], zoom: 17, duration: 700 });
      window.setTimeout(
        () => onChangeRef.current({ lat: r.lat, lng: r.lng }),
        800
      );
    } else {
      onChangeRef.current({ lat: r.lat, lng: r.lng });
    }
  };

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
      className={cn(
        "bg-surface-2 w-full overflow-hidden",
        fullscreen
          ? "fixed inset-0 z-[120] rounded-none"
          : "relative rounded-[12px]"
      )}
      style={{
        height: fullscreen
          ? "100dvh"
          : typeof height === "number"
            ? `${height}px`
            : height,
      }}
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

      {/* Barre de recherche d'adresse (forward geocoding) — au-dessus de tout. */}
      {searchEnabled && mapReady && (
        <div
          className={cn(
            "absolute right-2 left-2",
            // En mode normal, la barre doit rester SOUS le header sticky
            // (z-30) au scroll : on plafonne à z-10. En plein écran, le
            // conteneur est en z-[120] (contexte d'empilement isolé) → z-30
            // sans risque pour passer au-dessus du marqueur/contrôles.
            fullscreen
              ? "top-[max(12px,env(safe-area-inset-top))] z-30"
              : "top-2 z-10"
          )}
        >
          <div className="bg-surface border-border flex items-center gap-2 rounded-full border px-3 py-2 shadow-lg">
            <Search className="text-subtle size-4 shrink-0" />
            <input
              value={searchQ}
              onChange={(e) => {
                setSearchQ(e.target.value);
                setFavOpen(false);
              }}
              onFocus={() => {
                if (searchResults.length) setSearchOpen(true);
                if (
                  favoritesEnabled &&
                  searchQ.trim() === "" &&
                  favorites.length
                )
                  setFavOpen(true);
              }}
              onBlur={() => window.setTimeout(() => setFavOpen(false), 150)}
              placeholder={searchPlaceholder}
              className="placeholder:text-subtle min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
            {searching ? (
              <Loader2 className="text-subtle size-4 shrink-0 animate-spin" />
            ) : searchQ ? (
              <button
                type="button"
                aria-label="Effacer"
                onClick={() => {
                  setSearchQ("");
                  setSearchResults([]);
                  setSearchOpen(false);
                }}
                className="text-subtle hover:text-foreground shrink-0"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
          {searchOpen && searchResults.length > 0 && (
            <ul className="bg-surface border-border mt-1.5 max-h-64 overflow-auto rounded-[14px] border py-1 shadow-xl">
              {searchResults.map((r, i) => (
                <li key={i} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => flyToResult(r)}
                    className="hover:bg-surface-2 flex min-w-0 flex-1 items-start gap-2 px-3 py-2 text-left text-[13px]"
                  >
                    <MapPin className="text-primary-600 mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      {r.display}
                      {r.secondary && (
                        <small className="text-subtle block text-[11px]">
                          {r.secondary}
                        </small>
                      )}
                    </span>
                    {r.kind === "merchant" && (
                      <span
                        className="mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-extrabold tracking-wide"
                        style={{ background: "#EEEEFD", color: "#6C2BD9" }}
                      >
                        Coligo
                      </span>
                    )}
                  </button>
                  {favoritesEnabled && (
                    <button
                      type="button"
                      aria-label="Favori"
                      onClick={() => toggleFav(r)}
                      className="shrink-0 px-2.5 py-2"
                      style={{ color: "#6C2BD9" }}
                    >
                      <Star
                        className="size-4"
                        fill={
                          favCells.has(
                            `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`
                          )
                            ? "currentColor"
                            : "none"
                        }
                      />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {favoritesEnabled &&
            favOpen &&
            searchQ.trim() === "" &&
            favorites.length > 0 && (
              <ul className="bg-surface border-border mt-1.5 max-h-44 overflow-auto rounded-[14px] border py-1 shadow-xl">
                <li className="flex items-center justify-between px-3 pt-1.5 pb-1">
                  <span className="text-subtle text-[10px] font-extrabold tracking-wide uppercase">
                    Tes lieux
                  </span>
                  <button
                    type="button"
                    aria-label="Masquer"
                    onClick={() => setFavOpen(false)}
                    className="text-subtle hover:text-foreground -my-1 shrink-0 p-1"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
                {favorites.map((f, i) => (
                  <li key={`fav-${i}`} className="flex items-center">
                    <button
                      type="button"
                      onClick={() =>
                        flyToResult({
                          display: f.label,
                          lat: f.lat,
                          lng: f.lng,
                        })
                      }
                      className="hover:bg-surface-2 flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-[13px]"
                    >
                      <Star
                        className="size-4 shrink-0"
                        style={{ color: "#6C2BD9" }}
                        fill="currentColor"
                      />
                      <span className="min-w-0 flex-1 truncate">{f.label}</span>
                    </button>
                    <button
                      type="button"
                      aria-label="Retirer"
                      onClick={() =>
                        toggleFav({ display: f.label, lat: f.lat, lng: f.lng })
                      }
                      className="text-subtle shrink-0 px-2.5 py-2"
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}

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
          laisser passer les clics → carte. Le conteneur est ancré au POINT
          (centre du viewport) ; le pin se décale au-dessus, le halo pulse
          depuis ce point exact. */}
      {mapReady && (
        <div
          className={cn(
            "pointer-events-none absolute top-1/2 left-1/2 z-[2]",
            markerColorClass
          )}
        >
          {pulse && (
            <span
              aria-hidden
              className="co-halo absolute top-0 left-0 size-7 rounded-full bg-current"
            />
          )}
          <span className="absolute top-0 left-0 -translate-x-1/2 -translate-y-full">
            <MapPin
              className={cn("size-9 drop-shadow-md", pulse && "co-drop")}
              fill="currentColor"
            />
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={useGps}
        disabled={loading || !mapReady}
        className={cn(
          "bg-surface border-border absolute right-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow disabled:opacity-60",
          // En plein écran, on remonte le bouton GPS au-dessus de la barre
          // « Confirmer ma position ».
          fullscreen ? "bottom-24" : "bottom-2"
        )}
      >
        {loading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Crosshair className="size-3.5" />
        )}
        {gpsLabel}
      </button>

      {/* Agrandir / plein écran (coin bas-gauche). */}
      {mapReady && !fullscreen && (
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          aria-label="Agrandir la carte"
          className="bg-surface border-border text-foreground absolute bottom-2 left-2 grid size-8 place-items-center rounded-[9px] border shadow"
        >
          <Maximize2 className="size-4" />
        </button>
      )}

      {/* Plein écran : barre d'action EN BAS avec « Confirmer ma position »
          (noir) → court loader « Enregistrement… » puis retour au checkout. */}
      {fullscreen && (
        <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/15 to-transparent p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={confirmFullscreen}
            disabled={confirming}
            className="bg-foreground inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] text-base font-bold text-white shadow-xl disabled:opacity-90"
          >
            {confirming ? (
              <>
                <Loader2 className="size-5 animate-spin" />
                Enregistrement…
              </>
            ) : (
              <>
                <Check className="size-5" />
                Confirmer ma position
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
