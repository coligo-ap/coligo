"use client";

import { useCallback, useEffect, useState } from "react";
import { getPosition } from "@/lib/native/geolocation";
import { createClient } from "@/lib/supabase/client";
import { geocodeCommune } from "@/lib/geo/geocode";
import {
  NAV_APPS,
  getNavPref,
  openNav,
  setNavPref,
  type NavApp,
} from "@/lib/drive/nav";
import {
  RechargePointsMap,
  type MapPoint,
} from "@/components/wallet/recharge-points-map";
import { Ico } from "./operator-recharge-icons";
import { STR, type Lang } from "./operator-recharge-strings";

function fmtDistance(km: number): string {
  if (!Number.isFinite(km)) return "";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1).replace(".", ",")} km`;
}

/** Ouvert/fermé best-effort à partir d'un champ horaires en texte libre. */
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
  return now >= open || now < close;
}

/* ────────────────────── Panneau Espèces : annuaire agents ──────────────── */
type Point = {
  wallet_id: string;
  display_name: string | null;
  address: string | null;
  phone: string | null;
  hours: string | null;
  lat: number;
  lng: number;
  distance_km: number;
  /* Enrichissements mig 0428 : de quoi décider SANS se déplacer pour rien. */
  is_verified: boolean | null;
  wilaya: string | null;
  commune: string | null;
  owner_name: string | null;
  since: string | null;
};
type Origin = { lat: number; lng: number; label: string };

export function CashFinder({ t }: { t: (typeof STR)[Lang] }) {
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [phase, setPhase] = useState<"locating" | "manual" | "ready">(
    "locating"
  );
  const [points, setPoints] = useState<Point[] | null>(null);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [view, setView] = useState<"list" | "map">("list");
  const [mapFailed, setMapFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cityQ, setCityQ] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [citySearching, setCitySearching] = useState(false);
  const [cityErr, setCityErr] = useState<string | null>(null);
  const [navFor, setNavFor] = useState<Point | null>(null);
  // Filtre d'affichage — on ne relance JAMAIS la requête pour ça (le tri se
  // fait sur la liste déjà chargée : réponse instantanée au tap).
  const [filter, setFilter] = useState<"all" | "open" | "verified">("all");
  // Fiche dépliée (liste fermée/ouvrante) : une seule à la fois, pour que la
  // liste reste lisible sur un téléphone.
  const [openId, setOpenId] = useState<string | null>(null);

  const locate = useCallback(async () => {
    setPhase("locating");
    setCityErr(null);
    const timeout = new Promise<null>((res) =>
      setTimeout(() => res(null), 9000)
    );
    try {
      const pos = await Promise.race([getPosition(), timeout]);
      if (pos) {
        setOrigin({ lat: pos.latitude, lng: pos.longitude, label: t.around });
        setPhase("ready");
      } else {
        setPhase("manual");
        setShowSearch(true);
      }
    } catch {
      setPhase("manual");
      setShowSearch(true);
    }
  }, [t.around]);

  useEffect(() => {
    void locate();
  }, [locate]);

  const load = useCallback(async (o: Origin) => {
    setLoadingPoints(true);
    setSelectedId(null);
    const supabase = createClient();
    const { data } = await supabase.rpc("recharge_points_nearby", {
      p_lat: o.lat,
      p_lng: o.lng,
      p_limit: 50,
      ...(o.label === t.around ? {} : { p_radius_override: 50 }),
    });
    setPoints((data ?? []) as Point[]);
    setLoadingPoints(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (origin) void load(origin);
  }, [origin, load]);

  const searchCity = useCallback(async () => {
    const q = cityQ.trim();
    if (q.length < 2) return;
    setCitySearching(true);
    setCityErr(null);
    const hit = await geocodeCommune(q, "");
    setCitySearching(false);
    if (!hit) {
      setCityErr(t.cityNotFound);
      return;
    }
    setShowSearch(false);
    setOrigin({ lat: hit.lat, lng: hit.lng, label: q });
    setPhase("ready");
  }, [cityQ, t.cityNotFound]);

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
  // Filtrage LOCAL (aucune requête) : « Ouverts » s'appuie sur les horaires
  // déclarés, « Vérifiés » sur le contrôle fait par l'équipe Coligo.
  const shown = (points ?? []).filter((p) => {
    if (filter === "verified") return p.is_verified === true;
    if (filter === "open") return openStatus(p.hours) === true;
    return true;
  });
  const selected = points?.find((p) => p.wallet_id === selectedId) ?? null;
  const showMap =
    view === "map" && !mapFailed && origin && (points?.length ?? 0) > 0;

  return (
    <div className="cash">
      {/* Barre recherche + bascule Liste/Carte */}
      <div className="findrow">
        <div className="loc" onClick={() => setShowSearch((v) => !v)}>
          {Ico.pin}
          <span className="loc-lbl">{origin?.label ?? t.cityPlaceholder}</span>
          <span className="mag">{Ico.search}</span>
        </div>
        <div className="vl">
          <button
            className={view === "list" ? "on" : ""}
            onClick={() => setView("list")}
          >
            {Ico.liste}
            {t.list}
          </button>
          <button
            className={view === "map" ? "on" : ""}
            onClick={() => setView("map")}
          >
            {Ico.mapIco}
            {t.map}
          </button>
        </div>
      </div>

      {showSearch && (
        <div className="citybox">
          <input
            className="inp"
            value={cityQ}
            onChange={(e) => setCityQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void searchCity();
            }}
            placeholder={t.cityPlaceholder}
          />
          <button
            className="citybtn"
            type="button"
            disabled={citySearching || cityQ.trim().length < 2}
            onClick={() => void searchCity()}
          >
            {citySearching ? Ico.spinner : t.search}
          </button>
        </div>
      )}
      {cityErr && <div className="cgw-err">{cityErr}</div>}

      <div className="useloc" onClick={() => void locate()}>
        {Ico.send}
        {t.useMyPos}
      </div>

      {/* Filtres — le partenaire trie en un tap, sans nouvelle recherche. */}
      {!loadingPoints && points && points.length > 0 && (
        <div className="agfilters">
          {(
            [
              ["all", t.filterAll],
              ["open", t.filterOpen],
              ["verified", t.filterVerified],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={filter === id ? "on" : ""}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
          <span className="agcount">
            {shown.length} {t.agentsCount}
          </span>
        </div>
      )}

      {(phase === "locating" || loadingPoints) && (
        <div className="cgw-mini-load">
          <span className="cgw-ret-ic">{Ico.spinner}</span>
          {phase === "locating" ? t.locating : t.searching}
        </div>
      )}

      {/* Carte */}
      {!loadingPoints && showMap && origin && (
        <div style={{ position: "relative" }}>
          <RechargePointsMap
            origin={origin}
            points={mapPoints}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMapError={() => {
              setMapFailed(true);
              setView("list");
            }}
            height={300}
          />
          {selected && (
            <div style={{ marginTop: 10 }}>
              <AgentCard
                p={selected}
                t={t}
                expanded
                onToggle={() => setSelectedId(null)}
                onItinerary={() => goItinerary(selected)}
              />
            </div>
          )}
          {!selected && <p className="cgw-hint">{t.tapPoint}</p>}
        </div>
      )}

      {/* Liste */}
      {!loadingPoints &&
        phase === "ready" &&
        (view === "list" || mapFailed || !showMap) &&
        points &&
        shown.length > 0 &&
        shown.map((p) => (
          <AgentCard
            key={p.wallet_id}
            p={p}
            t={t}
            expanded={openId === p.wallet_id}
            onToggle={() =>
              setOpenId((id) => (id === p.wallet_id ? null : p.wallet_id))
            }
            onItinerary={() => goItinerary(p)}
          />
        ))}

      {/* Vide */}
      {!loadingPoints && phase === "ready" && points && points.length === 0 && (
        <div className="empty">
          <div className="ei">{Ico.store}</div>
          <b>{t.emptyTitle}</b>
          <span>{t.emptySub}</span>
        </div>
      )}

      {navFor && (
        <NavPicker
          t={t}
          onPick={(app) => {
            setNavPref(app);
            openNav(app, navFor.lat, navFor.lng);
            setNavFor(null);
          }}
          onClose={() => setNavFor(null)}
        />
      )}
    </div>
  );
}

/**
 * Fiche agent — REPLIÉE par défaut (une ligne dense : nom, zone, distance,
 * ouvert/fermé, badge vérifié), DÉPLIABLE d'un tap pour tout le reste
 * (adresse complète, horaires, responsable, ancienneté, appeler, itinéraire).
 *
 * Pourquoi ce découpage : sur un téléphone, une liste d'agents tous « pleins »
 * devient illisible et oblige à faire défiler pour comparer. On montre donc
 * d'abord ce qui sert à CHOISIR, et le détail à la demande.
 */
function AgentCard({
  p,
  t,
  expanded,
  onToggle,
  onItinerary,
}: {
  p: Point;
  t: (typeof STR)[Lang];
  expanded: boolean;
  onToggle: () => void;
  onItinerary: () => void;
}) {
  const open = openStatus(p.hours);
  const zone = [p.commune, p.wilaya].filter(Boolean).join(" · ");
  const year = p.since ? new Date(p.since).getFullYear() : null;

  return (
    <div className={expanded ? "agent open" : "agent"}>
      {/* Ligne repliée — cliquable en entier (cible tactile large). */}
      <button type="button" className="aghead" onClick={onToggle}>
        <span className="ai">{Ico.store}</span>
        <span className="am">
          <b>
            {p.display_name ?? "Agent Coligo Pay"}
            {p.is_verified && (
              <i className="agbadge" title={t.agentVerified}>
                ✓
              </i>
            )}
          </b>
          <span className="agmeta">
            {zone || p.address}
            {open !== null && (
              <i className={open ? "agopen" : "agclosed"}>
                {open ? t.openNow : t.closedNow}
              </i>
            )}
          </span>
        </span>
        <span className="dist">{fmtDistance(p.distance_km)}</span>
      </button>

      {expanded && (
        <div className="agbody">
          <Row label={t.agentCashOnly} value={p.address ?? "—"} />
          <Row label={t.filterOpen} value={p.hours ?? t.agentNoHours} />
          {p.owner_name && <Row label="Responsable" value={p.owner_name} />}
          {year && <Row label={t.agentSince} value={String(year)} />}
          <div className="agactions">
            {p.phone ? (
              <a className="miniroute" href={`tel:${p.phone}`}>
                {Ico.send}
                {t.agentCall}
              </a>
            ) : (
              <span className="agnophone">{t.agentNoPhone}</span>
            )}
            <button className="miniroute" type="button" onClick={onItinerary}>
              {Ico.send}
              {t.itinerary}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Ligne d'information du détail (libellé à gauche, valeur à droite). */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="agrow">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function NavPicker({
  t,
  onPick,
  onClose,
}: {
  t: (typeof STR)[Lang];
  onPick: (app: NavApp) => void;
  onClose: () => void;
}) {
  return (
    <div className="cgw-sheet" onClick={onClose}>
      <div className="cgw-sheet-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="cgw-sheet-t">{t.openWith}</h2>
        <p className="cgw-sheet-s">{t.openWithSub}</p>
        {NAV_APPS.map((a) => (
          <button
            key={a.id}
            type="button"
            className="cgw-sheet-row"
            onClick={() => onPick(a.id)}
          >
            <span style={{ fontSize: 18 }}>{a.emoji}</span>
            {a.label}
          </button>
        ))}
        <button type="button" className="cgw-sheet-cancel" onClick={onClose}>
          {t.cancel}
        </button>
      </div>
    </div>
  );
}
