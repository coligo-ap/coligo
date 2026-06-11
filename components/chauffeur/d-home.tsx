"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Car, ChevronUp, Home, Pencil } from "lucide-react";
import { formatDA } from "@/lib/utils";
import { useDriverPosition } from "@/lib/native/use-driver-position";
import { PushRegistrar } from "@/components/native/push-registrar";
import { DriveMap } from "@/components/customer/drive/drive-map";
import {
  VIOLET,
  GO,
  PrimaryBtn,
} from "@/components/customer/drive/drive-modals";
import { DNav, PlanIcon, PLAN_LABEL, fmtPct } from "./d-ui";
import {
  activateHomeDir,
  chauffeurHeartbeat,
  getChauffeurActiveRide,
  getDriveHome,
  setChauffeurHome,
  type ChauffeurGate,
  type DriveHome,
} from "@/app/(chauffeur)/actions";

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
  const [dirMsg, setDirMsg] = useState<string | null>(null);
  const [homeAddr, setHomeAddr] = useState(gate.homeAddr);
  const coordsRef = useRef(coords);
  coordsRef.current = coords;

  // Présence (en ligne) + rafraîchissement accueil + détection course active.
  const tick = useCallback(async () => {
    const c = coordsRef.current;
    if (c) void chauffeurHeartbeat(c.latitude, c.longitude, true);
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

  const editHome = async () => {
    const v = window.prompt("Adresse de votre domicile :", homeAddr ?? "");
    if (v == null || !v.trim()) return;
    setHomeAddr(v.trim());
    await setChauffeurHome(v.trim());
  };

  const toggleDir = async () => {
    setDirMsg(null);
    if (dirOn) {
      setDirOn(false);
      return;
    }
    const res = await activateHomeDir();
    if (res.ok) {
      setDirOn(true);
      if (res.remaining != null)
        setDirMsg(
          `Activé · ${res.remaining} activation(s) restante(s) aujourd'hui`
        );
    } else {
      setDirMsg(res.error ?? "Activation impossible");
    }
  };

  const me = coords ? { lat: coords.latitude, lng: coords.longitude } : null;

  return (
    <div className="drive-jakarta fixed inset-0 bg-[#E9EBF1]">
      <DriveMap
        markers={me ? [{ id: "me", pos: me, kind: "me" }] : []}
        heatZones={home?.heatZones ?? []}
        padding={{ top: 110, bottom: 460, left: 60, right: 60 }}
      />
      {/* Pill en ligne */}
      <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white px-4 py-2 text-[13.5px] font-bold shadow-lg">
        <span
          className="size-2 animate-pulse rounded-full"
          style={{ background: GO }}
        />
        <span className="drive-sora">En ligne · Drive</span>
      </div>
      {/* Légende heatmap */}
      <div className="absolute top-[64px] left-4 z-10 flex items-center gap-1.5 rounded-full border border-[#EEF0F4] bg-white px-2.5 py-1.5 text-[10.5px] font-bold text-[#6B7280] shadow">
        <span
          className="size-2.5 rounded-full"
          style={{
            background: `radial-gradient(circle,${VIOLET},transparent 75%)`,
          }}
        />
        Zones de forte demande
      </div>

      {/* Feuille réductible */}
      <div
        className="absolute right-0 bottom-[66px] left-0 z-10 overflow-hidden rounded-t-[28px] border-t border-[#EEF0F4] bg-white px-5 pt-2 pb-4 transition-[max-height] duration-300"
        style={{ maxHeight: mini ? 96 : 540 }}
      >
        <button
          type="button"
          onClick={() => setMini((m) => !m)}
          className="mx-auto block cursor-pointer px-10 py-1.5"
          aria-label="Réduire / agrandir"
        >
          <span className="block h-[5px] w-[42px] rounded-full bg-[#EEF0F4]" />
        </button>
        <button
          type="button"
          onClick={() => setMini((m) => !m)}
          className="drive-sora flex w-full items-center justify-between text-[21px] font-extrabold tracking-[-0.5px]"
        >
          {home
            ? `${home.requestsCount} demandes proches`
            : "Demandes proches…"}
          <ChevronUp
            className="size-[18px] text-[#6B7280] transition-transform duration-300"
            style={{ transform: mini ? "rotate(180deg)" : undefined }}
          />
        </button>
        <p className="mb-3 text-[13px] text-[#6B7280]">
          Plusieurs clients attendent un chauffeur autour de vous.
        </p>

        {/* Gains du jour */}
        <div className="mb-3 rounded-[16px] bg-[#F4F5F9] px-3.5 py-3">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span>Gains du jour</span>
            <b className="drive-sora text-[17px]">
              {formatDA(home?.todayNet ?? 0)}
            </b>
          </div>
          <p className="mt-1.5 text-[10.5px] text-[#6B7280]">
            {home?.todayRides ?? 0} courses
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
          <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-white">
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
                onClick={editHome}
                aria-label="Modifier l'adresse"
              >
                <Pencil className="size-3" style={{ color: VIOLET }} />
              </button>
            </b>
            <span className="block truncate text-[10.5px] text-[#6B7280]">
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

        {/* Bandeau gamme */}
        <div className="mb-3 flex items-center gap-2.5 rounded-[14px] bg-[#F4F5F9] px-3.5 py-2.5 text-xs font-semibold text-[#6B7280]">
          <span
            className="grid size-[30px] shrink-0 place-items-center rounded-[9px]"
            style={{ background: "#EEEEFD" }}
          >
            <Car className="size-4" style={{ color: VIOLET }} />
          </span>
          <span>
            Votre gamme :{" "}
            <b className="text-[#0B0C12]">{GAMME_LABEL[gate.gamme]}</b> — vous
            recevez les courses{" "}
            <b className="text-[#0B0C12]">{GAMME_RECEIVES[gate.gamme]}</b>
          </span>
        </div>

        {/* Carte abonnement */}
        <button
          type="button"
          onClick={() => router.push("/chauffeur/abonnement")}
          className="mb-3 flex w-full items-center gap-2.5 rounded-[15px] border border-[#EEF0F4] p-3 text-left"
        >
          <PlanIcon plan={home?.plan ?? "free"} />
          <span className="min-w-0 flex-1">
            <b className="block text-[13.5px]">
              Abonnement : {PLAN_LABEL[home?.plan ?? "free"]}
            </b>
            <span className="text-[11px] text-[#6B7280]">
              {home?.plan === "premium"
                ? "0 % de commission · priorité dispatch"
                : home?.plan === "pro"
                  ? `Commission ${fmtPct(home.planRate)} · 1 500 DA/mois`
                  : "Commission 8 % · passez en Premium = 0 %"}
            </span>
          </span>
          <span className="text-[#6B7280]">›</span>
        </button>

        <PrimaryBtn
          onClick={() => router.push("/chauffeur/demandes")}
          className="!mt-0"
        >
          Voir les demandes
          {home && home.requestsCount > 0 ? ` (${home.requestsCount})` : ""}
        </PrimaryBtn>
      </div>

      <DNav />
      <PushRegistrar role="chauffeur" />
    </div>
  );
}
