"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Car,
  ChevronUp,
  Crosshair,
  Home,
  Loader2,
  MapPin,
  Pencil,
  X,
} from "lucide-react";
import { formatDA } from "@/lib/utils";
import { useDriverPosition } from "@/lib/native/use-driver-position";
import { getPosition } from "@/lib/native/geolocation";
import { reverseGeocode } from "@/lib/geo/geocode";
import { createClient } from "@/lib/supabase/client";
import { PushRegistrar } from "@/components/native/push-registrar";
import { DriveMap, type LatLng } from "@/components/customer/drive/drive-map";
import { MapPositionPicker } from "@/components/shared/map-position-picker";
import {
  VIOLET,
  GO,
  RED,
  PrimaryBtn,
} from "@/components/customer/drive/drive-modals";
import { DNav, PlanIcon, PLAN_LABEL, fmtPct } from "./d-ui";
import { ChauffeurWorkZoneSheet } from "./work-zone-sheet";
import { useWorkZone } from "@/lib/chauffeur/work-zone";
import { formatOnline, HOME_DIR_KEY } from "@/lib/drive/geo";
import {
  activateHomeDir,
  chauffeurHeartbeat,
  getChauffeurActiveRide,
  getDriveHome,
  setChauffeurHome,
  setChauffeurOnline,
  type ChauffeurGate,
  type DriveHome,
} from "@/app/(chauffeur)/actions";

/** Dernier choix en ligne / hors ligne (persisté en local). */
const ONLINE_KEY = "coligo-drive-online";

const GAMME_LABEL: Record<string, string> = {
  classic: "Classic",
  confort: "Confort",
  moto: "Moto",
};
const GAMME_RECEIVES: Record<string, string> = {
  classic: "Classic",
  confort: "Classic + Confort",
  moto: "Moto",
};

/**
 * Accueil chauffeur (maquette s-dhome) : heatmap des zones de demande,
 * feuille réductible, gains du jour, « je rentre chez moi » (adresse
 * modifiable, 2 activations/jour), bandeau gamme, carte abonnement.
 */
export function DHome({ gate }: { gate: ChauffeurGate }) {
  const router = useRouter();
  const coords = useDriverPosition();
  const [home, setHome] = useState<DriveHome | null>(null);
  const [mini, setMini] = useState(false);
  const [dirOn, setDirOn] = useState(false);
  useEffect(() => {
    setDirOn(localStorage.getItem(HOME_DIR_KEY) === "1");
  }, []);
  const [dirMsg, setDirMsg] = useState<string | null>(null);
  const [homeAddr, setHomeAddr] = useState(gate.homeAddr);
  // Zone de travail (centre + rayon) — dispatch enforcé serveur si définie.
  const [zoneOpen, setZoneOpen] = useState(false);
  const workZone = useWorkZone();
  const coordsRef = useRef(coords);
  coordsRef.current = coords;

  // En ligne / hors ligne : le chauffeur choisit (bouton GO), choix persisté.
  const [online, setOnline] = useState(false);
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const [onlineBusy, setOnlineBusy] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem(ONLINE_KEY) === "1";
    setOnline(saved);
    onlineRef.current = saved;
  }, []);

  const toggleOnline = async () => {
    if (onlineBusy) return;
    const next = !onlineRef.current;
    setOnlineBusy(true);
    setOnline(next);
    onlineRef.current = next;
    localStorage.setItem(ONLINE_KEY, next ? "1" : "0");
    // Bascule serveur immédiate (le heartbeat suivant entretient l'état).
    await setChauffeurOnline(next);
    const c = coordsRef.current;
    if (c) void chauffeurHeartbeat(c.latitude, c.longitude, next);
    setOnlineBusy(false);
  };

  // Présence (en ligne) + rafraîchissement accueil + détection course active.
  const tick = useCallback(async () => {
    const c = coordsRef.current;
    if (c) void chauffeurHeartbeat(c.latitude, c.longitude, onlineRef.current);
    const [h, active] = await Promise.all([
      getDriveHome(c?.latitude ?? null, c?.longitude ?? null),
      getChauffeurActiveRide(),
    ]);
    if (active) {
      router.replace("/chauffeur/course");
      return;
    }
    setHome(h);
  }, [router]);
  useEffect(() => {
    void tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [tick]);

  // Temps réel : une nouvelle demande proche met à jour le compteur
  // instantanément (sans attendre le tick de 15 s) → diffusion plus rapide.
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel("home-nearby-rides")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "rides" },
        () => void tick()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [tick]);

  // Dès la 1re position GPS connue : recharger immédiatement le compteur de
  // demandes proches (sans attendre le tick de 15 s).
  const gotFirstFix = useRef(false);
  useEffect(() => {
    if (coords && !gotFirstFix.current) {
      gotFirstFix.current = true;
      void tick();
    }
  }, [coords, tick]);

  // Domicile : popup carte (recherche + repère) — plus de prompt texte.
  // Le changement d'adresse est LIMITÉ côté serveur (1×/semaine, anti-fraude).
  const [homeOpen, setHomeOpen] = useState(false);
  const [homePos, setHomePos] = useState<LatLng | null>(null);
  const [homeSaving, setHomeSaving] = useState(false);
  const [homeErr, setHomeErr] = useState<string | null>(null);

  const saveHome = async () => {
    if (!homePos || homeSaving) return;
    setHomeSaving(true);
    setHomeErr(null);
    // Adresse lisible du repère (échec silencieux → libellé générique).
    const text =
      (await reverseGeocode(homePos.lat, homePos.lng).catch(() => null)) ??
      "Domicile (repère carte)";
    const res = await setChauffeurHome(text, homePos);
    setHomeSaving(false);
    if (!res.ok) {
      setHomeErr(res.error ?? "Enregistrement impossible.");
      return;
    }
    setHomeAddr(text);
    setHomeOpen(false);
  };

  // Recentrage de la carte sur la position actuelle du chauffeur.
  const [focusMe, setFocusMe] = useState<(LatLng & { zoom?: number }) | null>(
    null
  );
  const recenter = async () => {
    const c = coordsRef.current;
    if (c) {
      setFocusMe({ lat: c.latitude, lng: c.longitude, zoom: 16 });
      return;
    }
    try {
      const p = await getPosition({ enableHighAccuracy: true, timeout: 8000 });
      setFocusMe({ lat: p.latitude, lng: p.longitude, zoom: 16 });
    } catch {
      /* géoloc refusée */
    }
  };

  const toggleDir = async () => {
    setDirMsg(null);
    if (dirOn) {
      setDirOn(false);
      localStorage.setItem(HOME_DIR_KEY, "0");
      return;
    }
    const res = await activateHomeDir();
    if (res.ok) {
      setDirOn(true);
      localStorage.setItem(HOME_DIR_KEY, "1");
      if (res.remaining != null)
        setDirMsg(
          `Activé · ${res.remaining} activation(s) restante(s) aujourd'hui`
        );
    } else {
      setDirMsg(res.error ?? "Activation impossible");
    }
  };

  const me = coords ? { lat: coords.latitude, lng: coords.longitude } : null;
  const reqCount = home?.requestsCount ?? 0;
  const hasReqs = online && reqCount > 0;

  return (
    <div className="drive-jakarta drive-screen bg-[var(--d-page)]">
      <DriveMap
        markers={me ? [{ id: "me", pos: me, kind: "me" }] : []}
        heatZones={home?.heatZones ?? []}
        focusTarget={focusMe}
        padding={{ top: 110, bottom: 460, left: 60, right: 60 }}
      />
      {/* Pill état en ligne / hors ligne */}
      <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[var(--d-surface)] px-4 py-2 text-[13.5px] font-bold shadow-lg">
        <span
          className={`size-2 rounded-full ${online ? "animate-pulse" : ""}`}
          style={{ background: online ? GO : "#9CA3AF" }}
        />
        <span className="drive-sora">
          {online ? "En ligne · Drive" : "Hors ligne"}
        </span>
      </div>
      {/* Légende heatmap */}
      <div className="absolute top-[64px] left-4 z-10 flex items-center gap-1.5 rounded-full border border-[var(--d-line)] bg-[var(--d-surface)] px-2.5 py-1.5 text-[10.5px] font-bold text-[var(--d-muted)] shadow">
        <span
          className="size-2.5 rounded-full"
          style={{
            background: `radial-gradient(circle,${VIOLET},transparent 75%)`,
          }}
        />
        Zones de forte demande
      </div>
      {/* Recentrer la carte sur ma position (curseur chauffeur) */}
      <button
        type="button"
        onClick={() => void recenter()}
        aria-label="Centrer sur ma position"
        className="absolute top-[64px] right-4 z-10 grid size-[42px] place-items-center rounded-full border border-[var(--d-line)] bg-[var(--d-surface)] shadow-lg"
      >
        <Crosshair className="size-5" style={{ color: VIOLET }} />
      </button>

      {/* Feuille réductible */}
      <div
        className="absolute right-0 bottom-[66px] left-0 z-10 overflow-hidden rounded-t-[28px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-2 pb-4 transition-[max-height] duration-300"
        style={{ maxHeight: mini ? 96 : 540 }}
      >
        <button
          type="button"
          onClick={() => setMini((m) => !m)}
          className="mx-auto block cursor-pointer px-10 py-1.5"
          aria-label="Réduire / agrandir"
        >
          <span className="block h-[5px] w-[42px] rounded-full bg-[var(--d-line)]" />
        </button>
        <button
          type="button"
          onClick={() => setMini((m) => !m)}
          className="drive-sora flex w-full items-center justify-between gap-2 text-[21px] font-extrabold tracking-[-0.5px]"
        >
          <span className="flex min-w-0 items-center gap-2">
            {online ? (
              home ? (
                hasReqs ? (
                  <>
                    <span
                      key={reqCount}
                      className="drive-pop drive-badge grid min-w-[34px] shrink-0 place-items-center rounded-full px-2 py-0.5 text-[17px] text-white"
                      style={{ background: GO }}
                    >
                      {reqCount}
                    </span>
                    <span className="truncate">
                      demande{reqCount > 1 ? "s" : ""} proche
                      {reqCount > 1 ? "s" : ""}
                    </span>
                  </>
                ) : (
                  "Aucune demande proche"
                )
              ) : (
                "Demandes proches…"
              )
            ) : (
              "Vous êtes hors ligne"
            )}
          </span>
          <ChevronUp
            className="size-[18px] shrink-0 text-[var(--d-muted)] transition-transform duration-300"
            style={{ transform: mini ? "rotate(180deg)" : undefined }}
          />
        </button>
        <p className="mb-3 text-[13px] text-[var(--d-muted)]">
          {online
            ? hasReqs
              ? "Des clients attendent un chauffeur autour de vous — répondez vite !"
              : "Restez en ligne, les demandes arrivent."
            : "Passez en ligne pour commencer à recevoir les courses."}
        </p>

        {/* Gains du jour */}
        <div className="mb-3 rounded-[16px] bg-[var(--d-soft)] px-3.5 py-3">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span>Gains du jour</span>
            <b className="drive-sora text-[17px]">
              {formatDA(home?.todayNet ?? 0)}
            </b>
          </div>
          <p className="mt-1.5 text-[10.5px] text-[var(--d-muted)]">
            {home?.todayRides ?? 0} courses ·{" "}
            {formatOnline(home?.todayOnlineMin ?? 0)}
            {home && home.todayRides > 0
              ? ` · moy. ${formatDA(Math.round(home.todayNet / home.todayRides))}/course`
              : ""}
          </p>
        </div>

        {/* Je rentre chez moi */}
        <div
          className="mb-3 flex items-center gap-2.5 rounded-[14px] px-3.5 py-3"
          style={{ background: "#EEEEFD" }}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--d-surface)]">
            <Home className="size-4" style={{ color: VIOLET }} />
          </span>
          <span className="min-w-0 flex-1">
            <b
              className="flex items-center gap-1.5 text-[12.5px]"
              style={{ color: VIOLET }}
            >
              Je rentre chez moi · {homeAddr ?? "—"}
              <button
                type="button"
                onClick={() => {
                  setHomeErr(null);
                  setHomePos(null);
                  setHomeOpen(true);
                }}
                aria-label="Modifier l'adresse"
              >
                <Pencil className="size-3" style={{ color: VIOLET }} />
              </button>
            </b>
            <span className="block truncate text-[10.5px] text-[var(--d-muted)]">
              {dirMsg ??
                (dirOn
                  ? `Actif · seules les courses vers ${homeAddr ?? "chez vous"} sonneront`
                  : "Ne recevoir que les courses dans cette direction")}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={dirOn}
            onClick={toggleDir}
            className="relative h-7 w-12 shrink-0 rounded-full transition-colors"
            style={{ background: dirOn ? VIOLET : "#fff" }}
          >
            <span
              className="absolute top-[3px] size-[22px] rounded-full bg-white shadow transition-all"
              style={{
                left: dirOn ? 23 : 3,
                boxShadow: "0 2px 4px rgba(0,0,0,.2)",
              }}
            />
          </button>
        </div>

        {/* Ma zone de travail (centre + rayon, ou « autour de moi ») */}
        <button
          type="button"
          onClick={() => setZoneOpen(true)}
          className="mb-3 flex w-full items-center gap-2.5 rounded-[14px] px-3.5 py-3 text-left"
          style={{ background: "#EEEEFD" }}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--d-surface)]">
            {workZone ? (
              <MapPin className="size-4" style={{ color: VIOLET }} />
            ) : (
              <Crosshair className="size-4" style={{ color: VIOLET }} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[12.5px]" style={{ color: VIOLET }}>
              {workZone
                ? `Ma zone · ${workZone.radiusKm} km`
                : "Ma zone de travail"}
            </b>
            <span className="block truncate text-[10.5px] text-[var(--d-muted)]">
              {workZone
                ? "Seules les courses de cette zone vous sont proposées"
                : "Autour de moi · appuyez pour définir une zone"}
            </span>
          </span>
          <Pencil className="size-3.5 shrink-0" style={{ color: VIOLET }} />
        </button>

        {/* Bandeau gamme */}
        <div className="mb-3 flex items-center gap-2.5 rounded-[14px] bg-[var(--d-soft)] px-3.5 py-2.5 text-xs font-semibold text-[var(--d-muted)]">
          <span
            className="grid size-[30px] shrink-0 place-items-center rounded-[9px]"
            style={{ background: "#EEEEFD" }}
          >
            <Car className="size-4" style={{ color: VIOLET }} />
          </span>
          <span>
            Votre gamme :{" "}
            <b className="text-[var(--d-ink)]">{GAMME_LABEL[gate.gamme]}</b> —
            vous recevez les courses{" "}
            <b className="text-[var(--d-ink)]">{GAMME_RECEIVES[gate.gamme]}</b>
          </span>
        </div>

        {/* Carte abonnement */}
        <button
          type="button"
          onClick={() => router.push("/chauffeur/abonnement")}
          className="mb-3 flex w-full items-center gap-2.5 rounded-[15px] border border-[var(--d-line)] p-3 text-left"
        >
          <PlanIcon plan={home?.plan ?? "free"} />
          <span className="min-w-0 flex-1">
            <b className="block text-[13.5px]">
              Abonnement : {PLAN_LABEL[home?.plan ?? "free"]}
            </b>
            <span className="text-[11px] text-[var(--d-muted)]">
              {home?.plan === "premium"
                ? "0 % de commission · priorité dispatch"
                : home?.plan === "pro"
                  ? `Commission ${fmtPct(home.planRate)} · 1 500 DA/mois`
                  : "Commission 8 % · passez en Premium = 0 %"}
            </span>
          </span>
          <span className="text-[var(--d-muted)]">›</span>
        </button>

        {online ? (
          <>
            <PrimaryBtn
              onClick={() => router.push("/chauffeur/demandes")}
              className={hasReqs ? "drive-attn !mt-0" : "!mt-0"}
            >
              {hasReqs ? (
                <>
                  Voir les {reqCount} demande{reqCount > 1 ? "s" : ""}
                  <span className="drive-badge grid size-6 place-items-center rounded-full bg-white/25 text-sm">
                    →
                  </span>
                </>
              ) : (
                "Voir les demandes"
              )}
            </PrimaryBtn>
            <button
              type="button"
              disabled={onlineBusy}
              onClick={() => void toggleOnline()}
              className="drive-sora mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-[14px] border text-[13.5px] font-bold disabled:opacity-50"
              style={{
                borderColor: "rgba(229,72,77,.35)",
                color: RED,
                background: "rgba(229,72,77,.06)",
              }}
            >
              {onlineBusy ? <Loader2 className="size-4 animate-spin" /> : null}
              Se mettre hors ligne
            </button>
          </>
        ) : (
          <PrimaryBtn
            onClick={() => void toggleOnline()}
            disabled={onlineBusy}
            color={GO}
            className="!mt-0"
          >
            {onlineBusy ? <Loader2 className="size-5 animate-spin" /> : null}
            Passer en ligne · GO
          </PrimaryBtn>
        )}
      </div>

      {/* Popup domicile : recherche d'adresse + repère sur la carte. */}
      {homeOpen && (
        <div className="fixed inset-0 z-[130] flex flex-col justify-end bg-black/45">
          <div className="drive-jakarta rounded-t-[24px] bg-[var(--d-surface)] p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
            <div className="mb-2 flex items-center justify-between">
              <b className="drive-sora text-[16px] font-extrabold">
                Mon domicile
              </b>
              <button
                type="button"
                onClick={() => setHomeOpen(false)}
                aria-label="Fermer"
                className="grid size-9 place-items-center rounded-full bg-[var(--d-soft)]"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="mb-2 text-[12px] text-[var(--d-muted)]">
              Cherchez votre adresse ou déplacez la carte pour placer le repère
              sur votre domicile.
            </p>
            <MapPositionPicker
              initial={null}
              defaultCenter={me ?? undefined}
              autoLocate={!me}
              searchEnabled
              height={300}
              gpsLabel="Ma position"
              onChange={(p) => setHomePos(p)}
            />
            <p className="mt-2 text-[11px] text-[var(--d-muted)]">
              ⚠️ Anti-fraude : l&apos;adresse domicile est modifiable{" "}
              <b>1 fois par semaine</b> (correction libre pendant 15 min après
              un changement).
            </p>
            {homeErr && (
              <p
                className="mt-2 rounded-[12px] px-3 py-2 text-center text-xs font-bold"
                style={{ background: "rgba(229,72,77,.1)", color: RED }}
              >
                {homeErr}
              </p>
            )}
            <PrimaryBtn
              onClick={() => void saveHome()}
              disabled={homeSaving || !homePos}
              className="!mt-3"
            >
              {homeSaving ? <Loader2 className="size-5 animate-spin" /> : null}
              Enregistrer mon domicile
            </PrimaryBtn>
          </div>
        </div>
      )}

      <ChauffeurWorkZoneSheet
        open={zoneOpen}
        onClose={() => setZoneOpen(false)}
      />

      <DNav />
      <PushRegistrar role="chauffeur" />
    </div>
  );
}
