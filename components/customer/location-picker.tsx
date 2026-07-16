"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Bookmark,
  Check,
  ChevronRight,
  History,
  Loader2,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Portal } from "@/components/ui/portal";
import { useGeolocation } from "@/lib/hooks/use-geolocation";
import { MapPositionPicker } from "@/components/shared/map-position-picker";
import {
  writeStoredLocation,
  type CustomerLocation,
} from "@/lib/customer/location-store";
import {
  reverseGeocode,
  updateCustomerLocation,
  geocodeSearch,
  listFavoritePlaces,
  listRecentPlaces,
  recordPlacePick,
  type FavPlace,
} from "@/app/(customer)/actions";
// Reverse géocodage PRÉCIS (zoom 18 : rue/quartier) pour le libellé exact.
import { reverseGeocode as reverseGeocodeAddress } from "@/lib/geo/geocode";
import { createClient } from "@/lib/supabase/client";

type Props = {
  onClose?: () => void;
  initial: CustomerLocation | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Cache SESSION des adresses enregistrées + lieux précédents, PAR COMPTE :
// « Où veux-tu commander ? » les affiche INSTANTANÉMENT à l'ouverture (zéro
// attente réseau), puis le serveur revalide en arrière-plan. Sans lui, chaque
// ouverture re-téléchargeait favoris + historique → liste vide pendant
// l'aller-retour. L'id du compte fait partie du cache (session locale, lue
// sans réseau) → jamais les lieux d'un autre compte sur appareil partagé.
// sessionStorage : survit aux navigations, meurt à la fermeture de l'onglet.
// ─────────────────────────────────────────────────────────────────────────────
const PLACES_CACHE_KEY = "coligo:places:v1";
type PlacesCache = { uid: string; favs: FavPlace[]; recents: FavPlace[] };
let placesCacheMem: PlacesCache | null = null;

function readPlacesCache(uid: string): PlacesCache | null {
  if (placesCacheMem?.uid === uid) return placesCacheMem;
  try {
    const raw = sessionStorage.getItem(PLACES_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as PlacesCache;
    return c.uid === uid ? c : null;
  } catch {
    return null;
  }
}

function writePlacesCache(c: PlacesCache) {
  placesCacheMem = c;
  try {
    sessionStorage.setItem(PLACES_CACHE_KEY, JSON.stringify(c));
  } catch {
    /* sessionStorage indispo */
  }
}

/** Ajout optimiste d'un lieu choisi en tête de l'historique du cache. */
function pushRecentToCache(place: FavPlace) {
  const c = placesCacheMem;
  if (!c) return;
  writePlacesCache({
    ...c,
    recents: [place, ...c.recents.filter((r) => r.label !== place.label)].slice(
      0,
      8
    ),
  });
}

type SearchHit = {
  display: string;
  secondary?: string;
  lat: number;
  lng: number;
};

export function LocationPicker({ onClose, initial }: Props) {
  const t = useTranslations("account");
  const tCheckout = useTranslations("checkout");
  const geo = useGeolocation();

  const initialCoords =
    initial?.latitude != null && initial?.longitude != null
      ? { lat: initial.latitude, lng: initial.longitude }
      : null;

  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<null | "gps">(null);
  // Erreur GPS affichée EN LIGNE (pas de toast, cf. CLAUDE.md).
  const [geoErr, setGeoErr] = useState<string | null>(null);

  // Recherche d'emplacement (forward geocoding).
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  // Adresses enregistrées (favoris) + lieux précédents (historique).
  const [favs, setFavs] = useState<FavPlace[]>([]);
  const [recents, setRecents] = useState<FavPlace[]>([]);

  // Page « carte plein écran ».
  const [mapOpen, setMapOpen] = useState(false);
  const [mapCoords, setMapCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(initialCoords);

  // Favoris + historique : CACHE D'ABORD (affichage instantané à l'ouverture),
  // serveur ensuite (revalidation silencieuse). Non connecté = vide.
  useEffect(() => {
    let alive = true;
    void (async () => {
      // Session LOCALE (aucun réseau) → id du compte pour le cache.
      const { data } = await createClient().auth.getSession();
      const uid = data.session?.user.id ?? null;
      if (!alive) return;
      if (uid) {
        const cached = readPlacesCache(uid);
        if (cached) {
          setFavs(cached.favs);
          setRecents(cached.recents);
        }
      }
      const [f, r] = await Promise.all([
        listFavoritePlaces(),
        listRecentPlaces(),
      ]);
      if (!alive) return;
      setFavs(f);
      setRecents(r);
      if (uid) writePlacesCache({ uid, favs: f, recents: r });
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Recherche débouncée.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = window.setTimeout(async () => {
      const res = await geocodeSearch({
        q: query,
        lat: initialCoords?.lat,
        lng: initialCoords?.lng,
      });
      setResults(res.ok ? res.results : []);
      setSearching(false);
    }, 300);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Enregistre un emplacement (lat/lng + libellé) comme adresse de livraison.
  async function savePlace(p: {
    lat: number;
    lng: number;
    label?: string | null;
  }) {
    setSaving(true);
    setGeoErr(null);
    try {
      let w: string | null = null;
      let c: string | null = null;
      try {
        const res = await reverseGeocode({ latitude: p.lat, longitude: p.lng });
        if (res.ok) {
          w = res.wilaya_code ?? null;
          c = res.commune ?? null;
        }
      } catch {
        /* reverse-geocode indispo → on enregistre quand même les coords */
      }
      let address = p.label ?? null;
      if (!address) {
        try {
          address = await reverseGeocodeAddress(p.lat, p.lng);
        } catch {
          /* géocodage indispo */
        }
      }
      writeStoredLocation({
        latitude: p.lat,
        longitude: p.lng,
        wilaya_code: w,
        commune: c,
        address,
        // Choix EXPLICITE du client → jamais écrasé par le refresh GPS auto.
        source: "manual",
      });
      await updateCustomerLocation({
        wilaya_code: w,
        commune: c,
        latitude: p.lat,
        longitude: p.lng,
      });
      const pickedLabel = address ?? ([c, w].filter(Boolean).join(", ") || "—");
      void recordPlacePick({ lat: p.lat, lng: p.lng, label: pickedLabel });
      // Optimiste : le lieu choisi apparaît en tête des « précédents » dès la
      // PROCHAINE ouverture, sans attendre l'aller-retour serveur.
      pushRecentToCache({ label: pickedLabel, lat: p.lat, lng: p.lng });
      // Emplacement enregistré → le picker se ferme, la barre de localisation
      // de l'app affiche la nouvelle adresse (retour visuel, pas de toast).
      onClose?.();
    } finally {
      setSaving(false);
    }
  }

  async function useGps() {
    setBusy("gps");
    setGeoErr(null);
    try {
      const gps = await geo.requestOnce();
      if (!gps) {
        setGeoErr(
          geo.error?.kind === "denied"
            ? t("permissionDenied")
            : t("geolocFailed")
        );
        return;
      }
      await savePlace({ lat: gps.latitude, lng: gps.longitude });
    } finally {
      setBusy(null);
    }
  }

  const disabled = saving || busy != null;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-foreground text-lg font-bold">
          {t("whereToOrder")}
        </h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground hover:bg-surface-2 rounded-full p-1.5"
            aria-label={t("close")}
          >
            <X className="size-4" />
          </button>
        )}
      </header>

      {/* ─── Barre de recherche d'emplacement ─── */}
      <div className="border-border bg-surface-2 flex items-center gap-2.5 rounded-[13px] px-3.5 py-3">
        <Search className="text-muted size-4 shrink-0" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchLocationPlaceholder")}
          className="placeholder:text-hint text-foreground w-full bg-transparent text-sm font-medium outline-none"
        />
        {searching && (
          <Loader2 className="text-muted size-4 shrink-0 animate-spin" />
        )}
        {!searching && q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label={t("close")}
            className="text-muted hover:text-foreground shrink-0"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Erreur GPS EN LIGNE (permission refusée / géoloc indispo). */}
      {geoErr && (
        <p className="border-danger-200 bg-danger-50 text-danger-700 rounded-[12px] border px-3.5 py-2.5 text-[13px] font-semibold">
          {geoErr}
        </p>
      )}

      {/* Zone dynamique à HAUTEUR FIXE : la carte ne « saute » plus selon le
          nombre de résultats (pendant la recherche, 0 résultat, ou liste
          longue). Le contenu défile à l'intérieur, la card garde sa taille. */}
      <div className="h-[clamp(280px,48vh,440px)] space-y-4 overflow-y-auto overscroll-contain">
        {/* Résultats de recherche (remplacent les options tant qu'on tape). */}
        {q.trim().length >= 3 ? (
          <div className="divide-border border-border divide-y overflow-hidden rounded-[13px] border">
            {results.length === 0 && !searching ? (
              <p className="text-muted px-4 py-3 text-sm">
                {t("noSearchResults")}
              </p>
            ) : (
              results.map((r, i) => (
                <PlaceRow
                  key={`${r.lat}-${r.lng}-${i}`}
                  icon={<MapPin className="size-[18px]" />}
                  title={r.display}
                  sub={r.secondary}
                  onClick={() =>
                    savePlace({ lat: r.lat, lng: r.lng, label: r.display })
                  }
                  disabled={disabled}
                />
              ))
            )}
          </div>
        ) : (
          <>
            {/* ─── Actions principales ─── */}
            <div className="divide-border border-border divide-y overflow-hidden rounded-[13px] border">
              <PlaceRow
                icon={<MapIcon className="size-[18px]" />}
                title={t("selectOnMap")}
                onClick={() => setMapOpen(true)}
                disabled={disabled}
              />
              <PlaceRow
                icon={
                  busy === "gps" ? (
                    <Loader2 className="size-[18px] animate-spin" />
                  ) : (
                    <LocateFixed className="size-[18px]" />
                  )
                }
                title={t("myCurrentPosition")}
                onClick={useGps}
                disabled={disabled}
              />
            </div>

            {/* ─── Adresses enregistrées (si présentes) ─── */}
            {favs.length > 0 && (
              <Section title={t("savedAddresses")}>
                {favs.map((p, i) => (
                  <PlaceRow
                    key={`fav-${i}`}
                    icon={<Bookmark className="size-[18px]" />}
                    title={p.label}
                    onClick={() =>
                      savePlace({ lat: p.lat, lng: p.lng, label: p.label })
                    }
                    disabled={disabled}
                  />
                ))}
              </Section>
            )}

            {/* ─── Lieux précédents (si présents) ─── */}
            {recents.length > 0 && (
              <Section title={t("previousPlaces")}>
                {recents.map((p, i) => (
                  <PlaceRow
                    key={`rec-${i}`}
                    icon={<History className="size-[18px]" />}
                    title={p.label}
                    onClick={() =>
                      savePlace({ lat: p.lat, lng: p.lng, label: p.label })
                    }
                    disabled={disabled}
                  />
                ))}
              </Section>
            )}
          </>
        )}
      </div>

      {/* ═══ PAGE CARTE PLEIN ÉCRAN ═══ */}
      {mapOpen && (
        <Portal>
          <div className="bg-surface fixed inset-0 z-[100] flex flex-col pt-[env(safe-area-inset-top)]">
            <header className="border-border flex h-14 shrink-0 items-center gap-3 border-b px-3">
              <button
                type="button"
                onClick={() => setMapOpen(false)}
                aria-label={t("close")}
                className="text-foreground hover:bg-surface-2 grid size-9 place-items-center rounded-full"
              >
                <X className="size-5" />
              </button>
              <h2 className="text-foreground flex-1 truncate text-base font-bold">
                {t("selectOnMap")}
              </h2>
            </header>
            <div className="relative min-h-0 flex-1">
              <MapPositionPicker
                initial={mapCoords ?? undefined}
                autoLocate={mapCoords == null}
                onChange={(p) => setMapCoords(p)}
                gpsLabel={t("myCurrentPosition")}
                height="100%"
                searchEnabled
                favoritesEnabled
                searchPlaceholder={tCheckout("searchAddressPlaceholder")}
              />
            </div>
            <div className="border-border bg-surface shrink-0 border-t p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={saving || !mapCoords}
                onClick={async () => {
                  if (!mapCoords) return;
                  await savePlace(mapCoords);
                  setMapOpen(false);
                }}
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                {t("validatePosition")}
              </Button>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}

/** Section titrée (libellé en petites majuscules + carte de lignes). */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-muted px-1 text-[11px] font-extrabold tracking-wide uppercase">
        {title}
      </p>
      <div className="divide-border border-border divide-y overflow-hidden rounded-[13px] border">
        {children}
      </div>
    </div>
  );
}

/** Ligne d'option / de lieu : icône en pastille + libellé + chevron. */
function PlaceRow({
  icon,
  title,
  sub,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  sub?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="hover:bg-surface-2 flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors disabled:opacity-50"
    >
      <span className="bg-primary-50 text-primary-600 grid size-9 shrink-0 place-items-center rounded-full">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-sm font-bold">
          {title}
        </span>
        {sub && (
          <span className="text-muted block truncate text-xs">{sub}</span>
        )}
      </span>
      <ChevronRight className="text-subtle size-4 shrink-0 rtl:-scale-x-100" />
    </button>
  );
}
