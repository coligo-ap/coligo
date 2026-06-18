"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Check,
  Home,
  Loader2,
  Maximize2,
  Power,
  Rows3,
  Send,
  X,
  Zap,
} from "lucide-react";
import { useDriverPosition } from "@/lib/native/use-driver-position";
import { createClient } from "@/lib/supabase/client";
import { DriveMap } from "@/components/customer/drive/drive-map";
import {
  VIOLET,
  GO,
  ROSE,
  RED,
  PrimaryBtn,
} from "@/components/customer/drive/drive-modals";
import {
  setChauffeurOnlineLocal,
  useChauffeurOnline,
} from "@/lib/chauffeur/online-store";
import { useSearchRadius } from "@/lib/chauffeur/work-zone";
import {
  chauffeurHeartbeat,
  declineRide,
  getChauffeurActiveRide,
  getChauffeurGate,
  getChauffeurPlanRate,
  getNearbyRides,
  offerRide,
  setChauffeurOnline,
  type NearbyRide,
} from "@/app/(chauffeur)/actions";
import { HOME_DIR_KEY, isTowardsHome } from "@/lib/drive/geo";

const AMBER = "#F59E0B";

// Cache module (SWR) : dernière liste de demandes connue. Au RETOUR sur l'écran
// Drive, on l'affiche INSTANTANÉMENT (pas de loader, pas d'écran « vide ») ; le
// poll/temps réel rafraîchit en ARRIÈRE-PLAN. Le shell statique (titre, filtres,
// onglets) n'attend jamais. Survit aux navigations (niveau module), vidé à la
// fermeture de l'onglet.
let lastNearbyCache: NearbyRide[] = [];

const fmtkm = (v: number) =>
  `${(Math.round(v * 10) / 10).toString().replace(".", ",")} km`;
const ago = (iso: string) => {
  const s = Math.max(
    5,
    Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  );
  if (s < 60) return `il y a ${s} s`;
  return `il y a ${Math.round(s / 60)} min`;
};

/** Mini-carte schématique (légère) du trajet, façon maquette v13. Décorative :
 *  le détail géo réel s'ouvre via « agrandir » (DriveMap plein écran). */
function MiniMap({ seed }: { seed: number }) {
  const y = 18 + (seed % 5) * 6;
  const py = 14 + (seed % 4) * 7;
  return (
    <svg
      viewBox="0 0 340 72"
      preserveAspectRatio="xMidYMid slice"
      className="size-full"
    >
      <rect width="340" height="72" fill="var(--d-soft)" />
      <rect x="10" y="8" width="50" height="25" rx="4" fill="var(--d-line)" />
      <rect x="200" y="5" width="55" height="28" rx="4" fill="var(--d-line)" />
      <rect x="80" y="40" width="65" height="22" rx="4" fill="var(--d-line)" />
      <path
        d="M0,36 H340"
        stroke="var(--d-surface)"
        strokeWidth="5"
        fill="none"
      />
      <path
        d={`M20,${55 - y / 4} Q120,${py} 200,30 T320,40`}
        stroke="var(--d-muted)"
        strokeWidth="2.5"
        fill="none"
        strokeDasharray="5 3"
        opacity=".5"
        strokeLinecap="round"
      />
      <circle
        cx="20"
        cy={Math.min(64, 55 - y / 4)}
        r="4"
        fill="var(--d-muted)"
        stroke="#fff"
        strokeWidth="2"
      />
      <circle
        cx="200"
        cy="30"
        r="4"
        fill="var(--d-muted)"
        stroke="#fff"
        strokeWidth="2"
      />
      <circle
        cx="320"
        cy="40"
        r="4"
        fill="var(--d-ink)"
        stroke="#fff"
        strokeWidth="2"
      />
    </svg>
  );
}

/**
 * Page Drive — demandes & propositions (maquette v13). Onglets Demandes /
 * Propositions, filtres (Plus proches / Mieux payées / Récentes / Compact),
 * cartes épurées : avatar · nom · note · km · prix ; rail d'adresses ;
 * mini-carte ; ajusteur ± ; Proposer / Accepter / Refuser. La 1re acceptation
 * client redirige vers /course.
 */
export function DRequests({ priceStep = 20 }: { priceStep?: number }) {
  const router = useRouter();
  const coords = useDriverPosition();
  // À L'ÉCOUTE seulement si EN LIGNE (intention partagée avec l'accueil).
  const online = useChauffeurOnline();
  const [goingOnline, setGoingOnline] = useState(false);
  // Initialisé depuis le cache module → affichage instantané au retour (SWR).
  const [reqs, setReqs] = useState<NearbyRide[]>(lastNearbyCache);
  const [loading, setLoading] = useState(lastNearbyCache.length === 0);
  const [tab, setTab] = useState<"demandes" | "proposed">("demandes");
  const [sort, setSort] = useState<"near" | "pay">("near");
  const [compact, setCompact] = useState(false);
  const [myPrices, setMyPrices] = useState<Record<string, number>>({});
  const [sent, setSent] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [mapReq, setMapReq] = useState<NearbyRide | null>(null);
  // Net estimé : taux de commission du plan (free 8 % / pro / premium).
  const [planRate, setPlanRate] = useState(0.08);
  const [chId, setChId] = useState<string | null>(null);
  const coordsRef = useRef(coords);
  coordsRef.current = coords;
  // Rayon choisi par le chauffeur (dispatch centré sur sa position live).
  const searchRadius = useSearchRadius();
  const radiusRef = useRef(searchRadius);
  radiusRef.current = searchRadius;
  // Anti-chevauchement : on ne lance PAS un nouveau poll si le précédent n'est
  // pas terminé. Sans cette garde, sous contention DB les Server Actions
  // (sérialisées par Next) s'empilent → file engorgée → écrans très lents.
  const pollBusy = useRef(false);
  useEffect(() => {
    void getChauffeurPlanRate().then(setPlanRate);
  }, []);

  // « Je rentre chez moi » (G4) : toggle partagé avec l'accueil + domicile
  // géocodé + tolérance angulaire (config admin).
  const [homeDir, setHomeDir] = useState<{
    on: boolean;
    addr: string | null;
    lat: number | null;
    lng: number | null;
    tolerance: number;
  }>({ on: false, addr: null, lat: null, lng: null, tolerance: 45 });
  useEffect(() => {
    const on = localStorage.getItem(HOME_DIR_KEY) === "1";
    void getChauffeurGate().then((g) => {
      if (g) {
        setChId(g.id);
        setHomeDir({
          on,
          addr: g.homeAddr,
          lat: g.homeLat,
          lng: g.homeLng,
          tolerance: g.homeDirToleranceDeg,
        });
      }
    });
  }, []);

  const poll = useCallback(async () => {
    if (pollBusy.current) return; // le précédent tourne encore → on saute
    const c = coordsRef.current;
    if (!c) return;
    pollBusy.current = true;
    try {
      // Heartbeat « en ligne » UNIQUEMENT quand on poll (donc en ligne) → hors
      // ligne, la présence reste à false et le chauffeur n'est pas dispatché.
      void chauffeurHeartbeat(c.latitude, c.longitude, true);
      const [list, active] = await Promise.all([
        getNearbyRides(c.latitude, c.longitude, radiusRef.current),
        getChauffeurActiveRide(),
      ]);
      if (active) {
        router.replace("/chauffeur/course");
        return;
      }
      lastNearbyCache = list; // alimente le cache SWR
      setReqs(list);
      setLoading(false);
    } finally {
      pollBusy.current = false;
    }
  }, [router]);
  // GATÉ sur l'état en ligne : hors ligne, AUCUN poll (pas d'écoute). Filet à
  // 12 s — le temps réel (canal ci-dessous) assure l'instantané des nouvelles
  // demandes ; inutile de marteler la base toutes les 5 s.
  useEffect(() => {
    if (!online) return;
    void poll();
    const id = setInterval(poll, 12000);
    return () => clearInterval(id);
  }, [poll, online]);
  const gotFirstFix = useRef(false);
  useEffect(() => {
    if (online && coords && !gotFirstFix.current) {
      gotFirstFix.current = true;
      void poll();
    }
  }, [coords, poll, online]);

  // Temps réel (mig 0149) : nouvelles demandes instantanées + redirection
  // immédiate quand le client accepte UNE de mes offres.
  useEffect(() => {
    if (!online) return;
    const supabase = createClient();
    const chans = [
      supabase
        .channel("nearby-rides")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "rides" },
          () => void poll()
        )
        .subscribe(),
      ...(chId
        ? [
            supabase
              .channel(`my-offers-${chId}`)
              .on(
                "postgres_changes",
                {
                  event: "UPDATE",
                  schema: "public",
                  table: "ride_offers",
                  filter: `chauffeur_id=eq.${chId}`,
                },
                (payload) => {
                  if (
                    (payload.new as { status?: string }).status === "accepted"
                  )
                    router.replace("/chauffeur/course");
                }
              )
              .subscribe(),
          ]
        : []),
    ];
    return () => {
      for (const c of chans) void supabase.removeChannel(c);
    };
  }, [poll, chId, router, online]);

  // GO depuis la page Demandes : passe en ligne (intention + présence serveur).
  const goOnline = async () => {
    if (goingOnline) return;
    setGoingOnline(true);
    setChauffeurOnlineLocal(true);
    await setChauffeurOnline(true);
    setGoingOnline(false);
  };

  // Hors ligne : AUCUNE écoute. On invite explicitement à passer en ligne.
  if (!online) {
    return (
      <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-surface)] px-[18px] pt-[52px] pb-24">
        <h1 className="drive-sora text-[20px] font-extrabold tracking-[-0.5px]">
          Demandes de courses
        </h1>
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <span
            className="grid size-16 place-items-center rounded-full"
            style={{ background: "rgba(156,163,175,.15)" }}
          >
            <Power className="size-8" style={{ color: "#9CA3AF" }} />
          </span>
          <div className="max-w-xs">
            <h2 className="drive-sora text-[18px] font-extrabold">
              Vous êtes hors ligne
            </h2>
            <p className="mt-1 text-[13px] text-[var(--d-muted)]">
              Passez en ligne pour être à l&apos;écoute et recevoir les demandes
              de course autour de vous.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void goOnline()}
            disabled={goingOnline}
            className="drive-sora flex h-[52px] w-full max-w-xs items-center justify-center gap-2 rounded-[16px] text-base font-extrabold text-white disabled:opacity-60"
            style={{ background: GO, boxShadow: `0 12px 24px -10px ${GO}` }}
          >
            {goingOnline ? <Loader2 className="size-5 animate-spin" /> : null}
            Passer en ligne · GO
          </button>
        </div>
      </div>
    );
  }

  const total = (q: NearbyRide) => q.proposed_price_da + q.boost_amount_da;
  const advised = (q: NearbyRide) =>
    q.suggested_price_da > 0 ? q.suggested_price_da : total(q);
  // Plafond de la contre-offre (≈ 1,85× le conseillé, arrondi au pas).
  const maxPrice = (q: NearbyRide) =>
    Math.round((advised(q) * 1.85) / priceStep) * priceStep;
  // Plancher local de la contre-offre (le serveur fait foi : ~70 % du
  // conseillé) — la contre-offre peut descendre SOUS le prix client.
  const minCounter = (q: NearbyRide) =>
    Math.max(priceStep, Math.round((advised(q) * 0.7) / priceStep) * priceStep);

  // Séparation Demandes / Propositions (offre déjà envoyée → my_offer_da/sent).
  const isProposed = (q: NearbyRide) =>
    q.my_offer_da != null || sent[q.id] != null;
  const dirActive = homeDir.on && homeDir.lat != null && homeDir.lng != null;
  const inDirection = (q: NearbyRide) =>
    !dirActive ||
    (q.pickup_lat != null &&
      q.dest_lat != null &&
      isTowardsHome(
        { lat: q.pickup_lat, lng: q.pickup_lng! },
        { lat: q.dest_lat, lng: q.dest_lng! },
        { lat: homeDir.lat!, lng: homeDir.lng! },
        homeDir.tolerance
      ));

  const demandes = reqs.filter((q) => !isProposed(q) && inDirection(q));
  const proposed = reqs.filter((q) => isProposed(q));
  if (sort === "pay") demandes.sort((a, b) => total(b) - total(a));
  else demandes.sort((a, b) => a.pickup_dist_km - b.pickup_dist_km);
  demandes.sort(
    (a, b) => Number(b.boost_amount_da > 0) - Number(a.boost_amount_da > 0)
  );

  const propose = async (q: NearbyRide, price: number) => {
    setErrors((e) => ({ ...e, [q.id]: "" }));
    const res = await offerRide(q.id, price);
    if (res.ok) {
      setSent((s) => ({ ...s, [q.id]: price }));
      setTab("proposed");
    } else
      setErrors((e) => ({
        ...e,
        [q.id]:
          res.error === "female_only"
            ? "Demande réservée aux conductrices."
            : res.error === "gamme_mismatch"
              ? "Cette demande ne correspond pas à votre gamme."
              : res.error === "below_floor"
                ? "Prix trop bas pour ce trajet — remontez votre offre."
                : (res.error ?? "Proposition impossible"),
      }));
  };

  // Refus / annulation : la demande disparaît pour ce chauffeur (mig 0149).
  const decline = async (q: NearbyRide) => {
    setReqs((list) => list.filter((x) => x.id !== q.id));
    setSent((s) => {
      const n = { ...s };
      delete n[q.id];
      return n;
    });
    await declineRide(q.id);
  };

  const adjust = (q: NearbyRide, dir: 1 | -1) => {
    const cur = myPrices[q.id] ?? total(q);
    const next =
      dir > 0
        ? Math.min(maxPrice(q), cur + priceStep)
        : Math.max(minCounter(q), cur - priceStep);
    setMyPrices((p) => ({ ...p, [q.id]: next }));
  };

  /* ── Écran : trajet sur la carte (DriveMap plein écran) ── */
  if (mapReq) {
    const me = coords ? { lat: coords.latitude, lng: coords.longitude } : null;
    const pickup =
      mapReq.pickup_lat != null
        ? { lat: mapReq.pickup_lat, lng: mapReq.pickup_lng! }
        : null;
    const dest =
      mapReq.dest_lat != null
        ? { lat: mapReq.dest_lat, lng: mapReq.dest_lng! }
        : null;
    return (
      <div className="drive-jakarta drive-screen bg-[var(--d-page)]">
        <DriveMap
          markers={[
            ...(me ? [{ id: "car", pos: me, kind: "car" as const }] : []),
            ...(pickup
              ? [{ id: "cli", pos: pickup, kind: "me" as const }]
              : []),
            ...(dest ? [{ id: "dest", pos: dest, kind: "pin" as const }] : []),
          ]}
          approach={me && pickup ? [me, pickup] : null}
          route={pickup && dest ? [pickup, dest] : null}
          padding={{ top: 100, bottom: 280, left: 50, right: 50 }}
        />
        <div className="pointer-events-none absolute top-[88px] left-1/2 z-10 flex -translate-x-1/2 gap-2">
          <span className="rounded-full border-[1.5px] border-[var(--d-line)] bg-[var(--d-surface)] px-3 py-1.5 text-[11px] font-extrabold text-[var(--d-muted)] shadow">
            {fmtkm(mapReq.pickup_dist_km)} · approche
          </span>
          <span
            className="rounded-full border-[1.5px] bg-[var(--d-surface)] px-3 py-1.5 text-[11px] font-extrabold shadow"
            style={{ borderColor: VIOLET, color: VIOLET }}
          >
            {fmtkm(mapReq.distance_km)} · course
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMapReq(null)}
          className="absolute top-3 left-4 z-10 grid size-[42px] place-items-center rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow-lg"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div className="absolute inset-x-0 bottom-0 z-10 rounded-t-[26px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-4 pb-[max(24px,env(safe-area-inset-bottom))]">
          <div className="mb-1.5 flex items-center gap-2.5">
            <span
              className="drive-sora grid size-9 shrink-0 place-items-center rounded-full text-sm font-extrabold text-white"
              style={{
                background: `linear-gradient(135deg,#7B7BF0,${VIOLET})`,
              }}
            >
              {mapReq.customer_name[0]?.toUpperCase()}
            </span>
            <span>
              <b className="drive-sora text-sm">
                {mapReq.customer_name}
                {mapReq.gamme === "confort" ? " · Confort" : ""}
              </b>
              <span className="block text-[12px] text-[var(--d-muted)]">
                {mapReq.pickup_text ?? "—"} → {mapReq.dest_text ?? "—"}
              </span>
            </span>
          </div>
          <div className="mb-3 flex flex-col gap-1.5 rounded-[12px] bg-[var(--d-soft)] px-3 py-2.5 text-[12.5px] font-semibold text-[var(--d-muted)]">
            <span className="flex items-center gap-2">
              <i className="size-[9px] rounded-full bg-[#B7BBC8]" />
              Vous → client
              <b className="drive-sora ml-auto text-[var(--d-ink)]">
                {fmtkm(mapReq.pickup_dist_km)}
              </b>
            </span>
            <span className="flex items-center gap-2">
              <i className="size-[9px] rounded-[2px] bg-[var(--d-ink)]" />
              Client → destination
              <b className="drive-sora ml-auto text-[var(--d-ink)]">
                {fmtkm(mapReq.distance_km)}
              </b>
            </span>
          </div>
          <PrimaryBtn onClick={() => setMapReq(null)} className="!mt-0">
            Retour aux demandes
          </PrimaryBtn>
        </div>
      </div>
    );
  }

  const list = tab === "demandes" ? demandes : proposed;

  /* ── Liste des demandes / propositions ── */
  return (
    <div className="drive-jakarta drive-page flex min-h-screen flex-col bg-[var(--d-surface)] pb-24">
      {/* En-tête (remonté pour gagner de la place en bas) */}
      <div className="px-[18px] pt-[28px]">
        <h1 className="drive-sora text-[20px] font-extrabold tracking-[-0.5px]">
          Demandes de courses
        </h1>
        <p className="mt-0.5 text-[11.5px] font-medium text-[var(--d-muted)]">
          <b style={{ color: GO }}>{demandes.length}</b> course
          {demandes.length > 1 ? "s" : ""} disponible
          {demandes.length > 1 ? "s" : ""}
        </p>

        {/* Filtres — compacts, sur une seule ligne */}
        <div className="mt-2 flex items-center gap-1.5">
          {(
            [
              ["near", "Plus proches"],
              ["pay", "Mieux payées"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSort(k)}
              className="drive-sora flex h-7 items-center rounded-[14px] border px-3 text-[10px] font-bold transition-colors"
              style={
                sort === k
                  ? {
                      background: "#F1E9FC",
                      color: VIOLET,
                      borderColor: "#F1E9FC",
                    }
                  : { borderColor: "var(--d-line)", color: "var(--d-muted)" }
              }
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCompact((c) => !c)}
            className="drive-sora flex h-7 items-center gap-1 rounded-[14px] border px-3 text-[10px] font-bold"
            style={
              compact
                ? {
                    background: "#F1E9FC",
                    color: VIOLET,
                    borderColor: "#F1E9FC",
                  }
                : { borderColor: "var(--d-line)", color: "var(--d-muted)" }
            }
          >
            <Rows3 className="size-3" /> Compact
          </button>
        </div>
      </div>

      {/* Onglets Demandes / Propositions */}
      <div className="mt-2.5 flex border-b border-[var(--d-line)]">
        {(
          [
            ["demandes", "Demandes", demandes.length],
            ["proposed", "Propositions", proposed.length],
          ] as const
        ).map(([k, label, count]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className="drive-sora relative h-[38px] flex-1 text-[12px] font-bold"
            style={{ color: tab === k ? VIOLET : "var(--d-muted)" }}
          >
            {label}
            <span
              className="ml-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] px-1.5 text-[9px] font-extrabold"
              style={
                tab === k
                  ? { background: "#F1E9FC", color: VIOLET }
                  : { background: "var(--d-soft)", color: "var(--d-muted)" }
              }
            >
              {count}
            </span>
            {tab === k && (
              <span
                className="absolute inset-x-[20%] bottom-0 h-[3px] rounded-[3px]"
                style={{ background: VIOLET }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Filtre « je rentre chez moi » actif */}
      {dirActive && tab === "demandes" && (
        <div
          className="mx-[18px] mt-2.5 flex items-center gap-2.5 rounded-[14px] px-3.5 py-2.5"
          style={{ background: "#F1E9FC" }}
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-[9px] bg-[var(--d-surface)]">
            <Home className="size-3.5" style={{ color: VIOLET }} />
          </span>
          <span className="min-w-0">
            <b className="block text-[11.5px]" style={{ color: VIOLET }}>
              Filtre actif · vers {homeDir.addr ?? "votre domicile"}
            </b>
            <span className="text-[10px] text-[var(--d-muted)]">
              {demandes.length} course{demandes.length > 1 ? "s" : ""} dans
              votre direction
            </span>
          </span>
        </div>
      )}

      <div className="flex-1 px-[18px] pt-2.5">
        {loading && list.length === 0 && tab === "demandes" && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Loader2
              className="size-7 animate-spin"
              style={{ color: VIOLET }}
            />
            <p className="text-sm font-semibold text-[var(--d-muted)]">
              Recherche des demandes autour de vous…
            </p>
          </div>
        )}

        {!loading && list.length === 0 && (
          <p className="py-12 text-center text-sm text-[var(--d-muted)]">
            {tab === "proposed"
              ? "Aucune proposition en attente."
              : dirActive
                ? "Aucune course vers votre domicile pour le moment."
                : "Aucune demande autour de vous pour le moment."}
          </p>
        )}

        {list.map((q) => {
          const client = total(q);
          const propPrice =
            tab === "proposed" ? (q.my_offer_da ?? sent[q.id] ?? client) : null;
          const myPrice = myPrices[q.id] ?? client;
          const max = maxPrice(q);
          const totalDist = q.pickup_dist_km + q.distance_km;
          const priceColor =
            myPrice >= max
              ? RED
              : myPrice > advised(q)
                ? AMBER
                : "var(--d-ink)";

          return (
            <div
              key={q.id}
              className="drive-rise mb-2.5 overflow-hidden rounded-[16px] border bg-[var(--d-surface)]"
              style={{
                borderColor: q.boost_amount_da > 0 ? GO : "var(--d-line)",
              }}
            >
              {/* En-tête : avatar | nom · note · temps | km | prix */}
              <div className="flex items-center gap-2.5 px-3.5 pt-3">
                <span
                  className="drive-sora grid size-[34px] shrink-0 place-items-center rounded-full text-[13px] font-extrabold text-white"
                  style={{
                    background: q.female_only
                      ? `linear-gradient(135deg,#F9A8D4,${ROSE})`
                      : `linear-gradient(135deg,#7B7BF0,${VIOLET})`,
                  }}
                >
                  {q.customer_name[0]?.toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="drive-sora flex flex-wrap items-center gap-1.5 text-[12.5px] font-bold">
                    {q.customer_name}
                    {q.customer_rating != null && (
                      <span className="text-[9.5px] text-[#E8B53C]">
                        ★ {String(q.customer_rating).replace(".", ",")}
                      </span>
                    )}
                    <span className="text-[9px] font-medium text-[var(--d-muted)]">
                      · {ago(q.created_at)}
                    </span>
                    {q.boost_amount_da > 0 && (
                      <span
                        className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold"
                        style={{
                          background: "rgba(22,179,100,.12)",
                          color: GO,
                        }}
                      >
                        <Zap className="size-2.5" /> Boostée
                      </span>
                    )}
                    {q.gamme === "confort" && (
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold"
                        style={{ background: "#F1E9FC", color: VIOLET }}
                      >
                        Confort
                      </span>
                    )}
                    {q.female_only && (
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold"
                        style={{
                          background: "rgba(236,72,153,.13)",
                          color: ROSE,
                        }}
                      >
                        Femme au volant
                      </span>
                    )}
                  </div>
                </div>
                <span className="drive-sora shrink-0 text-[11px] font-bold whitespace-nowrap text-[var(--d-muted)]">
                  {fmtkm(totalDist)}
                </span>
                <div className="shrink-0 text-right">
                  <div className="drive-sora text-[22px] leading-none font-extrabold">
                    {propPrice ?? client}
                  </div>
                  <div className="text-[9.5px] font-semibold text-[var(--d-muted)]">
                    {tab === "proposed" ? "DA proposé" : "DA"}
                  </div>
                </div>
              </div>

              {/* Trajet : rail + adresses + distances */}
              <div className="flex gap-2.5 px-3.5 pt-2.5">
                <div className="flex w-4 shrink-0 flex-col items-center pt-0.5">
                  <span className="size-[7px] shrink-0 rounded-full bg-[var(--d-muted)]" />
                  <span className="my-0.5 min-h-3 w-[1.5px] flex-1 bg-[var(--d-line)]" />
                  <span className="size-[7px] shrink-0 rounded-full bg-[var(--d-ink)]" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex items-baseline gap-1.5">
                    <span className="w-9 shrink-0 text-[7.5px] font-bold tracking-wide text-[var(--d-muted)] uppercase opacity-70">
                      Départ
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-semibold">
                      {q.pickup_text ?? "—"}
                    </span>
                    <span className="drive-sora shrink-0 text-[9.5px] font-bold text-[var(--d-muted)]">
                      {fmtkm(q.pickup_dist_km)}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="w-9 shrink-0 text-[7.5px] font-bold tracking-wide text-[var(--d-muted)] uppercase opacity-70">
                      Arrivée
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-semibold">
                      {q.dest_text ?? "—"}
                    </span>
                    <span className="drive-sora shrink-0 text-[9.5px] font-bold text-[var(--d-muted)]">
                      {fmtkm(q.distance_km)}
                    </span>
                  </div>
                </div>
              </div>

              {tab === "proposed" ? (
                <>
                  <div className="flex items-center gap-1.5 px-3.5 pt-2 text-[11px] font-semibold text-[var(--d-muted)]">
                    <span
                      className="size-1.5 animate-pulse rounded-full"
                      style={{ background: "var(--d-muted)" }}
                    />
                    En attente du client…
                  </div>
                  <div className="flex flex-col gap-1.5 px-3.5 pt-2.5 pb-3">
                    <div
                      className="flex h-10 items-center justify-center gap-1.5 rounded-[10px] text-[12px] font-bold"
                      style={{
                        background: "var(--d-soft)",
                        color: "var(--d-muted)",
                      }}
                    >
                      <Loader2 className="size-3.5 animate-spin" /> En attente…
                    </div>
                    <button
                      type="button"
                      onClick={() => void decline(q)}
                      className="flex h-[34px] w-full items-center justify-center gap-1.5 rounded-[10px] border border-[var(--d-line)] text-[11.5px] font-semibold text-[var(--d-muted)]"
                    >
                      <X className="size-3.5" /> Annuler
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {!compact && (
                    <>
                      <button
                        type="button"
                        onClick={() => setMapReq(q)}
                        className="relative mx-3.5 mt-2 block h-[72px] w-[calc(100%-28px)] overflow-hidden rounded-[10px] border border-[var(--d-line)]"
                      >
                        <MiniMap
                          seed={
                            q.customer_name.charCodeAt(0) +
                            Math.round(q.distance_km)
                          }
                        />
                        <span className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-[8px] border border-white/60 bg-[var(--d-surface)]/80 backdrop-blur">
                          <Maximize2 className="size-3.5" />
                        </span>
                      </button>
                      <div className="flex items-center gap-1.5 px-3.5 pt-2 text-[9.5px] font-medium text-[var(--d-muted)]">
                        Client{" "}
                        <b className="text-[var(--d-ink)]">{client} DA</b>
                        <span className="text-[var(--d-line)]">·</span>
                        Conseillé{" "}
                        <b className="text-[var(--d-ink)]">{advised(q)} DA</b>
                        <span className="text-[var(--d-line)]">·</span>
                        net ≈{" "}
                        <b style={{ color: GO }}>
                          {Math.round(myPrice * (1 - planRate))} DA
                        </b>
                      </div>
                    </>
                  )}

                  {/* Ajusteur de prix */}
                  <div className="flex items-center gap-0 px-3.5 pt-2">
                    <button
                      type="button"
                      onClick={() => adjust(q, -1)}
                      className="drive-sora grid size-[34px] shrink-0 place-items-center rounded-[10px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-soft)] text-[16px] font-extrabold active:border-[color:var(--d-muted)]"
                    >
                      −
                    </button>
                    <div
                      className="drive-sora flex-1 text-center text-[22px] font-extrabold tracking-[-0.5px]"
                      style={{ color: priceColor }}
                    >
                      {myPrice}{" "}
                      <span className="text-[12px] font-bold text-[var(--d-muted)]">
                        DA
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => adjust(q, 1)}
                      className="drive-sora grid size-[34px] shrink-0 place-items-center rounded-[10px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-soft)] text-[16px] font-extrabold"
                    >
                      +
                    </button>
                  </div>

                  {errors[q.id] && (
                    <p
                      className="px-3.5 pt-2 text-center text-[11px] font-bold"
                      style={{ color: RED }}
                    >
                      {errors[q.id]}
                    </p>
                  )}

                  {/* Actions */}
                  <div className="flex flex-col gap-1.5 px-3.5 pt-2.5 pb-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void propose(q, myPrice)}
                        className="drive-sora flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[12px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-surface)] text-[13px] font-bold"
                      >
                        <Send className="size-3.5" /> Proposer {myPrice}
                      </button>
                      <button
                        type="button"
                        onClick={() => void propose(q, client)}
                        className="drive-shine drive-sora flex h-11 flex-[1.4] items-center justify-center gap-1.5 rounded-[12px] text-[14px] font-extrabold text-white"
                        style={{
                          background: GO,
                          boxShadow: `0 8px 22px -8px ${GO}`,
                        }}
                      >
                        <Check className="size-4" /> Accepter
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => void decline(q)}
                      className="flex h-[34px] w-full items-center justify-center gap-1.5 rounded-[10px] border border-[var(--d-line)] text-[11.5px] font-semibold text-[var(--d-muted)]"
                    >
                      <X className="size-3.5" /> Refuser cette course
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
