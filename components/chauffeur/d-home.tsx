"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
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
import { ChauffeurBalancePill } from "./balance-pill";
import { ChauffeurWorkZoneSheet } from "./work-zone-sheet";
import { useWorkZone } from "@/lib/chauffeur/work-zone";
import { HOME_DIR_KEY } from "@/lib/drive/geo";
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
  // Espace chauffeur FR par défaut ; traduction AR de l'accueil (le HTML passe
  // déjà en RTL via la locale racine). `tr(fr, ar)` = mini-helper local.
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  // Durée « en ligne » + libellé d'offre, traduits (évite « min en ligne » /
  // « Gratuit » en dur quand l'app est en arabe).
  const fmtOnline = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h === 0
      ? `${m} ${tr("min en ligne", "د متصل")}`
      : `${h} ${tr("h", "س")} ${String(m).padStart(2, "0")} ${tr("en ligne", "متصل")}`;
  };
  const planLabel = (plan: "free" | "pro" | "premium") =>
    isAr
      ? { free: "مجاني", pro: "Pro", premium: "Premium" }[plan]
      : PLAN_LABEL[plan];
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
          {online
            ? tr("En ligne · Drive", "متصل · درايف")
            : tr("Hors ligne", "غير متصل")}
        </span>
      </div>
      {/* Solde portefeuille en temps réel → page de recharge */}
      <ChauffeurBalancePill />
      {/* Légende heatmap */}
      <div className="absolute top-[64px] left-4 z-10 flex items-center gap-1.5 rounded-full border border-[var(--d-line)] bg-[var(--d-surface)] px-2.5 py-1.5 text-[10.5px] font-bold text-[var(--d-muted)] shadow">
        <span
          className="size-2.5 rounded-full"
          style={{
            background: `radial-gradient(circle,${VIOLET},transparent 75%)`,
          }}
        />
        {tr("Zones de forte demande", "مناطق الطلب المرتفع")}
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

      {/* Feuille réductible — SCROLLABLE : le contenu (jusqu'au bouton GO) peut
          dépasser la hauteur sur petit écran, on défile à l'intérieur. La
          hauteur s'adapte à l'écran pour ne jamais passer sous la nav du bas. */}
      <div
        className="absolute right-0 bottom-[66px] left-0 z-10 overflow-y-auto overscroll-contain rounded-t-[28px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-2 pb-6 transition-[max-height] duration-300"
        style={{ maxHeight: mini ? 96 : "min(560px, calc(100dvh - 140px))" }}
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
          className="drive-sora mb-3 flex w-full items-center justify-between gap-2 text-[21px] font-extrabold tracking-[-0.5px]"
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
                      {isAr
                        ? reqCount > 1
                          ? "طلبات قريبة"
                          : "طلب قريب"
                        : `demande${reqCount > 1 ? "s" : ""} proche${reqCount > 1 ? "s" : ""}`}
                    </span>
                  </>
                ) : (
                  tr("Aucune demande proche", "لا توجد طلبات قريبة")
                )
              ) : (
                tr("Demandes proches…", "الطلبات القريبة…")
              )
            ) : (
              tr("Vous êtes hors ligne", "أنت غير متصل")
            )}
          </span>
          <ChevronUp
            className="size-[18px] shrink-0 text-[var(--d-muted)] transition-transform duration-300"
            style={{ transform: mini ? "rotate(180deg)" : undefined }}
          />
        </button>
        {/* Gains du jour */}
        <div className="mb-3 rounded-[16px] bg-[var(--d-soft)] px-3.5 py-3">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span>{tr("Gains du jour", "أرباح اليوم")}</span>
            <b className="drive-sora text-[17px]">
              {formatDA(home?.todayNet ?? 0)}
            </b>
          </div>
          <p className="mt-1.5 text-[10.5px] text-[var(--d-muted)]">
            {home?.todayRides ?? 0} {tr("courses", "رحلة")} ·{" "}
            {fmtOnline(home?.todayOnlineMin ?? 0)}
            {home && home.todayRides > 0
              ? ` · ${tr("moy.", "متوسط")} ${formatDA(Math.round(home.todayNet / home.todayRides))}/${tr("course", "رحلة")}`
              : ""}
          </p>
        </div>

        {/* Préférences de réception — UN SEUL bloc compact (domicile · zone ·
            gamme). Domicile + Zone côte à côte ; gamme en pied de carte fin.
            RTL-safe (divide-x-reverse, insetInlineStart, text-start). */}
        <div className="mb-3 overflow-hidden rounded-[16px] border border-[var(--d-line)]">
          <div className="grid grid-cols-2 divide-x divide-[var(--d-line)] rtl:divide-x-reverse">
            {/* Domicile : éditer (tap) + filtre direction (switch) */}
            <div
              className="flex flex-col gap-2 p-3"
              style={{ background: "#F4F2FE" }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="grid size-7 shrink-0 place-items-center rounded-[9px] bg-[var(--d-surface)]">
                  <Home className="size-3.5" style={{ color: VIOLET }} />
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={dirOn}
                  aria-label={tr("Filtre domicile", "فلتر المنزل")}
                  onClick={toggleDir}
                  className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
                  style={{ background: dirOn ? VIOLET : "#E2E0EC" }}
                >
                  <span
                    className="absolute top-[3px] size-[18px] rounded-full bg-white shadow transition-all"
                    style={{ insetInlineStart: dirOn ? 23 : 3 }}
                  />
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setHomeErr(null);
                  setHomePos(null);
                  setHomeOpen(true);
                }}
                className="min-w-0 text-start"
              >
                <b
                  className="block text-[12.5px] leading-tight"
                  style={{ color: VIOLET }}
                >
                  {tr("Mon domicile", "منزلي")}
                </b>
                <span className="mt-0.5 flex items-center gap-1 truncate text-[10.5px] text-[var(--d-muted)]">
                  <span className="truncate">
                    {homeAddr ?? tr("Définir l'adresse", "تحديد العنوان")}
                  </span>
                  <Pencil className="size-2.5 shrink-0" />
                </span>
              </button>
            </div>

            {/* Zone de travail : ouvre le volet carte */}
            <button
              type="button"
              onClick={() => setZoneOpen(true)}
              className="flex flex-col gap-2 p-3 text-start"
              style={{ background: "#F4F2FE" }}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-[9px] bg-[var(--d-surface)]">
                {workZone ? (
                  <MapPin className="size-3.5" style={{ color: VIOLET }} />
                ) : (
                  <Crosshair className="size-3.5" style={{ color: VIOLET }} />
                )}
              </span>
              <span className="min-w-0">
                <b
                  className="block text-[12.5px] leading-tight"
                  style={{ color: VIOLET }}
                >
                  {tr("Ma zone", "منطقتي")}
                </b>
                <span className="mt-0.5 block truncate text-[10.5px] text-[var(--d-muted)]">
                  {workZone
                    ? `${workZone.radiusKm} km`
                    : tr("Autour de moi", "حولي")}
                </span>
              </span>
            </button>
          </div>

          {/* Gamme (info) — pied de carte fin */}
          <div className="flex items-center gap-2 border-t border-[var(--d-line)] bg-[var(--d-soft)] px-3 py-2">
            <Car className="size-3.5 shrink-0" style={{ color: VIOLET }} />
            <span className="truncate text-[11px] font-semibold text-[var(--d-muted)]">
              {tr("Gamme", "الفئة")}{" "}
              <b className="text-[var(--d-ink)]">{GAMME_LABEL[gate.gamme]}</b>
              <span>
                {" · "}
                {tr("reçoit", "يستقبل")} {GAMME_RECEIVES[gate.gamme]}
              </span>
            </span>
          </div>
        </div>
        {/* Retour d'activation du filtre domicile (compte d'activations). */}
        {dirMsg && (
          <p className="-mt-1 mb-3 px-1 text-[10.5px] text-[var(--d-muted)]">
            {dirMsg}
          </p>
        )}

        {/* Carte abonnement */}
        <button
          type="button"
          onClick={() => router.push("/chauffeur/abonnement")}
          className="mb-3 flex w-full items-center gap-2.5 rounded-[15px] border border-[var(--d-line)] p-3 text-left"
        >
          <PlanIcon plan={home?.plan ?? "free"} />
          <span className="min-w-0 flex-1">
            <b className="block text-[13.5px]">
              {tr("Abonnement", "الاشتراك")} : {planLabel(home?.plan ?? "free")}
            </b>
            <span className="text-[11px] text-[var(--d-muted)]">
              {home?.plan === "premium"
                ? tr(
                    "0 % de commission · priorité dispatch",
                    "0٪ عمولة · أولوية في التوزيع"
                  )
                : home?.plan === "pro"
                  ? `${tr("Commission", "عمولة")} ${fmtPct(home.planRate)} · 1 500 DA/${tr("mois", "شهر")}`
                  : tr(
                      "Commission 8 % · passez en Premium = 0 %",
                      "عمولة 8٪ · انتقل إلى بريميوم = 0٪"
                    )}
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
                  {isAr
                    ? `عرض ${reqCount} ${reqCount > 1 ? "طلبات" : "طلب"}`
                    : `Voir les ${reqCount} demande${reqCount > 1 ? "s" : ""}`}
                  <span className="drive-badge grid size-6 place-items-center rounded-full bg-white/25 text-sm">
                    →
                  </span>
                </>
              ) : (
                tr("Voir les demandes", "عرض الطلبات")
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
              {tr("Se mettre hors ligne", "قطع الاتصال")}
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
            {tr("Passer en ligne · GO", "اتصل · انطلق")}
          </PrimaryBtn>
        )}
      </div>

      {/* Popup domicile : recherche d'adresse + repère sur la carte. */}
      {homeOpen && (
        <div className="fixed inset-0 z-[130] flex flex-col justify-end bg-black/45">
          <div className="drive-jakarta rounded-t-[24px] bg-[var(--d-surface)] p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
            <div className="mb-2 flex items-center justify-between">
              <b className="drive-sora text-[16px] font-extrabold">
                {tr("Mon domicile", "منزلي")}
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
              {tr(
                "Cherchez votre adresse ou déplacez la carte pour placer le repère sur votre domicile.",
                "ابحث عن عنوانك أو حرّك الخريطة لوضع المؤشر على منزلك."
              )}
            </p>
            <MapPositionPicker
              initial={null}
              defaultCenter={me ?? undefined}
              autoLocate={!me}
              searchEnabled
              height={300}
              gpsLabel={tr("Ma position", "موقعي")}
              onChange={(p) => setHomePos(p)}
            />
            <p className="mt-2 text-[11px] text-[var(--d-muted)]">
              {tr(
                "⚠️ Anti-fraude : l'adresse domicile est modifiable 1 fois par semaine (correction libre pendant 15 min après un changement).",
                "⚠️ لمكافحة الاحتيال: عنوان المنزل قابل للتعديل مرة واحدة في الأسبوع (تصحيح حر خلال 15 دقيقة بعد التغيير)."
              )}
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
              {tr("Enregistrer mon domicile", "حفظ منزلي")}
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
