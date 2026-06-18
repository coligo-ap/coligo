"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import {
  Car,
  ChevronRight,
  Crosshair,
  Home,
  Loader2,
  Pencil,
  Power,
  Radio,
  Wallet,
  X,
} from "lucide-react";
import { formatDA } from "@/lib/utils";
import {
  useDriverPosition,
  refreshDriverPosition,
} from "@/lib/native/use-driver-position";
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
import { DIncoming } from "./d-incoming";
import { ChauffeurWorkZoneSheet } from "./work-zone-sheet";
import { useSearchRadius } from "@/lib/chauffeur/work-zone";
import {
  setChauffeurOnlineLocal,
  useChauffeurOnline,
} from "@/lib/chauffeur/online-store";
import { HOME_DIR_KEY } from "@/lib/drive/geo";
import { getMyWalletState } from "@/app/wallet/recharge-actions";
import {
  activateHomeDir,
  chauffeurHeartbeat,
  declineRide,
  getChauffeurActiveRide,
  getDriveHome,
  getNearbyRides,
  offerRide,
  setChauffeurHome,
  setChauffeurOnline,
  type ChauffeurGate,
  type DriveHome,
  type NearbyRide,
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

// Cache module (SWR) : dernières données d'accueil (gains, heatmap, plan…). Au
// RETOUR sur l'accueil, elles s'affichent INSTANTANÉMENT (plus d'attente du
// tick) ; le rafraîchissement se fait en arrière-plan.
let lastDriveHomeCache: DriveHome | null = null;

/**
 * Accueil chauffeur (maquette v13 « accueil chauffeur ») : carte + heatmap,
 * bouton GO animé (mise en ligne), finance bar (gains du jour + solde), prefs
 * (domicile / zone), abonnement, et RÉCEPTION DES COURSES en ligne via une
 * carte de notification entrante (DIncoming) qui apparaît en haut de l'écran.
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
  // Initialisé depuis le cache module → affichage instantané au retour (SWR).
  const [home, setHome] = useState<DriveHome | null>(lastDriveHomeCache);
  // Accueil COMPACT : feuille réduite par défaut (le chauffeur l'ouvre au choix).
  const [mini, setMini] = useState(true);
  const [dirOn, setDirOn] = useState(false);
  useEffect(() => {
    setDirOn(localStorage.getItem(HOME_DIR_KEY) === "1");
  }, []);
  const [dirMsg, setDirMsg] = useState<string | null>(null);
  const [homeAddr, setHomeAddr] = useState(gate.homeAddr);
  // Rayon « autour de moi » — dispatch toujours centré sur la position live.
  const [zoneOpen, setZoneOpen] = useState(false);
  // Domicile : popup carte (recherche + repère) — déclaré tôt car le sélecteur
  // de course entrante (plus bas) s'en sert comme garde (pas de popup si ouvert).
  const [homeOpen, setHomeOpen] = useState(false);
  const [homePos, setHomePos] = useState<LatLng | null>(null);
  const [homeSaving, setHomeSaving] = useState(false);
  const [homeErr, setHomeErr] = useState<string | null>(null);
  const searchRadius = useSearchRadius();
  const radiusRef = useRef(searchRadius);
  radiusRef.current = searchRadius;
  const coordsRef = useRef(coords);
  coordsRef.current = coords;

  // Solde portefeuille opérateur (finance bar) — rafraîchi périodiquement.
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const s = await getMyWalletState();
      if (active) setBalance(s?.effectiveBalanceDa ?? 0);
    };
    void load();
    const id = setInterval(load, 20_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // En ligne / hors ligne : intention partagée (store, clé coligo-drive-online),
  // lue À L'IDENTIQUE par la page Demandes → elle ne poll/écoute QUE si en ligne.
  const online = useChauffeurOnline();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const [onlineBusy, setOnlineBusy] = useState(false);

  const toggleOnline = async () => {
    if (onlineBusy) return;
    const next = !onlineRef.current;
    setOnlineBusy(true);
    setChauffeurOnlineLocal(next);
    onlineRef.current = next;
    if (!next) {
      // Hors ligne : on coupe la réception (popup + file).
      setNearby([]);
      setCurrent(null);
    }
    // Bascule serveur immédiate (le heartbeat suivant entretient l'état).
    await setChauffeurOnline(next);
    const c = coordsRef.current;
    if (c) void chauffeurHeartbeat(c.latitude, c.longitude, next);
    setOnlineBusy(false);
  };

  // ── Réception des courses (popup entrant) ──────────────────────────────
  const [nearby, setNearby] = useState<NearbyRide[]>([]);
  const [current, setCurrent] = useState<NearbyRide | null>(null);
  const [incBusy, setIncBusy] = useState(false);
  // Demandes déjà vues dans le popup (refus / accept / fermeture / expiration) :
  // ne re-poppent plus, mais restent disponibles dans l'écran Drive.
  const seenRef = useRef<Set<string>>(new Set());
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Anti-chevauchement : pas de nouveau tick si le précédent n'est pas fini
  // (sinon, sous contention, les Server Actions sérialisées s'empilent → lag).
  const tickBusy = useRef(false);

  // Présence (en ligne) + rafraîchissement accueil + détection course active +
  // récupération des demandes proches (pour le popup + le compteur).
  const tick = useCallback(async () => {
    if (tickBusy.current) return;
    const c = coordsRef.current;
    tickBusy.current = true;
    try {
      if (c)
        void chauffeurHeartbeat(c.latitude, c.longitude, onlineRef.current);
      const [h, active, list] = await Promise.all([
        getDriveHome(c?.latitude ?? null, c?.longitude ?? null),
        getChauffeurActiveRide(),
        onlineRef.current && c
          ? getNearbyRides(c.latitude, c.longitude, radiusRef.current)
          : Promise.resolve([] as NearbyRide[]),
      ]);
      if (active) {
        router.replace("/chauffeur/course");
        return;
      }
      lastDriveHomeCache = h; // alimente le cache SWR
      setHome(h);
      setNearby(onlineRef.current ? list : []);
    } finally {
      tickBusy.current = false;
    }
  }, [router]);
  useEffect(() => {
    void tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [tick]);

  // Temps réel : une nouvelle demande proche met à jour le popup + le compteur
  // instantanément (sans attendre le tick de 15 s). + redirection immédiate
  // quand le client accepte UNE de mes offres. GATÉ sur l'état en ligne.
  useEffect(() => {
    if (!online) return;
    const supabase = createClient();
    const chans = [
      supabase
        .channel("home-nearby-rides")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "rides" },
          () => void tick()
        )
        .subscribe(),
      supabase
        .channel(`home-my-offers-${gate.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "ride_offers",
            filter: `chauffeur_id=eq.${gate.id}`,
          },
          (payload) => {
            if ((payload.new as { status?: string }).status === "accepted")
              router.replace("/chauffeur/course");
          }
        )
        .subscribe(),
    ];
    return () => {
      for (const c of chans) void supabase.removeChannel(c);
    };
  }, [tick, online, gate.id, router]);

  // Dès la 1re position GPS connue : recharger immédiatement (sans attendre 15 s).
  const gotFirstFix = useRef(false);
  useEffect(() => {
    if (coords && !gotFirstFix.current) {
      gotFirstFix.current = true;
      void tick();
    }
  }, [coords, tick]);

  // Sélection de la prochaine course à présenter dans le popup : la plus proche
  // non encore vue (et non déjà proposée par moi). Pas de popup si un volet est
  // ouvert (domicile / zone) ni hors ligne.
  useEffect(() => {
    if (current || !online || homeOpen || zoneOpen) return;
    const cand = nearby
      .filter((r) => !seenRef.current.has(r.id) && r.my_offer_da == null)
      .sort((a, b) => a.pickup_dist_km - b.pickup_dist_km);
    if (cand.length) setCurrent(cand[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, online, nearby, zoneOpen]);

  // Auto-masquage du popup après 12 s : la course reste disponible dans Drive.
  useEffect(() => {
    if (!current) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      seenRef.current.add(current.id);
      setCurrent(null);
    }, 12_000);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [current]);

  const closeInc = () => {
    if (current) seenRef.current.add(current.id);
    setCurrent(null);
  };
  const refuseInc = async () => {
    if (!current || incBusy) return;
    const r = current;
    setIncBusy(true);
    seenRef.current.add(r.id);
    setNearby((l) => l.filter((x) => x.id !== r.id));
    setCurrent(null);
    await declineRide(r.id);
    setIncBusy(false);
  };
  const acceptInc = async () => {
    if (!current || incBusy) return;
    const r = current;
    const price = r.proposed_price_da + r.boost_amount_da;
    setIncBusy(true);
    seenRef.current.add(r.id);
    const res = await offerRide(r.id, price);
    // Offre envoyée : la course passe en « proposition » (visible dans Drive).
    // La redirection vers /course se fait quand le client accepte (temps réel).
    setNearby((l) =>
      l.map((x) => (x.id === r.id ? { ...x, my_offer_da: price } : x))
    );
    setCurrent(null);
    setIncBusy(false);
    if (!res.ok) setNearby((l) => l.filter((x) => x.id !== r.id));
  };
  const seeAllInc = () => {
    if (current) seenRef.current.add(current.id);
    setCurrent(null);
    router.push("/chauffeur/demandes");
  };

  // Domicile : enregistrement (le changement d'adresse est LIMITÉ côté serveur
  // — 1×/semaine, anti-fraude). États déclarés plus haut (garde du popup).
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
  const [locating, setLocating] = useState(false);
  // Quand on réduit/agrandit la feuille, la zone visible change → on re-centre
  // le point « moi » avec le nouveau padding (sinon il resterait décalé).
  useEffect(() => {
    const c = coordsRef.current;
    if (c) setFocusMe({ lat: c.latitude, lng: c.longitude, zoom: 16.5 });
  }, [mini]);
  const recenter = async () => {
    // 1) Recentrage INSTANTANÉ sur la dernière position connue (si on en a une).
    const known = coordsRef.current;
    if (known)
      setFocusMe({ lat: known.latitude, lng: known.longitude, zoom: 16.5 });
    // 2) Puis on force un fix frais (alimente AUSSI le store → le repère « moi »
    //    apparaît même si le watch n'avait encore rien livré) et on s'y cale.
    setLocating(true);
    const fresh = await refreshDriverPosition();
    setLocating(false);
    if (fresh)
      setFocusMe({ lat: fresh.latitude, lng: fresh.longitude, zoom: 16.5 });
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
  const reqCount = nearby.length || (online ? (home?.requestsCount ?? 0) : 0);
  const queueCount = Math.max(
    0,
    nearby.filter((r) => !seenRef.current.has(r.id) && r.my_offer_da == null)
      .length - 1
  );
  const lowBalance = balance != null && balance < 0;

  return (
    <div className="drive-jakarta drive-screen bg-[var(--d-page)]">
      <DriveMap
        markers={me ? [{ id: "me", pos: me, kind: "me" }] : []}
        heatZones={home?.heatZones ?? []}
        focusTarget={focusMe}
        follow
        // Réserve la zone basse occupée par la feuille → le point « moi » est
        // centré dans la partie VISIBLE de la carte (au-dessus de la feuille),
        // et s'ajuste quand on réduit/agrandit la feuille.
        padding={{ top: 96, bottom: mini ? 220 : 520, left: 56, right: 56 }}
      />

      {/* Gains du jour (haut-centre) — visible UNIQUEMENT en mode compact
          (feuille réduite) ; à l'ouverture de la feuille, ils réapparaissent
          dans la finance bar et on retire cette pastille pour ne pas encombrer. */}
      {mini && (
        <button
          type="button"
          onClick={() => router.push("/chauffeur/gains")}
          className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[var(--d-surface)] px-3.5 py-2 shadow-lg"
        >
          <span className="text-[10px] font-semibold text-[var(--d-muted)]">
            {tr("Gains du jour", "أرباح اليوم")}
          </span>
          <span className="drive-sora text-[14px] font-extrabold tracking-[-0.3px]">
            {formatDA(home?.todayNet ?? 0)}
          </span>
        </button>
      )}

      {/* Pastille « demande proche » (en ligne) → ouvre Drive ; sinon légende. */}
      {online ? (
        <button
          type="button"
          onClick={() => router.push("/chauffeur/demandes")}
          className="absolute top-[64px] left-4 z-10 flex items-center gap-1.5 rounded-full bg-[var(--d-surface)] px-3 py-2 text-[11.5px] font-bold shadow-lg"
        >
          <span
            className="size-2 animate-pulse rounded-full"
            style={{ background: GO }}
          />
          <span
            className="drive-sora text-[14px] font-extrabold"
            style={{ color: VIOLET }}
          >
            {reqCount}
          </span>
          <span className="text-[var(--d-muted)]">
            {isAr ? "رحلة" : reqCount > 1 ? "courses" : "course"}
          </span>
        </button>
      ) : (
        <div className="absolute top-[64px] left-4 z-10 flex items-center gap-1.5 rounded-full border border-[var(--d-line)] bg-[var(--d-surface)] px-2.5 py-1.5 text-[10.5px] font-bold text-[var(--d-muted)] shadow">
          <span
            className="size-2.5 rounded-full"
            style={{
              background: `radial-gradient(circle,${VIOLET},transparent 75%)`,
            }}
          />
          {tr("Zones de forte demande", "مناطق الطلب المرتفع")}
        </div>
      )}

      {/* Recentrer la carte sur ma position (curseur chauffeur) */}
      <button
        type="button"
        onClick={() => void recenter()}
        disabled={locating}
        aria-label="Centrer sur ma position"
        className="absolute top-[64px] right-4 z-10 grid size-[42px] place-items-center rounded-full border border-[var(--d-line)] bg-[var(--d-surface)] shadow-lg"
      >
        {locating ? (
          <Loader2 className="size-5 animate-spin" style={{ color: VIOLET }} />
        ) : (
          <Crosshair className="size-5" style={{ color: VIOLET }} />
        )}
      </button>

      {/* RÉCEPTION : carte de course entrante (en ligne, accueil, hors volet). */}
      {current && online && (
        <DIncoming
          ride={current}
          queueCount={queueCount}
          pendingCount={reqCount}
          busy={incBusy}
          isAr={isAr}
          onAccept={() => void acceptInc()}
          onRefuse={() => void refuseInc()}
          onSeeAll={seeAllInc}
          onClose={closeInc}
        />
      )}

      {/* Feuille réductible — SCROLLABLE. */}
      <div
        className="absolute right-0 bottom-[66px] left-0 z-10 overflow-y-auto overscroll-contain rounded-t-[28px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-2 pb-6 transition-[max-height] duration-300"
        style={{ maxHeight: mini ? 118 : "min(580px, calc(100dvh - 140px))" }}
      >
        <button
          type="button"
          onClick={() => setMini((m) => !m)}
          className="mx-auto block cursor-pointer px-10 py-1.5"
          aria-label="Réduire / agrandir"
        >
          <span className="block h-[5px] w-[42px] rounded-full bg-[var(--d-line)]" />
        </button>

        {/* ── Toggle « En ligne » — épuré (style Anthropic) ── */}
        <button
          type="button"
          role="switch"
          aria-checked={online}
          aria-label={tr("Disponibilité", "التوفر")}
          onClick={() => void toggleOnline()}
          disabled={onlineBusy}
          className="mt-1 flex w-full items-center gap-3 rounded-[16px] border px-4 py-3 text-start transition-colors disabled:opacity-60"
          style={{
            borderColor: online ? "rgba(22,179,100,.35)" : "var(--d-line)",
            background: online ? "rgba(22,179,100,.06)" : "var(--d-surface)",
          }}
        >
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full transition-colors"
            style={{
              background: online ? "rgba(22,179,100,.14)" : "var(--d-soft)",
            }}
          >
            {onlineBusy ? (
              <Loader2
                className="size-[18px] animate-spin"
                style={{ color: online ? GO : "var(--d-muted)" }}
              />
            ) : online ? (
              <Radio className="size-[18px]" style={{ color: GO }} />
            ) : (
              <Power
                className="size-[18px]"
                style={{ color: "var(--d-muted)" }}
              />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="drive-sora block text-[14px] font-bold tracking-[-0.2px]">
              {online ? tr("En ligne", "متصل") : tr("Hors ligne", "غير متصل")}
            </span>
            <span className="block truncate text-[11.5px] text-[var(--d-muted)]">
              {online
                ? tr("En recherche des courses…", "البحث عن الطلبات…")
                : tr(
                    "Activez pour recevoir les courses",
                    "فعّل لاستقبال الطلبات"
                  )}
            </span>
          </span>
          {/* Switch iOS-like (RTL-safe) */}
          <span
            className="relative h-[28px] w-[48px] shrink-0 rounded-full transition-colors"
            style={{ background: online ? GO : "#D6D9E2" }}
          >
            <span
              className="absolute top-[3px] size-[22px] rounded-full bg-white shadow-sm transition-all"
              style={{ insetInlineStart: online ? 23 : 3 }}
            />
          </span>
        </button>

        {/* ── Finance bar : gains du jour + solde ── */}
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            onClick={() => router.push("/chauffeur/gains")}
            className="relative flex flex-1 items-center gap-2.5 overflow-hidden rounded-[14px] px-3 py-2.5 text-left text-white"
            style={{
              background: `linear-gradient(135deg,#7B7BF0,${VIOLET} 48%,#4646C8)`,
              boxShadow: "0 10px 24px -10px rgba(108,43,217,.45)",
            }}
          >
            <span className="relative z-[1] min-w-0">
              <span className="block text-[9.5px] font-semibold opacity-80">
                {tr("Gains du jour", "أرباح اليوم")}
              </span>
              <span className="drive-sora block text-[17px] leading-tight font-extrabold tracking-[-0.5px]">
                {formatDA(home?.todayNet ?? 0)}
              </span>
              <span className="block text-[9px] opacity-75">
                {home?.todayRides ?? 0} {tr("courses", "رحلة")} ·{" "}
                {fmtOnline(home?.todayOnlineMin ?? 0)}
              </span>
            </span>
            <span className="relative z-[1] ml-auto grid size-[22px] shrink-0 place-items-center rounded-full bg-white/20">
              <ChevronRight className="size-3.5" />
            </span>
          </button>

          <button
            type="button"
            onClick={() => router.push("/chauffeur/recharger")}
            className="flex min-w-[94px] flex-col items-center justify-center gap-0.5 rounded-[14px] px-2.5 py-2"
            style={
              lowBalance
                ? {
                    background: "rgba(255,45,122,.07)",
                    border: "1px solid rgba(255,45,122,.18)",
                  }
                : {
                    background: "var(--d-soft)",
                    border: "1px solid var(--d-line)",
                  }
            }
          >
            <Wallet
              className="size-3.5"
              style={{ color: lowBalance ? "#FF2D7A" : VIOLET }}
            />
            <span className="text-[8.5px] font-semibold text-[var(--d-muted)]">
              {tr("Solde", "الرصيد")}
            </span>
            <span
              className="drive-sora text-[12.5px] font-extrabold"
              style={{ color: lowBalance ? "#FF2D7A" : "var(--d-ink)" }}
            >
              {balance == null ? "…" : formatDA(balance)}
            </span>
            {lowBalance && (
              <span
                className="mt-0.5 rounded-[7px] px-2 py-0.5 text-[9px] font-bold text-white"
                style={{ background: "#FF2D7A" }}
              >
                {tr("Recharger", "اشحن")}
              </span>
            )}
          </button>
        </div>

        {/* ── Préférences : domicile (+ filtre direction) · zone ── */}
        <div className="mt-2 flex gap-1.5">
          {/* Domicile : éditer (tap) + filtre direction (switch) */}
          <div
            className="flex flex-1 items-center gap-2 rounded-[12px] border border-[var(--d-line)] bg-[var(--d-surface)] px-2.5 py-2"
            style={{ background: "#F4F2FE" }}
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-[var(--d-surface)]">
              <Home className="size-3" style={{ color: VIOLET }} />
            </span>
            <button
              type="button"
              onClick={() => {
                setHomeErr(null);
                setHomePos(null);
                setHomeOpen(true);
              }}
              className="min-w-0 flex-1 text-start"
            >
              <b
                className="block truncate text-[10px] leading-tight"
                style={{ color: VIOLET }}
              >
                {tr("Rentrer chez moi", "العودة للمنزل")}
              </b>
              <span className="flex items-center gap-1 truncate text-[8.5px] text-[var(--d-muted)]">
                <span className="truncate">
                  {homeAddr ?? tr("Définir l'adresse", "تحديد العنوان")}
                </span>
                <Pencil className="size-2 shrink-0" />
              </span>
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={dirOn}
              aria-label={tr("Filtre domicile", "فلتر المنزل")}
              onClick={toggleDir}
              className="relative h-[19px] w-8 shrink-0 rounded-full transition-colors"
              style={{ background: dirOn ? VIOLET : "#E2E0EC" }}
            >
              <span
                className="absolute top-[2px] size-[15px] rounded-full bg-white shadow transition-all"
                style={{ insetInlineStart: dirOn ? 15 : 2 }}
              />
            </button>
          </div>

          {/* Zone de travail : ouvre le volet carte */}
          <button
            type="button"
            onClick={() => setZoneOpen(true)}
            className="flex flex-1 items-center gap-2 rounded-[12px] border border-[var(--d-line)] px-2.5 py-2 text-start"
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-[#F1E9FC]">
              <Crosshair className="size-3" style={{ color: VIOLET }} />
            </span>
            <span className="min-w-0 flex-1">
              <b className="block text-[10px] leading-tight">
                {tr("Ma zone", "منطقتي")} · {searchRadius} km
              </b>
              <span className="block truncate text-[8.5px] text-[var(--d-muted)]">
                {tr("Autour de moi", "حولي")}
              </span>
            </span>
            <ChevronRight className="size-3 shrink-0 text-[var(--d-muted)]" />
          </button>
        </div>

        {/* Gamme (info) — ligne fine */}
        <div className="mt-2 flex items-center gap-2 rounded-[12px] bg-[var(--d-soft)] px-3 py-2">
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

        {/* Retour d'activation du filtre domicile (compte d'activations). */}
        {dirMsg && (
          <p className="mt-2 px-1 text-[10.5px] text-[var(--d-muted)]">
            {dirMsg}
          </p>
        )}

        {/* Carte abonnement */}
        <button
          type="button"
          onClick={() => router.push("/chauffeur/abonnement")}
          className="mt-2 flex w-full items-center gap-2.5 rounded-[15px] border border-[var(--d-line)] p-3 text-left"
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
          <ChevronRight className="size-4 shrink-0 text-[var(--d-muted)]" />
        </button>

        {/* Voir les demandes (raccourci quand en ligne) */}
        {online && (
          <PrimaryBtn
            onClick={() => router.push("/chauffeur/demandes")}
            className={reqCount > 0 ? "drive-attn" : ""}
          >
            {reqCount > 0
              ? isAr
                ? `عرض ${reqCount} ${reqCount > 1 ? "طلبات" : "طلب"}`
                : `Voir les ${reqCount} demande${reqCount > 1 ? "s" : ""}`
              : tr("Voir les demandes", "عرض الطلبات")}
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
