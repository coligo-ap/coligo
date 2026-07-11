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
        points.length > 0 &&
        points.map((p) => (
          <AgentCard
            key={p.wallet_id}
            p={p}
            t={t}
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

function AgentCard({
  p,
  t,
  onItinerary,
}: {
  p: Point;
  t: (typeof STR)[Lang];
  onItinerary: () => void;
}) {
  const open = openStatus(p.hours);
  const sub = [p.address, p.hours].filter(Boolean).join(" · ");
  return (
    <div className="agent">
      <div className="ai">{Ico.store}</div>
      <div className="am">
        <b>{p.display_name ?? "Agent Coligo Pay"}</b>
        <span>
          {sub}
          {open !== null && ` · ${open ? t.openNow : t.closedNow}`}
        </span>
        <button className="miniroute" type="button" onClick={onItinerary}>
          {Ico.send}
          {t.itinerary}
        </button>
      </div>
      <div className="dist">{fmtDistance(p.distance_km)}</div>
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
