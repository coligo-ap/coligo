"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Clock,
  List,
  Loader2,
  Map as MapIcon,
  MapPin,
  Navigation,
  Phone,
  RefreshCw,
  Search,
  Store,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getPosition } from "@/lib/native/geolocation";
import { geocodeCommune } from "@/lib/geo/geocode";
import { NAV_APPS, getNavPref, openNav, setNavPref } from "@/lib/drive/nav";
import {
  RechargePointsMap,
  type MapPoint,
} from "@/components/wallet/recharge-points-map";

type Point = {
  wallet_id: string;
  display_name: string | null;
  address: string | null;
  phone: string | null;
  hours: string | null;
  lat: number;
  lng: number;
  distance_km: number;
};

type Origin = { lat: number; lng: number; label: string };

function fmtDistance(km: number): string {
  if (!Number.isFinite(km)) return "";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1).replace(".", ",")} km`;
}

/**
 * Statut ouvert/fermé à partir du champ horaires en texte libre (best-effort).
 * Reconnaît « 08h - 20h », « 8h-20h », « 08:00-20:00 », « 8h à 20h »… Renvoie
 * null si on ne sait pas parser (on n'affiche alors pas de statut).
 */
function openStatus(hours: string | null): boolean | null {
  if (!hours) return null;
  const tokens = [...hours.matchAll(/(\d{1,2})\s*(?:[h:]\s*(\d{2}))?/g)]
    .map((m) => {
      const h = Number(m[1]);
      const min = m[2] ? Number(m[2]) : 0;
      return Number.isFinite(h) && h <= 24 ? h + min / 60 : null;
    })
    .filter((v): v is number => v != null);
  if (tokens.length < 2) return null;
  const open = tokens[0];
  const close = tokens[1];
  const d = new Date();
  const now = ((d.getUTCHours() + 1) % 24) + d.getUTCMinutes() / 60; // Alger UTC+1
  if (close > open) return now >= open && now < close;
  // Plage qui passe minuit (ex. 22h - 06h).
  return now >= open || now < close;
}

/**
 * Annuaire « Où recharger » — points de recharge Agents Coligo Pay proches,
 * triés par distance. Carte + liste, recherche par ville en repli si la
 * géolocalisation est indisponible, itinéraire vers l'app GPS du téléphone.
 *
 * Composant GÉNÉRIQUE réutilisable À L'IDENTIQUE dans tous les espaces
 * (chauffeur, commerçant, livreur, partenaire…). Aucune dépendance au rôle :
 * la source unique est la RPC `recharge_points_nearby`.
 */
export function RechargePoints({
  title = "Où recharger",
  subtitle = "Agents Coligo Pay près de vous pour recharger votre portefeuille en espèces.",
}: {
  title?: string;
  subtitle?: string;
} = {}) {
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [phase, setPhase] = useState<"locating" | "manual" | "ready">(
    "locating"
  );
  const [points, setPoints] = useState<Point[] | null>(null);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [pointsErr, setPointsErr] = useState<string | null>(null);

  const [view, setView] = useState<"map" | "list">("map");
  const [mapFailed, setMapFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [cityQ, setCityQ] = useState("");
  const [citySearching, setCitySearching] = useState(false);
  const [cityErr, setCityErr] = useState<string | null>(null);
  const [showCitySearch, setShowCitySearch] = useState(false);

  const [navFor, setNavFor] = useState<Point | null>(null);

  // ── Géolocalisation avec TIMEOUT DUR (anti-blocage) ─────────────────────
  // getPosition() pend si l'utilisateur ignore le prompt de permission web
  // (le timeout interne ne court qu'après autorisation). On force donc une
  // limite : passé ce délai sans réponse → recherche par ville.
  const locate = useCallback(async () => {
    setPhase("locating");
    setCityErr(null);
    const timeout = new Promise<null>((res) =>
      setTimeout(() => res(null), 9000)
    );
    try {
      const pos = await Promise.race([getPosition(), timeout]);
      if (pos) {
        setOrigin({
          lat: pos.latitude,
          lng: pos.longitude,
          label: "Autour de vous",
        });
        setPhase("ready");
      } else {
        setPhase("manual");
      }
    } catch {
      setPhase("manual");
    }
  }, []);

  useEffect(() => {
    void locate();
  }, [locate]);

  // ── Chargement des points pour l'origine courante ───────────────────────
  const load = useCallback(async (o: Origin, radiusKm?: number) => {
    setLoadingPoints(true);
    setPointsErr(null);
    setSelectedId(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("recharge_points_nearby", {
      p_lat: o.lat,
      p_lng: o.lng,
      p_limit: 50,
      ...(radiusKm ? { p_radius_override: radiusKm } : {}),
    });
    if (error) setPointsErr("Impossible de charger les Agents Coligo Pay.");
    else setPoints((data ?? []) as Point[]);
    setLoadingPoints(false);
  }, []);

  useEffect(() => {
    if (origin)
      void load(origin, origin.label === "Autour de vous" ? undefined : 50);
  }, [origin, load]);

  // ── Recherche par ville / commune (repli + changement de zone) ──────────
  const searchCity = useCallback(async () => {
    const q = cityQ.trim();
    if (q.length < 2) return;
    setCitySearching(true);
    setCityErr(null);
    const hit = await geocodeCommune(q, "");
    setCitySearching(false);
    if (!hit) {
      setCityErr("Ville introuvable. Vérifiez l'orthographe.");
      return;
    }
    setShowCitySearch(false);
    setOrigin({ lat: hit.lat, lng: hit.lng, label: q });
    setPhase("ready");
  }, [cityQ]);

  // ── Itinéraire : ouvre l'app GPS (choix mémorisé au 1er usage) ───────────
  const goItinerary = (p: Point) => {
    const pref = getNavPref();
    if (pref) openNav(pref, p.lat, p.lng);
    else setNavFor(p);
  };

  const mapPoints: MapPoint[] = (points ?? []).map((p) => ({
    wallet_id: p.wallet_id,
    display_name: p.display_name,
    lat: p.lat,
    lng: p.lng,
    distance_km: p.distance_km,
  }));
  const selected = points?.find((p) => p.wallet_id === selectedId) ?? null;
  const showMap =
    view === "map" && !mapFailed && origin && (points?.length ?? 0) > 0;

  return (
    <section className="mx-auto w-full max-w-md">
      <header className="mb-3">
        <h1 className="text-foreground text-lg font-bold">{title}</h1>
        <p className="text-muted text-sm">{subtitle}</p>
      </header>

      {/* Localisation en cours */}
      {phase === "locating" && (
        <div className="text-muted flex items-center justify-center gap-2 py-10 text-sm">
          <Loader2 className="size-4 animate-spin" /> Localisation…
        </div>
      )}

      {/* Géoloc indisponible → recherche par ville (repli premier rang) */}
      {phase === "manual" && !origin && (
        <div className="border-border bg-surface rounded-[16px] border p-4">
          <div className="mb-2 flex items-center gap-2">
            <MapPin className="text-primary-600 size-5 shrink-0" />
            <p className="text-foreground text-sm font-semibold">
              Localisation indisponible
            </p>
          </div>
          <p className="text-muted mb-3 text-xs">
            Recherchez par ville ou commune pour trouver un Agent Coligo Pay.
          </p>
          <CitySearchInput
            value={cityQ}
            onChange={setCityQ}
            onSubmit={searchCity}
            busy={citySearching}
          />
          {cityErr && <p className="text-danger-700 mt-2 text-xs">{cityErr}</p>}
          <button
            type="button"
            onClick={() => void locate()}
            className="text-primary-700 mt-3 inline-flex items-center gap-1.5 text-sm font-semibold"
          >
            <RefreshCw className="size-4" /> Réessayer la localisation
          </button>
        </div>
      )}

      {/* Origine prête : barre de contrôle + contenu */}
      {phase === "ready" && origin && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowCitySearch((v) => !v)}
              className="border-border bg-surface text-foreground inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold"
            >
              <MapPin className="text-primary-600 size-3.5" />
              <span className="max-w-[160px] truncate">{origin.label}</span>
              <Search className="text-subtle size-3.5" />
            </button>

            <div className="bg-surface-2 inline-flex rounded-full p-0.5">
              <ToggleBtn
                active={view === "map"}
                onClick={() => setView("map")}
                icon={<MapIcon className="size-3.5" />}
                label="Carte"
              />
              <ToggleBtn
                active={view === "list"}
                onClick={() => setView("list")}
                icon={<List className="size-3.5" />}
                label="Liste"
              />
            </div>
          </div>

          {showCitySearch && (
            <div className="border-border bg-surface mb-3 rounded-[14px] border p-3">
              <CitySearchInput
                value={cityQ}
                onChange={setCityQ}
                onSubmit={searchCity}
                busy={citySearching}
              />
              {cityErr && (
                <p className="text-danger-700 mt-2 text-xs">{cityErr}</p>
              )}
              <button
                type="button"
                onClick={() => void locate()}
                className="text-primary-700 mt-2 inline-flex items-center gap-1.5 text-xs font-semibold"
              >
                <Navigation className="size-3.5" /> Utiliser ma position
              </button>
            </div>
          )}

          {loadingPoints && (
            <div className="text-muted flex items-center justify-center gap-2 py-10 text-sm">
              <Loader2 className="size-4 animate-spin" /> Recherche des points…
            </div>
          )}

          {pointsErr && !loadingPoints && (
            <div className="border-border bg-surface text-foreground rounded-[16px] border p-4 text-center text-sm">
              {pointsErr}
              <button
                type="button"
                onClick={() => void load(origin)}
                className="text-primary-600 mt-2 block w-full text-sm font-semibold"
              >
                Réessayer
              </button>
            </div>
          )}

          {!loadingPoints && !pointsErr && points && points.length === 0 && (
            <div className="border-border bg-surface rounded-[16px] border p-6 text-center">
              <Store className="text-subtle mx-auto mb-2 size-6" />
              <p className="text-foreground text-sm font-medium">
                Aucun Agent Coligo Pay à proximité
              </p>
              <p className="text-muted mt-1 text-xs">
                Essayez une autre ville, ou rechargez par carte (Chargily) ou
                virement.
              </p>
            </div>
          )}

          {/* Vue CARTE */}
          {!loadingPoints && !pointsErr && showMap && (
            <div className="relative">
              <RechargePointsMap
                origin={origin}
                points={mapPoints}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onMapError={() => {
                  setMapFailed(true);
                  setView("list");
                }}
                height={340}
              />
              {selected && (
                <div className="absolute inset-x-2 bottom-2">
                  <PointCard
                    p={selected}
                    onItinerary={() => goItinerary(selected)}
                    onClose={() => setSelectedId(null)}
                    floating
                  />
                </div>
              )}
              {!selected && (
                <p className="text-muted mt-2 text-center text-xs">
                  Touchez un point sur la carte pour voir ses informations.
                </p>
              )}
            </div>
          )}

          {/* Vue LISTE */}
          {!loadingPoints &&
            !pointsErr &&
            points &&
            points.length > 0 &&
            (view === "list" || mapFailed || !showMap) && (
              <ul className="space-y-3">
                {points.map((p) => (
                  <li key={p.wallet_id}>
                    <PointCard p={p} onItinerary={() => goItinerary(p)} />
                  </li>
                ))}
              </ul>
            )}
        </>
      )}

      {/* Sélecteur d'app GPS (1er itinéraire) */}
      {navFor && (
        <NavAppPicker
          onPick={(app) => {
            setNavPref(app);
            openNav(app, navFor.lat, navFor.lng);
            setNavFor(null);
          }}
          onClose={() => setNavFor(null)}
        />
      )}
    </section>
  );
}

function ToggleBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
        (active ? "bg-primary-600 text-white" : "text-muted")
      }
    >
      {icon}
      {label}
    </button>
  );
}

function CitySearchInput({
  value,
  onChange,
  onSubmit,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex gap-2">
      <div className="border-border bg-surface flex flex-1 items-center gap-2 rounded-full border px-3 py-2">
        <Search className="text-subtle size-4 shrink-0" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit();
          }}
          placeholder="Ville ou commune (ex. Oran, Bab Ezzouar)"
          className="placeholder:text-subtle min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={busy || value.trim().length < 2}
        className="bg-primary-600 inline-flex items-center justify-center rounded-full px-4 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : "Chercher"}
      </button>
    </div>
  );
}

function PointCard({
  p,
  onItinerary,
  onClose,
  floating = false,
}: {
  p: Point;
  onItinerary: () => void;
  onClose?: () => void;
  floating?: boolean;
}) {
  const open = openStatus(p.hours);
  return (
    <div
      className={
        "border-border bg-surface rounded-[16px] border p-4 " +
        (floating ? "shadow-xl" : "shadow-sm")
      }
    >
      <div className="flex items-start gap-3">
        <span className="bg-primary-50 text-primary-600 flex size-10 shrink-0 items-center justify-center rounded-full">
          <Store className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-foreground truncate text-sm font-semibold">
              {p.display_name ?? "Agent Coligo Pay"}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="bg-primary-50 text-primary-700 rounded-full px-2 py-0.5 text-[11px] font-bold">
                {fmtDistance(p.distance_km)}
              </span>
              {onClose && (
                <button
                  type="button"
                  aria-label="Fermer"
                  onClick={onClose}
                  className="text-subtle hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          </div>
          {open !== null && (
            <span
              className={
                "mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold " +
                (open
                  ? "bg-success-100 text-success-700"
                  : "bg-danger-100 text-danger-700")
              }
            >
              <Clock className="size-3" />
              {open ? "Ouvert" : "Fermé"}
            </span>
          )}
          {p.address && (
            <p className="text-muted mt-0.5 truncate text-xs">{p.address}</p>
          )}
          {p.hours && (
            <p className="text-subtle mt-0.5 text-xs">🕒 {p.hours}</p>
          )}
          {p.phone && <p className="text-subtle text-xs">📞 {p.phone}</p>}
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onItinerary}
          className="bg-primary-600 inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-white"
        >
          <Navigation className="size-4" /> Itinéraire
        </button>
        {p.phone && (
          <a
            href={`tel:${p.phone}`}
            className="border-border text-foreground inline-flex items-center justify-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold"
          >
            <Phone className="size-4" /> Appeler
          </a>
        )}
      </div>
    </div>
  );
}

function NavAppPicker({
  onPick,
  onClose,
}: {
  onPick: (app: (typeof NAV_APPS)[number]["id"]) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="bg-surface w-full max-w-sm rounded-[18px] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-foreground mb-1 text-base font-bold">
          Ouvrir l&apos;itinéraire avec
        </h2>
        <p className="text-muted mb-3 text-xs">
          Votre choix sera mémorisé pour la prochaine fois.
        </p>
        <div className="space-y-2">
          {NAV_APPS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onPick(a.id)}
              className="border-border hover:bg-surface-2 flex w-full items-center gap-3 rounded-[12px] border px-3 py-2.5 text-left text-sm font-semibold"
            >
              <span className="text-lg">{a.emoji}</span>
              {a.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-muted mt-3 w-full text-center text-sm font-medium"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
