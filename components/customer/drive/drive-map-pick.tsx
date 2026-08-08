"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ChevronLeft,
  Clock,
  Loader2,
  MapPin,
  Search,
  Star,
} from "lucide-react";
import {
  geocodeSearch,
  listFavoritePlaces,
  recordPlacePick,
  reverseGeocode,
  toggleFavoritePlace,
  type FavPlace,
} from "@/app/(customer)/actions";
import { useGeoClientConfig } from "@/lib/geo/use-geo-client-config";
import { DriveMap, type LatLng } from "./drive-map";
import { GhostBtn, PrimaryBtn, VIOLET } from "./drive-modals";
import type { Pt } from "./drive-types";

/* ─────────────── Écran : choix sur la carte (épingle centrale fixe) ─────────────── */

// Cache module des favoris : chargés une fois, réaffichés INSTANTANÉMENT aux
// ouvertures suivantes de la recherche (pas de round-trip à chaque ouverture).
let FAV_CACHE: FavPlace[] | null = null;

export function MapPickScreen({
  forWhat,
  initial,
  recents = [],
  onBack,
  onConfirm,
}: {
  forWhat: "dep" | "dest";
  initial?: Pt;
  /** Destinations récentes du client (instantané, via le contexte Drive). */
  recents?: { text: string; lat: number; lng: number }[];
  onBack: () => void;
  onConfirm: (p: { lat: number; lng: number; text: string | null }) => void;
}) {
  const t = useTranslations("drive.mappick");
  // Debounces pilotés par /admin/config (reverse_geocode/address_search) —
  // RÈGLE 2 : aucune valeur en dur. Défauts tant que la config n'est pas chargée.
  const geoCfg = useGeoClientConfig();
  const [center, setCenter] = useState<LatLng | null>(initial ?? null);
  const [addr, setAddr] = useState<string | null>(initial?.text ?? null);
  const [resolving, setResolving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Numéro de séquence du dernier déplacement : une réponse en retard (lieu
  // gazetteer ou rue) ne doit jamais écraser une position plus récente.
  const geoSeqRef = useRef(0);
  // Quand le client CHOISIT une suggestion, on remet son libellé dans l'input —
  // ce qui retriggerait la recherche et RÉOUVRIRAIT la liste. Ce drapeau saute
  // la recherche UNE fois après un choix → la liste ne se réaffiche pas tant que
  // le client ne MODIFIE pas son texte.
  const pickedRef = useRef(false);
  // Choix EXPLICITE d'un lieu (suggestion / favori / récent / valeur initiale) :
  // le recentrage de la carte (flyTo) émet un `moveend` → `onMove`. Sans ce
  // drapeau, ce déplacement programmatique repasserait l'adresse à « … » et
  // re-géocoderait, RÉGRISANT « Confirmer ce point ». On consomme ce drapeau au
  // 1ᵉʳ `onMove` qui suit le choix : le libellé déjà connu est CONSERVÉ. Les
  // déplacements MANUELS suivants re-géocodent normalement. Initialisé à true
  // quand on entre avec un libellé (édition d'un point déjà choisi).
  const movePickRef = useRef<boolean>(Boolean(initial?.text));
  // Filet anti-blocage du « … » : garantit que `resolving` finit toujours par
  // retomber, même si le géocodage hang/échoue (le libellé tombe alors sur les
  // coordonnées GPS et « Confirmer ce point » redevient actif).
  const resolveSafetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Recherche d'adresse SUR la carte (suggestions, debounce configurable).
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<
    {
      display: string;
      secondary?: string;
      lat: number;
      lng: number;
      kind?: "merchant" | "google";
    }[]
  >([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // « Tes lieux » : affiché SEULEMENT au focus de la barre (chargé en arrière-
  // plan), jamais en permanence → ne masque pas le curseur central. Se ferme à
  // l'interaction carte ou via le bouton ✕.
  const [favOpen, setFavOpen] = useState(false);
  const [focusTarget, setFocusTarget] = useState<
    (LatLng & { zoom?: number }) | null
  >(null);
  // Dernière position émise par la carte : filtre les `moveend` SANS
  // déplacement (resize clavier) qui refermaient les panneaux à tort.
  const lastMoveRef = useRef<LatLng | null>(null);
  // Fermeture des panneaux au TAP HORS de la zone de recherche (carte, feuille
  // du bas) — fiable au doigt, contrairement à un `blur` que le WebView peut
  // déclencher pendant l'animation du clavier.
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const w = searchWrapRef.current;
      if (w && e.target instanceof Node && !w.contains(e.target)) {
        setSearchOpen(false);
        setFavOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
  // Ouverture des panneaux au focus ET au clic : si l'input a déjà le focus
  // (panneau refermé entre-temps), `onFocus` ne re-tire pas — le clic, si.
  const openPanels = () => {
    if (searchResults.length > 0) setSearchOpen(true);
    // Barre vide → on ouvre « Tes lieux » (sinon les résultats).
    if (searchQ.trim() === "") setFavOpen(true);
  };

  // Favoris « Tes lieux » : étoile pour sauvegarder, accès rapide quand vide.
  // Initialisés depuis le cache module → AFFICHAGE INSTANTANÉ (pas d'attente).
  const [favorites, setFavorites] = useState<FavPlace[]>(FAV_CACHE ?? []);
  const [favCells, setFavCells] = useState<Set<string>>(
    new Set(
      (FAV_CACHE ?? []).map((f) => `${f.lat.toFixed(4)},${f.lng.toFixed(4)}`)
    )
  );
  useEffect(() => {
    void listFavoritePlaces().then((favs) => {
      FAV_CACHE = favs;
      setFavorites(favs);
      setFavCells(
        new Set(favs.map((f) => `${f.lat.toFixed(4)},${f.lng.toFixed(4)}`))
      );
    });
  }, []);
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

  useEffect(() => {
    // Le client vient de CHOISIR une adresse → on ne relance pas la recherche
    // (sinon la liste se rouvre). Réinitialise le drapeau pour la frappe suivante.
    if (pickedRef.current) {
      pickedRef.current = false;
      setSearching(false);
      return;
    }
    const q = searchQ.trim();
    if (q.length < 3) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        // Biais de proximité : le centre courant départage les homonymes.
        const res = await geocodeSearch({
          q,
          lat: center?.lat,
          lng: center?.lng,
        });
        if (res.ok) {
          setSearchResults(res.results);
          setSearchOpen(true);
        }
      } finally {
        setSearching(false);
      }
    }, geoCfg.addressSearchDebounceMs);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQ, geoCfg.addressSearchDebounceMs]);

  // Suggestion choisie → l'épingle se recale EXACTEMENT sur ce lieu (le
  // client peut ensuite affiner au doigt — moveend ré-émettra la position).
  const pickSuggestion = (r: { display: string; lat: number; lng: number }) => {
    pickedRef.current = true; // saute la recherche déclenchée par setSearchQ
    movePickRef.current = true; // le moveend du flyTo ne doit pas effacer ce libellé
    setSearchOpen(false);
    setSearchResults([]); // la liste disparaît et ne se rouvre pas au focus
    setSearchQ(r.display);
    setAddr(r.display);
    setResolving(false); // adresse connue → « Confirmer ce point » actif tout de suite
    setCenter({ lat: r.lat, lng: r.lng });
    setFocusTarget({ lat: r.lat, lng: r.lng, zoom: 17 });
    // Apprentissage : ce choix fait remonter ce lieu pour les recherches futures.
    void recordPlacePick({ lat: r.lat, lng: r.lng, label: r.display });
  };

  // Repli : si la rue est introuvable, on affiche les coordonnées GPS EXACTES
  // du point sélectionné (et on les garde comme libellé du point).
  const gpsLabel = (c: LatLng) => `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;

  const onMove = useCallback(
    (c: LatLng) => {
      // `map.resize()` (ouverture/fermeture du CLAVIER, timers d'init de la
      // carte) émet un `moveend` SANS déplacement réel. Sans ce garde, le
      // focus de la barre de recherche (clavier → resize → moveend) refermait
      // « Tes lieux » à l'instant où il s'ouvrait, et l'adresse repassait
      // par « … » pour rien. Même point ⇒ on ignore tout.
      const prev = lastMoveRef.current;
      lastMoveRef.current = c;
      if (
        prev &&
        Math.abs(prev.lat - c.lat) < 1e-7 &&
        Math.abs(prev.lng - c.lng) < 1e-7
      )
        return;
      // VRAIE interaction carte (glisser/zoom) → on referme les panneaux pour
      // dégager le curseur central. Jamais à la 1ʳᵉ émission (init de la
      // carte, qui peut arriver APRÈS que le client a ouvert la recherche).
      if (prev) {
        setSearchOpen(false);
        setFavOpen(false);
      }
      setCenter(c);
      // Choix explicite (suggestion/favori/récent/init) : le flyTo a émis ce
      // moveend, mais le libellé est DÉJÀ connu → on le conserve, on ne repasse
      // pas par « … » et on ne re-géocode pas. Les déplacements MANUELS suivants
      // (movePickRef remis à false) re-géocoderont normalement.
      if (movePickRef.current) {
        movePickRef.current = false;
        setResolving(false);
        return;
      }
      const seq = ++geoSeqRef.current;
      // On efface l'adresse du point PRÉCÉDENT → pendant la résolution on affiche
      // « … », jamais l'ancienne adresse ni une approximation.
      setAddr(null);
      setResolving(true);
      // FILET anti-blocage : on ne reste JAMAIS coincé sur « … » / bouton grisé.
      // reverseGeocode est borné (~2,5 s côté serveur) ; ce filet ne sert que si
      // l'action elle-même traîne au-delà.
      if (resolveSafetyRef.current) clearTimeout(resolveSafetyRef.current);
      resolveSafetyRef.current = setTimeout(() => {
        if (seq === geoSeqRef.current) setResolving(false);
      }, 3000);
      // ADRESSE PRÉCISE DIRECTE : on ne montre PLUS d'abord le « lieu le plus
      // proche » du gazetteer (qui pouvait être un POI éloigné/erroné, ex. une
      // plage), puis la corriger. On résout DIRECTEMENT l'adresse de RUE
      // (reverseGeocode précis) et on n'affiche QUE celle-là → la bonne adresse
      // d'emblée, sans valeur temporaire fausse. (reverseGeocode bascule déjà sur
      // le gazetteer EN INTERNE si Nominatim échoue → un seul libellé, le bon.)
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(
        async () => {
          try {
            const r = await reverseGeocode({
              latitude: c.lat,
              longitude: c.lng,
              precise: true,
            });
            // Réponse pour une position plus récente → on ignore (anti-rejeu).
            if (seq !== geoSeqRef.current) return;
            if (r?.ok && r.display) setAddr(r.display);
          } catch {
            /* échec → l'affichage retombe sur les coordonnées GPS exactes */
          } finally {
            if (seq === geoSeqRef.current) setResolving(false);
          }
          // Debounce court (≤ 200 ms) : reverseGeocode devient le chemin PRINCIPAL
          // (plus de phase 1 instantanée), on le déclenche donc vite.
        },
        Math.min(geoCfg.reverseGeocodeDebounceMs, 200)
      );
    },
    [geoCfg.reverseGeocodeDebounceMs]
  );

  // Nettoyage du filet anti-blocage au démontage.
  useEffect(
    () => () => {
      if (resolveSafetyRef.current) clearTimeout(resolveSafetyRef.current);
    },
    []
  );

  return (
    <div className="drive-jakarta drive-screen z-50 bg-[var(--d-page)]">
      <DriveMap
        markers={initial ? [{ id: "init", pos: initial, kind: "me" }] : []}
        interactive
        onMove={onMove}
        focusTarget={focusTarget}
      />
      <button
        type="button"
        onClick={onBack}
        className="rounded-card-lg absolute top-[calc(0.75rem+env(safe-area-inset-top))] left-4 z-10 grid size-[42px] place-items-center border border-[var(--d-line)] bg-[var(--d-surface)] shadow-lg"
        aria-label="retour"
      >
        <ChevronLeft className="size-5" />
      </button>

      {/* Recherche d'adresse SUR la carte : suggestions, et la sélection
          recentre l'épingle EXACTEMENT sur le lieu choisi (affinable au
          doigt ensuite). */}
      <div
        ref={searchWrapRef}
        className="absolute top-[calc(0.75rem+env(safe-area-inset-top))] right-4 left-[68px] z-20"
      >
        <div className="flex items-center gap-2 rounded-full border border-[var(--d-line)] bg-[var(--d-surface)] px-3.5 py-2.5 shadow-lg">
          <Search className="size-4 shrink-0 text-[var(--d-muted)]" />
          <input
            value={searchQ}
            onChange={(e) => {
              setSearchQ(e.target.value);
              setFavOpen(false);
            }}
            onFocus={openPanels}
            onClick={openPanels}
            placeholder={t("searchPh")}
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:font-medium placeholder:text-[var(--d-muted)]"
          />
          {searching ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-[var(--d-muted)]" />
          ) : searchQ ? (
            <button
              type="button"
              aria-label="Effacer"
              onClick={() => {
                setSearchQ("");
                setSearchResults([]);
                setSearchOpen(false);
                setFavOpen(true); // barre vide → on re-propose « Tes lieux »
              }}
              className="shrink-0 text-[var(--d-muted)]"
            >
              ✕
            </button>
          ) : null}
        </div>
        {searchOpen && searchResults.length > 0 && (
          <ul className="mt-1.5 max-h-44 overflow-auto rounded-lg border border-[var(--d-line)] bg-[var(--d-surface)] py-1">
            {searchResults.map((r, i) => (
              <li key={`${r.lat}-${r.lng}-${i}`} className="flex items-center">
                <button
                  type="button"
                  onClick={() => pickSuggestion(r)}
                  className="text-body-sm flex min-w-0 flex-1 items-start gap-2 px-3 py-2.5 text-left font-semibold"
                >
                  <MapPin
                    className="mt-0.5 size-4 shrink-0"
                    style={{ color: VIOLET }}
                  />
                  <span className="min-w-0 flex-1">
                    {r.display}
                    {r.secondary && (
                      <small className="text-caption block font-medium text-[var(--d-muted)]">
                        {r.secondary}
                      </small>
                    )}
                  </span>
                  {/* Commerçant inscrit Coligo : badge automatique. */}
                  {r.kind === "merchant" && (
                    <span
                      className="text-nano-lg mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 font-extrabold tracking-wide"
                      style={{ background: "var(--d-accent)", color: VIOLET }}
                    >
                      Coligo
                    </span>
                  )}
                  {/* Résultat Google Maps (distinct des cartes gratuites OSM). */}
                  {r.kind === "google" && (
                    <span
                      className="text-nano-lg mt-0.5 shrink-0 rounded-full border border-[var(--d-line)] px-1.5 py-0.5 font-extrabold tracking-wide text-[var(--d-muted)]"
                      title="Résultat Google Maps"
                    >
                      Google
                    </span>
                  )}
                </button>
                {/* Étoile : sauvegarder cette adresse dans « Tes lieux ». */}
                <button
                  type="button"
                  aria-label="Favori"
                  onClick={() => toggleFav(r)}
                  className="shrink-0 px-2.5 py-2.5"
                >
                  <Star
                    className="size-4"
                    style={{ color: VIOLET }}
                    fill={
                      favCells.has(`${r.lat.toFixed(4)},${r.lng.toFixed(4)}`)
                        ? VIOLET
                        : "none"
                    }
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* « Tes lieux » : favoris du client, accès rapide quand la barre est
            vide (comme Uber). Sélection = recentrage immédiat. */}
        {/* Accès rapide DIRECT quand la barre est vide : favoris (« Tes lieux »)
            + destinations récentes. Affiché d'emblée (pas besoin de focus) →
            le client retrouve ses lieux sans retaper. Instantané (favoris en
            cache + récents passés par le contexte). */}
        {searchQ.trim() === "" &&
          favOpen &&
          (favorites.length > 0 || recents.length > 0) && (
            <ul className="mt-1.5 max-h-44 overflow-auto rounded-lg border border-[var(--d-line)] bg-[var(--d-surface)] py-1">
              {/* Bouton ✕ pour masquer « Tes lieux » manuellement (sinon il se
                  ferme à l'interaction carte). */}
              <li className="flex justify-end px-2 pt-0.5">
                <button
                  type="button"
                  aria-label="Masquer"
                  onClick={() => setFavOpen(false)}
                  className="p-1 text-[var(--d-muted)]"
                >
                  ✕
                </button>
              </li>
              {favorites.length > 0 && (
                <li className="text-micro px-3 pt-0.5 pb-1 font-extrabold tracking-wide text-[var(--d-muted)] uppercase">
                  {t("savedPlaces")}
                </li>
              )}
              {favorites.map((f, i) => (
                <li
                  key={`fav-${f.lat}-${f.lng}-${i}`}
                  className="flex items-center"
                >
                  <button
                    type="button"
                    onClick={() =>
                      pickSuggestion({
                        display: f.label,
                        lat: f.lat,
                        lng: f.lng,
                      })
                    }
                    className="text-body-sm flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left font-semibold"
                  >
                    <Star
                      className="size-4 shrink-0"
                      style={{ color: VIOLET }}
                      fill={VIOLET}
                    />
                    <span className="min-w-0 flex-1 truncate">{f.label}</span>
                  </button>
                  <button
                    type="button"
                    aria-label="Retirer des favoris"
                    onClick={() =>
                      toggleFav({ display: f.label, lat: f.lat, lng: f.lng })
                    }
                    className="shrink-0 px-2.5 py-2.5 text-[var(--d-muted)]"
                  >
                    ✕
                  </button>
                </li>
              ))}
              {recents.length > 0 && (
                <li className="text-micro px-3 pt-2 pb-1 font-extrabold tracking-wide text-[var(--d-muted)] uppercase">
                  {t("recents")}
                </li>
              )}
              {recents
                .filter(
                  (r) =>
                    !favCells.has(`${r.lat.toFixed(4)},${r.lng.toFixed(4)}`)
                )
                .map((r, i) => (
                  <li
                    key={`rec-${r.lat}-${r.lng}-${i}`}
                    className="flex items-center"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        pickSuggestion({
                          display: r.text,
                          lat: r.lat,
                          lng: r.lng,
                        })
                      }
                      className="text-body-sm flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left font-semibold"
                    >
                      <Clock className="size-4 shrink-0 text-[var(--d-muted)]" />
                      <span className="min-w-0 flex-1 truncate">{r.text}</span>
                    </button>
                    <button
                      type="button"
                      aria-label="Favori"
                      onClick={() =>
                        toggleFav({ display: r.text, lat: r.lat, lng: r.lng })
                      }
                      className="shrink-0 px-2.5 py-2.5"
                    >
                      <Star
                        className="size-4"
                        style={{ color: VIOLET }}
                        fill="none"
                      />
                    </button>
                  </li>
                ))}
            </ul>
          )}
        {searchOpen &&
          !searching &&
          searchResults.length === 0 &&
          searchQ.trim().length >= 3 && (
            <p className="rounded-card-lg mt-1.5 border border-[var(--d-line)] bg-[var(--d-surface)] px-3 py-2.5 text-center text-xs font-semibold text-[var(--d-muted)]">
              {t("noResults")}
            </p>
          )}
      </div>
      {/* Épingle centrale fixe (la carte se déplace dessous) */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-full">
        <div
          className="size-[22px] rounded-full border-4 border-white"
          style={{
            background: VIOLET,
            boxShadow: "0 6px 16px -4px rgba(91,91,230,.42)",
          }}
        />
        <div className="mx-auto h-3.5 w-[3px] rounded-sm bg-[var(--d-ink)]" />
        <div className="mx-auto mt-1 size-[7px] rounded-full bg-[rgba(8,9,15,.3)]" />
      </div>
      <div className="rounded-t-panel-lg absolute inset-x-0 bottom-0 z-10 border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-4 pb-[calc(24px+env(safe-area-inset-bottom))]">
        <p className="text-body-sm mb-1 text-[var(--d-muted)]">
          {forWhat === "dep" ? t("depLabel") : t("destLabel")}
        </p>
        <p className="drive-sora text-title-lg mb-0.5 min-h-[24px] font-extrabold">
          {center
            ? resolving
              ? "…"
              : (addr ?? t("gpsPoint", { coords: gpsLabel(center) }))
            : t("moveMap")}
        </p>
        {center && addr && !resolving && (
          <p className="text-caption mb-2 text-[var(--d-muted)] tabular-nums">
            GPS · {gpsLabel(center)}
          </p>
        )}
        <PrimaryBtn
          disabled={!center || resolving}
          onClick={() =>
            center &&
            onConfirm({
              lat: center.lat,
              lng: center.lng,
              text: addr ?? t("gpsPoint", { coords: gpsLabel(center) }),
            })
          }
        >
          {t("confirm")}
        </PrimaryBtn>
        <GhostBtn onClick={onBack}>{t("back")}</GhostBtn>
      </div>
    </div>
  );
}
