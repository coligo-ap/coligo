"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Home,
  Loader2,
  Maximize2,
  Power,
  Route,
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
import { useRoadPath } from "@/lib/drive/use-road-path";
import { interWilayaInfo } from "@/lib/drive/interwilaya";
import { useSearchRadius } from "@/lib/chauffeur/work-zone";
import { usePageVisible } from "@/lib/realtime/use-page-visible";
import { onVisibleResumeSafe } from "@/lib/net/probe";
import { setDispatchActive } from "@/lib/realtime/dispatch-presence";
import { ensureRealtimeAuth } from "@/lib/realtime/ensure-auth";
import {
  chauffeurHeartbeat,
  declineRide,
  getChauffeurGate,
  getChauffeurPlanRate,
  getDemandesTick,
  getInterTick,
  offerRide,
  setChauffeurOnline,
  type InterwilayaFlagInfo,
  type NearbyRide,
} from "@/app/(chauffeur)/actions";
import { useHomeDirOn } from "@/lib/chauffeur/home-dir-store";
import { passesHomeDir } from "@/lib/chauffeur/dispatch-filter";
import { registerChauffeurCacheReset } from "@/lib/chauffeur/client-cache";

const AMBER = "#F59E0B";

// Cache module (SWR) : dernière liste de demandes connue. Au RETOUR sur l'écran
// Drive, on l'affiche INSTANTANÉMENT (pas de loader, pas d'écran « vide ») ; le
// poll/temps réel rafraîchit en ARRIÈRE-PLAN. Le shell statique (titre, filtres,
// onglets) n'attend jamais. Survit aux navigations (niveau module), vidé à la
// fermeture de l'onglet.
let lastNearbyCache: NearbyRide[] = [];
// Cache jumeau de la sous-page INTER-WILAYAS (rayon élargi, liste distincte).
let lastInterCache: NearbyRide[] = [];
// Vidange au changement de compte (anti-fuite sur appareil partagé).
registerChauffeurCacheReset(() => {
  lastNearbyCache = [];
  lastInterCache = [];
});

const fmtkm = (v: number) =>
  `${(Math.round(v * 10) / 10).toString().replace(".", ",")} km`;
const ago = (iso: string, isAr: boolean) => {
  const s = Math.max(
    5,
    Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  );
  if (s < 60) return isAr ? `قبل ${s} ث` : `il y a ${s} s`;
  return isAr
    ? `قبل ${Math.round(s / 60)} د`
    : `il y a ${Math.round(s / 60)} min`;
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
export function DRequests({
  priceStep = 20,
  scope = "all",
}: {
  priceStep?: number;
  /** "all" = page Demandes classique · "inter" = sous-page Inter-wilayas
   *  (demandes longue distance, rayon d'approche élargi côté serveur). */
  scope?: "all" | "inter";
}) {
  const router = useRouter();
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const interScope = scope === "inter";
  // Course à SURLIGNER : portée par le clic sur la notification push
  // (route `/chauffeur/demandes?ride=<id>`). On bascule sur le bon onglet, on
  // centre la carte et on la cercle en violet → le chauffeur identifie tout de
  // suite la demande notifiée.
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("ride");
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const highlightDone = useRef<string | null>(null);
  const coords = useDriverPosition();
  // À L'ÉCOUTE seulement si EN LIGNE (intention partagée avec l'accueil).
  const online = useChauffeurOnline();
  // Hygiène connexions Realtime (quota Free partagé) : canal de dispatch ouvert
  // au premier plan seulement ; FCM + poll de secours couvrent l'arrière-plan.
  const visible = usePageVisible();
  const [goingOnline, setGoingOnline] = useState(false);
  // Initialisé depuis le cache module → affichage instantané au retour (SWR).
  const [reqs, setReqs] = useState<NearbyRide[]>(
    interScope ? lastInterCache : lastNearbyCache
  );
  const [loading, setLoading] = useState(
    (interScope ? lastInterCache : lastNearbyCache).length === 0
  );
  const [tab, setTab] = useState<"demandes" | "proposed">("demandes");
  const [sort, setSort] = useState<"near" | "pay">("near");
  // Lentille d'affichage Ville / Inter-wilayas (page Demandes uniquement) :
  // le chauffeur REÇOIT tout, il choisit juste ce qu'il regarde.
  const [tripFilter, setTripFilter] = useState<"all" | "ville" | "inter">(
    "all"
  );
  // Kill-switch super-admin de l'inter-wilayas (sous-page dédiée).
  const [iwFlag, setIwFlag] = useState<InterwilayaFlagInfo | null>(null);
  // Mode compact : PERSISTÉ en localStorage → le chauffeur le règle une fois et
  // le retrouve à chaque ouverture (chargé après montage pour éviter tout
  // décalage d'hydratation).
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("coligo_chauffeur_compact") === "1")
        setCompact(true);
    } catch {
      /* localStorage indispo */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("coligo_chauffeur_compact", compact ? "1" : "0");
    } catch {
      /* localStorage indispo */
    }
  }, [compact]);
  const [myPrices, setMyPrices] = useState<Record<string, number>>({});
  const [sent, setSent] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [mapReq, setMapReq] = useState<NearbyRide | null>(null);
  // Itinéraires RÉELS (OSRM) pour la carte de l'offre : la course ET l'approche
  // suivent les vraies routes (jamais une ligne droite — les routes ne sont pas
  // droites). Repli transitoire ligne droite le temps du calcul.
  const mapPickupPos =
    mapReq?.pickup_lat != null
      ? { lat: mapReq.pickup_lat, lng: mapReq.pickup_lng! }
      : null;
  const mapDestPos =
    mapReq?.dest_lat != null
      ? { lat: mapReq.dest_lat, lng: mapReq.dest_lng! }
      : null;
  const mapMePos = coords
    ? { lat: coords.latitude, lng: coords.longitude }
    : null;
  const mapRoutePath = useRoadPath(mapPickupPos, mapDestPos);
  const mapApproachPath = useRoadPath(mapMePos, mapPickupPos);
  // Net estimé : taux de commission du plan (free 8 % / pro / premium).
  const [planRate, setPlanRate] = useState(0.08);
  const [chId, setChId] = useState<string | null>(null);
  // user_id auth → canal Realtime perso `chauffeur:{userId}` (dispatch push).
  const [userId, setUserId] = useState<string | null>(null);
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

  // « Je rentre chez moi » (G4) : état RÉACTIF partagé avec l'accueil (store) →
  // une bascule sur l'Accueil se reflète LIVE ici, sans dépendre du remontage.
  // Le domicile géocodé + la tolérance angulaire viennent du gate (config admin).
  const homeDirOn = useHomeDirOn();
  const [homeDir, setHomeDir] = useState<{
    addr: string | null;
    lat: number | null;
    lng: number | null;
    tolerance: number;
  }>({ addr: null, lat: null, lng: null, tolerance: 45 });
  // REPLI de position : dernière position connue côté serveur (présence). Sert
  // quand le GPS du navigateur n'a pas encore de fix (ou est refusé) → on
  // interroge quand même les demandes autour de cette position. Sans ce repli,
  // `poll` sortait tôt (coords nulles) et la liste restait vide alors que le
  // chauffeur avait bien reçu une push (donc une présence serveur près du
  // départ). Le GPS frais reprend la main dès qu'il arrive.
  const fallbackRef = useRef<{ latitude: number; longitude: number } | null>(
    null
  );
  // Passe à true quand le gate (et donc le repli de position) est chargé → on
  // relance alors un poll si le GPS n'a toujours rien livré.
  const [presenceReady, setPresenceReady] = useState(false);
  useEffect(() => {
    void getChauffeurGate().then((g) => {
      if (g) {
        setChId(g.id);
        setUserId(g.userId);
        setHomeDir({
          addr: g.homeAddr,
          lat: g.homeLat,
          lng: g.homeLng,
          tolerance: g.homeDirToleranceDeg,
        });
        fallbackRef.current =
          g.presenceLat != null && g.presenceLng != null
            ? { latitude: g.presenceLat, longitude: g.presenceLng }
            : null;
      }
      setPresenceReady(true);
    });
  }, []);

  const poll = useCallback(async () => {
    if (pollBusy.current) return; // le précédent tourne encore → on saute
    // Position : GPS live en priorité, sinon repli sur la présence serveur.
    const live = coordsRef.current;
    const c = live ?? fallbackRef.current;
    if (!c) return;
    pollBusy.current = true;
    try {
      // Heartbeat « en ligne » UNIQUEMENT avec un VRAI fix GPS (ne pas réécrire
      // une position de repli périmée). Hors ligne, on ne poll pas du tout.
      if (live)
        void chauffeurHeartbeat(
          live.latitude,
          live.longitude,
          true,
          live.heading
        );
      // UN SEUL POST (consolidé) au lieu de 2 Server Actions sérialisées.
      if (interScope) {
        // Sous-page Inter-wilayas : rayon élargi côté serveur + état du flag.
        const {
          nearby: list,
          activeRide: active,
          flag,
        } = await getInterTick(c.latitude, c.longitude);
        setIwFlag(flag);
        if (active) {
          router.replace("/chauffeur/course");
          return;
        }
        lastInterCache = list;
        setReqs(list);
        setLoading(false);
      } else {
        const { nearby: list, activeRide: active } = await getDemandesTick(
          c.latitude,
          c.longitude,
          radiusRef.current
        );
        if (active) {
          router.replace("/chauffeur/course");
          return;
        }
        lastNearbyCache = list; // alimente le cache SWR
        setReqs(list);
        setLoading(false);
      }
    } finally {
      pollBusy.current = false;
    }
  }, [router, interScope]);
  // GATÉ sur l'état en ligne : hors ligne, AUCUN poll (pas d'écoute). Filet à
  // 12 s — le temps réel (canal ci-dessous) assure l'instantané des nouvelles
  // demandes ; inutile de marteler la base toutes les 5 s.
  useEffect(() => {
    if (!online) return;
    void poll();
    // FILET FIABLE (le dispatch push fait l'instantané, mais la réception NE DOIT
    // PAS en dépendre seule) : poll 15 s → réception garantie même broadcast raté.
    const id = setInterval(poll, 15000);
    // RATTRAPAGE au retour au premier plan (broadcast manqué en arrière-plan),
    // SONDÉ après une longue absence (anti requête fantôme sur socket mort).
    const offVisible = onVisibleResumeSafe(() => void poll());
    return () => {
      clearInterval(id);
      offVisible();
    };
  }, [poll, online]);
  const gotFirstFix = useRef(false);
  useEffect(() => {
    if (online && coords && !gotFirstFix.current) {
      gotFirstFix.current = true;
      void poll();
    }
  }, [coords, poll, online]);
  // GPS muet mais présence serveur connue → on poll quand même via le repli (un
  // chauffeur qui a reçu une push DOIT voir la course même sans fix navigateur).
  useEffect(() => {
    if (online && presenceReady && !coords) void poll();
  }, [online, presenceReady, coords, poll]);

  // Changement de FILTRE → re-poll IMMÉDIAT (sans attendre le cycle 12 s). Le
  // rayon « ma zone » filtre côté serveur : élargir la zone doit ramener tout de
  // suite les nouvelles courses. « Rentrer chez moi » filtre côté client, mais on
  // rafraîchit aussi pour rester à jour. On saute le tout premier rendu (déjà
  // couvert par les effets de boot ci-dessus).
  const filtersReady = useRef(false);
  useEffect(() => {
    if (!online) return;
    if (!filtersReady.current) {
      filtersReady.current = true;
      return;
    }
    void poll();
  }, [searchRadius, homeDirOn, online, poll]);

  // Temps réel (mig 0149) : nouvelles demandes instantanées + redirection
  // immédiate quand le client accepte UNE de mes offres.
  useEffect(() => {
    if (!online || !visible) return;
    // Dispatch in-app actif → le push FCM web ne doublera pas la notif (dédup).
    setDispatchActive("chauffeur", true);
    const supabase = createClient();
    const chans: ReturnType<typeof supabase.channel>[] = [];
    let cancelled = false;
    void (async () => {
      // JWT garanti sur le socket AVANT le canal PRIVÉ (sinon CHANNEL_ERROR).
      await ensureRealtimeAuth(supabase);
      if (cancelled) return;
      // Dispatch push CIBLÉ : canal perso (plus d'écoute globale des INSERT).
      // Tant que le user_id n'est pas chargé (gate), on n'ouvre pas ce canal.
      if (userId) {
        chans.push(
          supabase
            .channel(`chauffeur:${userId}`, { config: { private: true } })
            .on("broadcast", { event: "new_ride" }, () => void poll())
            // La demande n'est plus à prendre (client a choisi quelqu'un,
            // recherche annulée…) : RETRAIT IMMÉDIAT de l'écran — pas
            // d'attente du poll, un chauffeur ne doit jamais proposer sur une
            // course déjà prise. Si C'EST MOI le retenu : bascule instantanée
            // sur ma course (ceinture en plus du canal my-offers).
            .on("broadcast", { event: "ride_gone" }, (msg) => {
              const p = (msg as { payload?: Record<string, unknown> })
                .payload as
                | { rideId?: string; winnerUserId?: string | null }
                | undefined;
              if (!p?.rideId) return;
              if (p.winnerUserId && p.winnerUserId === userId) {
                router.replace("/chauffeur/course");
                return;
              }
              lastNearbyCache = lastNearbyCache.filter(
                (x) => x.id !== p.rideId
              );
              lastInterCache = lastInterCache.filter((x) => x.id !== p.rideId);
              setReqs((list) => list.filter((x) => x.id !== p.rideId));
            })
            .subscribe()
        );
      }
      if (chId) {
        chans.push(
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
                if ((payload.new as { status?: string }).status === "accepted")
                  router.replace("/chauffeur/course");
              }
            )
            .subscribe()
        );
      }
    })();
    return () => {
      cancelled = true;
      setDispatchActive("chauffeur", false);
      for (const c of chans) void supabase.removeChannel(c);
    };
  }, [poll, chId, userId, router, online, visible]);

  // Surlignage de la course notifiée : dès qu'elle est présente dans la liste
  // (le poll/temps réel l'a ramenée), on sélectionne l'onglet où elle se trouve
  // et on la centre à l'écran. Une seule fois par id (l'utilisateur garde la
  // main ensuite). Si elle n'est pas encore chargée, on retentera au prochain
  // rafraîchissement de `reqs`.
  useEffect(() => {
    if (!highlightId || highlightDone.current === highlightId) return;
    const q = reqs.find((r) => r.id === highlightId);
    if (!q) return;
    highlightDone.current = highlightId;
    setTab(q.my_offer_da != null ? "proposed" : "demandes");
    const t = setTimeout(() => {
      cardRefs.current[highlightId]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 80);
    return () => clearTimeout(t);
  }, [highlightId, reqs]);

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
      <div className="drive-jakarta drive-page pt-safe-lg pb-safe-nav min-h-screen bg-[var(--d-surface)] px-[18px]">
        <h1 className="drive-sora text-[20px] font-extrabold tracking-[-0.5px]">
          {interScope
            ? tr("Trajets Inter-wilayas", "مشاوير بين الولايات")
            : tr("Demandes de courses", "طلبات المشاوير")}
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
              {tr("Vous êtes hors ligne", "أنت غير متصل")}
            </h2>
            <p className="mt-1 text-[13px] text-[var(--d-muted)]">
              {tr(
                "Passez en ligne pour être à l'écoute et recevoir les demandes de course autour de vous.",
                "اتصل بالشبكة لتكون في وضع الاستماع وتستقبل طلبات المشاوير من حولك."
              )}
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
            {tr("Passer en ligne · GO", "الاتصال · GO")}
          </button>
        </div>
      </div>
    );
  }

  // Sous-page Inter-wilayas SUSPENDUE par l'équipe Coligo : on explique au
  // lieu de laisser un écran vide « qui ne marche plus ». Le serveur refuse
  // déjà tout (RPC + trigger) — ici c'est la pédagogie.
  if (interScope && iwFlag && iwFlag.status !== "active") {
    const msg =
      (isAr ? iwFlag.message_ar || iwFlag.message_fr : iwFlag.message_fr) ??
      tr(
        "L'équipe Coligo a suspendu temporairement les trajets inter-wilayas. Les courses en ville restent disponibles.",
        "علّق فريق كوليغو مؤقتًا المشاوير بين الولايات. مشاوير المدينة تبقى متاحة."
      );
    return (
      <div className="drive-jakarta drive-page pt-safe-lg pb-safe-nav min-h-screen bg-[var(--d-surface)] px-[18px]">
        <h1 className="drive-sora text-[20px] font-extrabold tracking-[-0.5px]">
          {tr("Trajets Inter-wilayas", "مشاوير بين الولايات")}
        </h1>
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <span
            className="grid size-16 place-items-center rounded-full"
            style={{ background: "rgba(108,43,217,.10)" }}
          >
            <Route className="size-8" style={{ color: VIOLET }} />
          </span>
          <div className="max-w-xs">
            <h2 className="drive-sora text-[18px] font-extrabold">
              {tr("Service suspendu", "الخدمة موقوفة مؤقتًا")}
            </h2>
            <p className="mt-1 text-[13px] text-[var(--d-muted)]">{msg}</p>
          </div>
          <Link
            href="/chauffeur/demandes"
            className="drive-sora flex h-[46px] w-full max-w-xs items-center justify-center gap-1.5 rounded-[14px] border-[1.5px] border-[var(--d-line)] text-[13.5px] font-bold"
          >
            <ChevronLeft className="size-4 rtl:rotate-180" />
            {tr("Retour aux demandes en ville", "العودة إلى طلبات المدينة")}
          </Link>
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
  // Filtre « je rentre chez moi » PARTAGÉ avec l'Accueil (compteur identique).
  const homeFilter = {
    on: homeDirOn,
    homeLat: homeDir.lat,
    homeLng: homeDir.lng,
    tolerance: homeDir.tolerance,
  };
  const dirActive = homeFilter.on && homeFilter.homeLat != null;
  // Lentille Ville / Inter-wilayas — MÊME détection locale que le badge des
  // cartes (lib/drive/interwilaya) : pur affichage, jamais tarifaire.
  const isInterRide = (q: NearbyRide) =>
    interWilayaInfo(
      q.pickup_lat != null && q.pickup_lng != null
        ? { lat: q.pickup_lat, lng: q.pickup_lng }
        : null,
      q.dest_lat != null && q.dest_lng != null
        ? { lat: q.dest_lat, lng: q.dest_lng }
        : null,
      q.distance_km
    ) != null;
  const demandes = reqs.filter(
    (q) =>
      !isProposed(q) &&
      passesHomeDir(q, homeFilter) &&
      (interScope ||
        tripFilter === "all" ||
        (tripFilter === "inter") === isInterRide(q))
  );
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
            ? tr(
                "Demande réservée aux conductrices.",
                "طلب مخصّص للسائقات فقط."
              )
            : res.error === "gamme_mismatch"
              ? tr(
                  "Cette demande ne correspond pas à votre gamme.",
                  "هذا الطلب لا يطابق فئة مركبتك."
                )
              : res.error === "below_floor"
                ? tr(
                    "Prix trop bas pour ce trajet — remontez votre offre.",
                    "السعر منخفض جدًا لهذا المسار — ارفع عرضك."
                  )
                : (res.error ??
                  tr("Proposition impossible", "تعذّر إرسال العرض")),
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
              ? [
                  {
                    id: "cli",
                    pos: pickup,
                    kind: "me" as const,
                    label: "A" as const,
                  },
                ]
              : []),
            ...(dest
              ? [
                  {
                    id: "dest",
                    pos: dest,
                    kind: "pin" as const,
                    label: "B" as const,
                  },
                ]
              : []),
          ]}
          approach={me && pickup ? (mapApproachPath ?? [me, pickup]) : null}
          route={pickup && dest ? (mapRoutePath ?? [pickup, dest]) : null}
          padding={{ top: 100, bottom: 280, left: 50, right: 50 }}
        />
        <div className="pointer-events-none absolute top-[calc(88px+env(safe-area-inset-top))] left-1/2 z-10 flex -translate-x-1/2 gap-2">
          <span className="rounded-full border-[1.5px] border-[var(--d-line)] bg-[var(--d-surface)] px-3 py-1.5 text-[11px] font-extrabold text-[var(--d-muted)] shadow">
            {fmtkm(mapReq.pickup_dist_km)} · {tr("approche", "الاقتراب")}
          </span>
          <span
            className="rounded-full border-[1.5px] bg-[var(--d-surface)] px-3 py-1.5 text-[11px] font-extrabold shadow"
            style={{ borderColor: VIOLET, color: VIOLET }}
          >
            {fmtkm(mapReq.distance_km)} · {tr("course", "المشوار")}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMapReq(null)}
          className="absolute top-[calc(0.75rem+env(safe-area-inset-top))] left-4 z-10 grid size-[42px] place-items-center rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow-lg"
        >
          <ChevronLeft className="size-5 rtl:rotate-180" />
        </button>
        <div className="absolute inset-x-0 bottom-0 z-10 rounded-t-[26px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-4 pb-[calc(24px+env(safe-area-inset-bottom))]">
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
                {mapReq.gamme === "confort"
                  ? ` · ${tr("Confort", "كونفور")}`
                  : ""}
              </b>
              <span className="block text-[12px] text-[var(--d-muted)]">
                {mapReq.pickup_text ?? "—"} → {mapReq.dest_text ?? "—"}
              </span>
            </span>
          </div>
          <div className="mb-3 flex flex-col gap-1.5 rounded-[12px] bg-[var(--d-soft)] px-3 py-2.5 text-[12.5px] font-semibold text-[var(--d-muted)]">
            <span className="flex items-center gap-2">
              <i className="size-[9px] rounded-full bg-[#B7BBC8]" />
              {tr("Vous → client", "أنت ← الزبون")}
              <b className="drive-sora ms-auto text-[var(--d-ink)]">
                {fmtkm(mapReq.pickup_dist_km)}
              </b>
            </span>
            <span className="flex items-center gap-2">
              <i className="size-[9px] rounded-[2px] bg-[var(--d-ink)]" />
              {tr("Client → destination", "الزبون ← الوجهة")}
              <b className="drive-sora ms-auto text-[var(--d-ink)]">
                {fmtkm(mapReq.distance_km)}
              </b>
            </span>
          </div>
          <PrimaryBtn onClick={() => setMapReq(null)} className="!mt-0">
            {tr("Retour aux demandes", "العودة إلى الطلبات")}
          </PrimaryBtn>
        </div>
      </div>
    );
  }

  const list = tab === "demandes" ? demandes : proposed;

  /* ── Liste des demandes / propositions ── */
  return (
    <div className="drive-jakarta drive-page pb-safe-nav flex min-h-screen flex-col bg-[var(--d-surface)]">
      {/* En-tête (remonté pour gagner de la place en bas) */}
      <div className="px-[18px] pt-[28px]">
        {interScope ? (
          <div className="flex items-center gap-2">
            <Link
              href="/chauffeur/demandes"
              aria-label={tr("Retour aux demandes", "العودة إلى الطلبات")}
              className="grid size-9 shrink-0 place-items-center rounded-[12px] border border-[var(--d-line)] bg-[var(--d-surface)]"
            >
              <ChevronLeft className="size-5 rtl:rotate-180" />
            </Link>
            <h1 className="drive-sora text-[20px] font-extrabold tracking-[-0.5px]">
              {tr("Trajets Inter-wilayas", "مشاوير بين الولايات")}
            </h1>
          </div>
        ) : (
          <h1 className="drive-sora text-[20px] font-extrabold tracking-[-0.5px]">
            {tr("Demandes de courses", "طلبات المشاوير")}
          </h1>
        )}
        <p className="mt-0.5 text-[11.5px] font-medium text-[var(--d-muted)]">
          <b style={{ color: GO }}>{demandes.length}</b>{" "}
          {interScope
            ? isAr
              ? "مشوار طويل متاح · نطاق موسّع"
              : `long${demandes.length > 1 ? "s" : ""} trajet${demandes.length > 1 ? "s" : ""} · rayon élargi`
            : isAr
              ? "مشوار متاح"
              : `course${demandes.length > 1 ? "s" : ""} disponible${demandes.length > 1 ? "s" : ""}`}
        </p>

        {/* Filtres — compacts, sur une seule ligne (défilable si étroite) */}
        <div className="mt-2 flex items-center gap-1.5 overflow-x-auto">
          {(
            [
              ["near", tr("Plus proches", "الأقرب")],
              ["pay", tr("Mieux payées", "الأفضل أجرًا")],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSort(k)}
              className="drive-sora flex h-7 shrink-0 items-center rounded-[14px] border px-3 text-[10px] font-bold whitespace-nowrap transition-colors"
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
          {/* Lentille Ville / Inter-wilayas (page Demandes seulement — la
              sous-page EST déjà la lentille inter). Re-tap = retour à Tous. */}
          {!interScope &&
            (
              [
                ["ville", tr("Ville", "المدينة")],
                ["inter", tr("Inter-wilayas", "بين الولايات")],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTripFilter((f) => (f === k ? "all" : k))}
                className="drive-sora flex h-7 shrink-0 items-center gap-1 rounded-[14px] border px-3 text-[10px] font-bold whitespace-nowrap transition-colors"
                style={
                  tripFilter === k
                    ? {
                        background: "#F1E9FC",
                        color: VIOLET,
                        borderColor: "#F1E9FC",
                      }
                    : { borderColor: "var(--d-line)", color: "var(--d-muted)" }
                }
              >
                {k === "inter" && <Route className="size-3" />}
                {label}
              </button>
            ))}
          <button
            type="button"
            onClick={() => setCompact((c) => !c)}
            className="drive-sora flex h-7 shrink-0 items-center gap-1 rounded-[14px] border px-3 text-[10px] font-bold whitespace-nowrap"
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
            <Rows3 className="size-3" /> {tr("Compact", "مضغوط")}
          </button>
        </div>
      </div>

      {/* Onglets Demandes / Propositions */}
      <div className="mt-2.5 flex border-b border-[var(--d-line)]">
        {(
          [
            ["demandes", tr("Demandes", "الطلبات"), demandes.length],
            ["proposed", tr("Propositions", "عروضي"), proposed.length],
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
              className="ms-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] px-1.5 text-[9px] font-extrabold"
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

      {/* DÉSENCOMBRÉ : plus de grosses bannières — le covoiturage vit dans la
          nav du bas, et la sous-page Inter-wilayas (rayon élargi) s'ouvre par
          un lien slim UNIQUEMENT quand la lentille Inter est active. */}
      {!interScope && tab === "demandes" && tripFilter === "inter" && (
        <Link
          href="/chauffeur/interwilayas"
          className="mx-[18px] mt-2 flex h-9 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--d-line)] text-[11.5px] font-bold"
          style={{ color: VIOLET }}
        >
          <Route className="size-3.5" />
          {tr("Voir plus loin — rayon élargi", "عرض أبعد — نطاق موسّع")}
          <ChevronRight className="size-3.5 rtl:rotate-180" />
        </Link>
      )}

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
              {tr("Filtre actif · vers", "فلتر نشط · نحو")}{" "}
              {homeDir.addr ?? tr("votre domicile", "منزلك")}
            </b>
            <span className="text-[10px] text-[var(--d-muted)]">
              {demandes.length}{" "}
              {isAr
                ? "مشوار في اتجاهك"
                : `course${demandes.length > 1 ? "s" : ""} dans votre direction`}
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
              {tr(
                "Recherche des demandes autour de vous…",
                "جارٍ البحث عن الطلبات من حولك…"
              )}
            </p>
          </div>
        )}

        {!loading && list.length === 0 && (
          <p className="py-12 text-center text-sm text-[var(--d-muted)]">
            {tab === "proposed"
              ? tr("Aucune proposition en attente.", "لا عروض في الانتظار.")
              : interScope
                ? tr(
                    "Aucun trajet inter-wilayas pour le moment. Les demandes longue distance autour de vous apparaîtront ici.",
                    "لا مشاوير بين الولايات حاليًا. الطلبات الطويلة من حولك ستظهر هنا."
                  )
                : tripFilter === "inter"
                  ? tr(
                      "Aucune demande inter-wilayas dans votre zone. Consultez la sous-page Inter-wilayas (rayon élargi).",
                      "لا طلبات بين الولايات في منطقتك. راجع صفحة بين الولايات (نطاق موسّع)."
                    )
                  : dirActive
                    ? tr(
                        "Aucune course vers votre domicile pour le moment.",
                        "لا مشاوير نحو منزلك حاليًا."
                      )
                    : tr(
                        "Aucune demande autour de vous pour le moment.",
                        "لا طلبات من حولك حاليًا."
                      )}
          </p>
        )}

        {list.map((q) => {
          const client = total(q);
          const propPrice =
            tab === "proposed" ? (q.my_offer_da ?? sent[q.id] ?? client) : null;
          const myPrice = myPrices[q.id] ?? client;
          const max = maxPrice(q);
          const totalDist = q.pickup_dist_km + q.distance_km;
          // Longue distance entre wilayas → badge « Inter-wilayas » : le
          // chauffeur voit AVANT d'accepter que c'est un déplacement long.
          const iw = interWilayaInfo(
            q.pickup_lat != null && q.pickup_lng != null
              ? { lat: q.pickup_lat, lng: q.pickup_lng }
              : null,
            q.dest_lat != null && q.dest_lng != null
              ? { lat: q.dest_lat, lng: q.dest_lng }
              : null,
            q.distance_km
          );
          const priceColor =
            myPrice >= max
              ? RED
              : myPrice > advised(q)
                ? AMBER
                : "var(--d-ink)";

          const highlighted = q.id === highlightId;

          return (
            <div
              key={q.id}
              ref={(el) => {
                cardRefs.current[q.id] = el;
              }}
              className={`drive-rise mb-2.5 overflow-hidden rounded-[16px] border bg-[var(--d-surface)] ${highlighted ? "drive-attn" : ""}`}
              style={{
                borderColor: highlighted
                  ? VIOLET
                  : q.boost_amount_da > 0
                    ? GO
                    : "var(--d-line)",
                ...(highlighted ? { boxShadow: `0 0 0 2px ${VIOLET}` } : null),
              }}
            >
              {/* Bandeau « course notifiée » : la demande ciblée par la push. */}
              {highlighted && (
                <div
                  className="drive-sora flex items-center justify-center gap-1 py-1 text-[10px] font-extrabold text-white"
                  style={{ background: VIOLET }}
                >
                  <Zap className="size-3" />{" "}
                  {tr(
                    "Course de votre notification",
                    "مشوار الإشعار الذي وصلك"
                  )}
                </div>
              )}
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
                      · {ago(q.created_at, isAr)}
                    </span>
                    {q.boost_amount_da > 0 && (
                      <span
                        className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold"
                        style={{
                          background: "rgba(22,179,100,.12)",
                          color: GO,
                        }}
                      >
                        <Zap className="size-2.5" /> {tr("Boostée", "معزَّزة")}
                      </span>
                    )}
                    {q.gamme === "confort" && (
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold"
                        style={{ background: "#F1E9FC", color: VIOLET }}
                      >
                        {tr("Confort", "كونفور")}
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
                        {tr("Femme au volant", "امرأة خلف المقود")}
                      </span>
                    )}
                    {iw && (
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold"
                        style={{
                          background: "rgba(108,43,217,.12)",
                          color: VIOLET,
                        }}
                      >
                        {tr("Inter-wilayas", "بين الولايات")} ·{" "}
                        {isAr ? iw.labelAr : iw.label}
                      </span>
                    )}
                  </div>
                </div>
                <span className="drive-sora shrink-0 text-[11px] font-bold whitespace-nowrap text-[var(--d-muted)]">
                  {fmtkm(totalDist)}
                </span>
                <div className="shrink-0 text-end">
                  <div className="drive-sora text-[22px] leading-none font-extrabold">
                    {propPrice ?? client}
                  </div>
                  <div className="text-[9.5px] font-semibold text-[var(--d-muted)]">
                    {tab === "proposed"
                      ? tr("DA proposé", "دج معروض")
                      : tr("DA", "دج")}
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
                      {tr("Départ", "الانطلاق")}
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
                      {tr("Arrivée", "الوصول")}
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
                    {tr("En attente du client…", "في انتظار الزبون…")}
                  </div>
                  <div className="flex flex-col gap-1.5 px-3.5 pt-2.5 pb-3">
                    <div
                      className="flex h-10 items-center justify-center gap-1.5 rounded-[10px] text-[12px] font-bold"
                      style={{
                        background: "var(--d-soft)",
                        color: "var(--d-muted)",
                      }}
                    >
                      <Loader2 className="size-3.5 animate-spin" />{" "}
                      {tr("En attente…", "في الانتظار…")}
                    </div>
                    <button
                      type="button"
                      onClick={() => void decline(q)}
                      className="flex h-[34px] w-full items-center justify-center gap-1.5 rounded-[10px] border border-[var(--d-line)] text-[11.5px] font-semibold text-[var(--d-muted)]"
                    >
                      <X className="size-3.5" /> {tr("Annuler", "إلغاء")}
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
                        {tr("Client", "الزبون")}{" "}
                        <b className="text-[var(--d-ink)]">
                          {client} {tr("DA", "دج")}
                        </b>
                        <span className="text-[var(--d-line)]">·</span>
                        {tr("Conseillé", "المقترح")}{" "}
                        <b className="text-[var(--d-ink)]">
                          {advised(q)} {tr("DA", "دج")}
                        </b>
                        <span className="text-[var(--d-line)]">·</span>
                        {tr("net ≈", "الصافي ≈")}{" "}
                        <b style={{ color: GO }}>
                          {Math.round(myPrice * (1 - planRate))}{" "}
                          {tr("DA", "دج")}
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
                        {tr("DA", "دج")}
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
                        <Send className="size-3.5 rtl:-scale-x-100" />{" "}
                        {tr("Proposer", "اقترح")} {myPrice}
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
                        <Check className="size-4" /> {tr("Accepter", "قبول")}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => void decline(q)}
                      className="flex h-[34px] w-full items-center justify-center gap-1.5 rounded-[10px] border border-[var(--d-line)] text-[11.5px] font-semibold text-[var(--d-muted)]"
                    >
                      <X className="size-3.5" />{" "}
                      {tr("Refuser cette course", "رفض هذا المشوار")}
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
