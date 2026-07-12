"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  Loader2,
  MessageCircle,
  MessageSquare,
  Navigation,
  Phone,
  PhoneCall,
  Share2,
  Smartphone,
  X,
  Zap,
} from "lucide-react";
import { formatDA } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useDriverPosition } from "@/lib/native/use-driver-position";
import { haversineKm } from "@/lib/delivery/distance";
import { reverseGeocode } from "@/app/(customer)/actions";
import { tryOpenNav } from "@/lib/drive/nav";
import { useUnreadRideMessages } from "@/lib/drive/use-unread-messages";
import { useRideCall } from "@/lib/call/use-ride-call";
import { useRoadPath } from "@/lib/drive/use-road-path";
import { DriveMap, type LatLng } from "@/components/customer/drive/drive-map";
import {
  CancelModal,
  copyText,
  GhostBtn,
  PrimaryBtn,
  Sheet,
  SheetTitle,
  SosContactsSheet,
  SOSModal,
  GO,
  RED,
  ROSE,
  VIOLET,
  type SosContact,
} from "@/components/customer/drive/drive-modals";
import { NavAppSheet, DoneScreen } from "./d-course-panels";
import { RideChatSheet } from "@/components/drive/ride-chat-sheet";
import {
  cancelRideAction,
  chauffeurHeartbeat,
  getChauffeurSosContacts,
  setChauffeurSosContacts,
  completeRideAction,
  getB2BNext,
  getChauffeurActiveRide,
  getChauffeurLastDone,
  getChauffeurRideMessages,
  markChauffeurMessagesRead,
  sendChauffeurRideMessage,
  offerRide,
  setRideStatus,
  type B2BNext,
  type ChauffeurActiveRide,
} from "@/app/(chauffeur)/actions";

const fmtkm = (v: number) =>
  `${(Math.round(v * 10) / 10).toString().replace(".", ",")} km`;

/**
 * Course côté chauffeur (maquette s-dmatch → s-dpickup → s-dride → s-ddone) :
 * attribution, prise en charge (« je suis arrivé », règle 5 min client
 * absent), course (SOS, back-to-back 12 s, file de 1), fin (gain net,
 * upsell Premium, « Enchaîner », note client, signalement).
 */
export function DCourse() {
  const router = useRouter();
  const coords = useDriverPosition();
  const [ride, setRide] = useState<ChauffeurActiveRide | null>(null);
  const [booted, setBooted] = useState(false);
  const [matchSeen, setMatchSeen] = useState(false);
  const [done, setDone] =
    useState<Awaited<ReturnType<typeof getChauffeurLastDone>>>(null);
  const [cancelCtx, setCancelCtx] = useState<
    "driver_match" | "driver_pickup" | null
  >(null);
  const [sosOpen, setSosOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // Sélecteur d'appel : ouvert seulement si le client a AUSSI partagé son numéro
  // direct → on regroupe « Coligo Call » et « Appeler le numéro » derrière une
  // seule action (sinon, Coligo Call est lancé directement).
  const [callMenu, setCallMenu] = useState(false);
  // Feuille « Partager le suivi » (carte A → B + partage), façon client.
  const [shareOpen, setShareOpen] = useState(false);
  const [sosContacts, setSosContacts] = useState<SosContact[]>([]);
  const [contactsOpen, setContactsOpen] = useState(false);
  // Appel in-app (audio + cam optionnelle) avec le client — numéro masqué.
  const call = useRideCall({
    rideId: ride?.id ?? "",
    role: "chauffeur",
    peerName: ride?.customer_name ?? "Client",
  });
  useEffect(() => {
    void getChauffeurSosContacts().then(setSosContacts);
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [endCode, setEndCode] = useState("");
  const [askCode, setAskCode] = useState(false);
  // Lien public de suivi t/{token} — copiable pour le partager librement.
  const [linkCopied, setLinkCopied] = useState(false);

  // Navigation GPS : sélecteur d'app (si aucune préférée mémorisée).
  const [navSheet, setNavSheet] = useState<{
    lat: number;
    lng: number;
    label: string;
  } | null>(null);
  // Lance la navigation vers (lat,lng) — app préférée directe, sinon sélecteur.
  const goNav = (lat: number, lng: number, label: string) => {
    if (!tryOpenNav(lat, lng)) setNavSheet({ lat, lng, label });
  };

  // Adresse lisible du point de départ client (le client envoie parfois
  // « Ma position actuelle » : on résout les coordonnées en vraie adresse).
  const [pickupAddr, setPickupAddr] = useState<string | null>(null);
  const pickupLat = ride?.pickup_lat ?? null;
  const pickupLng = ride?.pickup_lng ?? null;
  const pickupText = ride?.pickup_text ?? null;
  useEffect(() => {
    const vague =
      !pickupText ||
      /^(ma position|my position|position gps|point gps|موقعي|موقع gps)/i.test(
        pickupText.trim()
      ) ||
      /-?\d{1,3}[.,]\d{3,}\s*[,;]\s*-?\d{1,3}[.,]\d{3,}/.test(pickupText);
    if (!vague) {
      setPickupAddr(pickupText);
      return;
    }
    if (pickupLat == null || pickupLng == null) {
      setPickupAddr(null);
      return;
    }
    let alive = true;
    void reverseGeocode({
      latitude: pickupLat,
      longitude: pickupLng,
      precise: true,
    }).then((r) => {
      if (alive) setPickupAddr(r.ok ? (r.display ?? null) : null);
    });
    return () => {
      alive = false;
    };
  }, [pickupText, pickupLat, pickupLng]);

  // Messages non lus du client (compteur + bandeau in-app + accusé « reçu »).
  const { unread, lastIncoming, markSeen } = useUnreadRideMessages(
    ride?.id ?? null,
    "customer",
    getChauffeurRideMessages,
    !!ride && !done,
    markChauffeurMessagesRead
  );
  const [msgBanner, setMsgBanner] = useState<string | null>(null);
  const lastMsgId = lastIncoming?.id ?? null;
  const lastMsgBody = lastIncoming?.body ?? null;
  const notifiedRef = useRef<string | null>(null);
  const seededRef = useRef(false);
  useEffect(() => {
    // 1re salve chargée : mémoriser sans notifier les messages déjà présents.
    if (!seededRef.current && lastMsgId !== null) {
      seededRef.current = true;
      notifiedRef.current = lastMsgId;
      return;
    }
    if (chatOpen) return;
    if (lastMsgId && lastMsgId !== notifiedRef.current) {
      notifiedRef.current = lastMsgId;
      setMsgBanner(lastMsgBody);
      const t = setTimeout(() => setMsgBanner(null), 6000);
      return () => clearTimeout(t);
    }
  }, [lastMsgId, lastMsgBody, chatOpen]);
  // Ouverture du chat = tout est lu (local + serveur → le client voit « Lu »).
  useEffect(() => {
    if (chatOpen) {
      markSeen();
      setMsgBanner(null);
      if (ride?.id) void markChauffeurMessagesRead(ride.id, true);
    }
  }, [chatOpen, markSeen, ride?.id]);

  // Back-to-back
  const [nextOff, setNextOff] = useState<B2BNext | null>(null);
  const [nextCd, setNextCd] = useState(12);
  const [queued, setQueued] = useState<B2BNext | null>(null);
  const declined = useRef<Set<string>>(new Set());
  const coordsRef = useRef(coords);
  coordsRef.current = coords;

  // Tracé ROUTIER réel (OSRM) du trajet — calculé en haut (hooks inconditionnels)
  // pour dessiner A (départ client) → B (destination) sur la carte, comme côté
  // client. Avant la prise en charge : approche véhicule → A en pointillé.
  const meLL: LatLng | null = coords
    ? { lat: coords.latitude, lng: coords.longitude }
    : null;
  const pickupLL: LatLng | null =
    ride?.pickup_lat != null && ride?.pickup_lng != null
      ? { lat: ride.pickup_lat, lng: ride.pickup_lng }
      : null;
  const destLL: LatLng | null =
    ride?.dest_lat != null && ride?.dest_lng != null
      ? { lat: ride.dest_lat, lng: ride.dest_lng }
      : null;
  const inProgressTop = ride?.status === "in_progress";
  const approachPath = useRoadPath(
    !inProgressTop ? meLL : null,
    !inProgressTop ? pickupLL : null
  );
  const ridePath = useRoadPath(pickupLL, destLL);

  const refresh = useCallback(async () => {
    const c = coordsRef.current;
    if (c) void chauffeurHeartbeat(c.latitude, c.longitude, true);
    const r = await getChauffeurActiveRide();
    setRide(r);
    setBooted(true);
    return r;
  }, []);
  useEffect(() => {
    void refresh();
    // Poll = FILET LENT seulement (le Realtime ci-dessous fait l'instantané).
    // Avant : 6 s. La sync ne doit PAS marteler le serveur — façon Uber, on
    // s'appuie sur le push DB temps réel et le poll ne sert qu'au rattrapage.
    const id = setInterval(refresh, 20000);
    return () => clearInterval(id);
  }, [refresh]);

  // TEMPS RÉEL (façon Uber) : tout changement de SA course (annulation client,
  // statut, prix convenu) rafraîchit INSTANTANÉMENT — plus besoin de poller vite.
  // La table `rides` est dans la publication Realtime ; RLS = le chauffeur ne
  // voit que sa course attribuée.
  const rideId = ride?.id ?? null;
  useEffect(() => {
    if (!rideId) return;
    const supabase = createClient();
    const ch = supabase
      .channel(`ch-ride-${rideId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rides",
          filter: `id=eq.${rideId}`,
        },
        () => void refresh()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [rideId, refresh]);

  // Back-to-back : proposition de course proche du POINT DE DÉPOSE (12 s).
  useEffect(() => {
    if (ride?.status !== "in_progress" || queued || nextOff) return;
    let stop = false;
    const find = async () => {
      const n = await getB2BNext(ride.id);
      if (stop || !n || declined.current.has(n.id)) return;
      setNextOff(n);
      setNextCd(12);
    };
    const id = setInterval(find, 15_000);
    const t = setTimeout(find, 2500);
    return () => {
      stop = true;
      clearInterval(id);
      clearTimeout(t);
    };
  }, [ride?.status, ride?.id, queued, nextOff]);
  useEffect(() => {
    if (!nextOff) return;
    if (nextCd <= 0) {
      declined.current.add(nextOff.id);
      setNextOff(null);
      return;
    }
    const t = setTimeout(() => setNextCd((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [nextOff, nextCd]);

  // Mig 0145 : le CODE PIN du client valide le DÉMARRAGE (courses en ligne,
  // séquestre) ; la complétion libère le séquestre sans code.
  const transition = async (
    status: "arriving" | "arrived" | "in_progress",
    pin?: string
  ) => {
    if (!ride || busy) return;
    if (status === "in_progress" && ride.prepaid && !pin) {
      setAskCode(true);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await setRideStatus(ride.id, status, pin ?? null);
    if (!res.ok) {
      setError(
        res.error === "bad_pin"
          ? "Code PIN incorrect — demandez les 4 chiffres au client."
          : (res.error ?? "Action impossible")
      );
      setBusy(false);
      return;
    }
    if (status === "in_progress") setAskCode(false);
    await refresh();
    setBusy(false);
  };

  const complete = async () => {
    if (!ride || busy) return;
    setBusy(true);
    setError(null);
    const res = await completeRideAction(ride.id);
    if (!res.ok) {
      setError(res.error ?? "Impossible de terminer");
      setBusy(false);
      return;
    }
    const d = await getChauffeurLastDone();
    setDone(d);
    setRide(null);
    setBusy(false);
  };

  if (!booted) {
    return (
      <div className="grid min-h-screen place-items-center bg-[var(--d-page)]">
        <Loader2 className="size-6 animate-spin" style={{ color: VIOLET }} />
      </div>
    );
  }

  /* ════════ FIN DE COURSE (s-ddone) ════════ */
  if (done) {
    return (
      <DoneScreen
        done={done}
        queued={queued}
        onChainQueued={async () => {
          if (!queued) return;
          await offerRide(
            queued.id,
            queued.proposed_price_da + queued.boost_amount_da
          );
          setQueued(null);
          setDone(null);
          router.replace("/chauffeur/demandes");
        }}
        onRequests={() => router.replace("/chauffeur/demandes")}
        onHome={() => router.replace("/chauffeur")}
      />
    );
  }

  if (!ride) {
    // Course annulée par le client pendant le flux → retour aux demandes.
    return (
      <div className="drive-jakarta drive-screen bg-[var(--d-surface)] px-5 pt-12">
        <div className="flex flex-col items-center text-center">
          <span
            className="mb-3 grid size-16 place-items-center rounded-full"
            style={{ background: "rgba(229,72,77,.1)" }}
          >
            <X className="size-7" style={{ color: RED }} />
          </span>
          <h1 className="drive-sora text-[21px] font-extrabold">
            Course annulée
          </h1>
          <p className="mt-1 max-w-[280px] text-[13px] text-[var(--d-muted)]">
            La course a été remise dans la liste des demandes. Aucun frais.
          </p>
        </div>
        <PrimaryBtn
          onClick={() => router.replace("/chauffeur/demandes")}
          className="mt-5"
        >
          Voir les autres demandes
        </PrimaryBtn>
      </div>
    );
  }

  const me = coords ? { lat: coords.latitude, lng: coords.longitude } : null;
  const shareUrl = ride.share_token
    ? `${typeof window !== "undefined" ? window.location.origin : "https://coligo.app"}/t/${ride.share_token}`
    : null;
  const pickup =
    ride.pickup_lat != null
      ? { lat: ride.pickup_lat, lng: ride.pickup_lng! }
      : null;
  const dest =
    ride.dest_lat != null ? { lat: ride.dest_lat, lng: ride.dest_lng! } : null;
  const pkKm = me && pickup ? haversineKm(me, pickup) : null;
  const pkMin = pkKm != null ? Math.max(2, Math.round(pkKm * 3)) : null;
  const rideMin =
    me && dest ? Math.max(1, Math.round(haversineKm(me, dest) * 2.2)) : null;

  /* ════════ ATTRIBUTION (s-dmatch) ════════ */
  if (ride.status === "accepted" && !matchSeen) {
    return (
      <div className="drive-jakarta drive-screen overflow-y-auto bg-[var(--d-surface)] px-5 pt-10 pb-8">
        <div className="text-center">
          <span
            className="mx-auto mb-3 grid size-16 place-items-center rounded-full"
            style={{ background: "rgba(22,179,100,.12)" }}
          >
            <Check className="size-7" style={{ color: GO }} />
          </span>
          <h1 className="drive-sora text-[21px] font-extrabold">
            {ride.customer_name} a accepté !
          </h1>
          <p className="text-[13px] text-[var(--d-muted)]">
            Course confirmée à <b>{formatDA(ride.agreed_price_da)}</b>
          </p>
        </div>
        <div className="mt-4 mb-2.5 flex flex-col gap-1.5 rounded-[12px] bg-[var(--d-soft)] px-3 py-2.5 text-[12.5px] font-semibold text-[var(--d-muted)]">
          <span className="flex items-center gap-2">
            <i
              className="size-[9px] shrink-0 rounded-full"
              style={{ background: VIOLET }}
            />
            Vous → client
            <b className="drive-sora ml-auto text-[var(--d-ink)]">
              {pkKm != null ? `${fmtkm(pkKm)} · ~${pkMin} min` : "…"}
            </b>
          </span>
          <span className="flex items-center gap-2">
            <i className="size-[9px] shrink-0 rounded-[2px] bg-[var(--d-ink)]" />
            Course
            <b className="drive-sora ml-auto text-[var(--d-ink)]">
              {fmtkm(ride.distance_km)} · ~
              {Math.max(4, Math.round(ride.distance_km * 2.2))} min
            </b>
          </span>
        </div>
        <p className="mb-4 text-xs font-semibold">
          {pickupAddr ?? "Point de départ du client"} → {ride.dest_text ?? "—"}
        </p>
        <PrimaryBtn
          onClick={async () => {
            setMatchSeen(true);
            await transition("arriving");
          }}
        >
          Démarrer · aller au client
        </PrimaryBtn>
        {/* Ouvre directement l'itinéraire vers le client dans l'app GPS. */}
        {pickup && (
          <button
            type="button"
            onClick={() => goNav(pickup.lat, pickup.lng, "le client")}
            className="drive-sora mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-[15px] border-[1.5px] text-[14px] font-bold"
            style={{ borderColor: GO, color: GO }}
          >
            <Navigation className="size-4" /> Aller au point de départ · GPS
          </button>
        )}
        <GhostBtn onClick={() => setCancelCtx("driver_match")}>
          Annuler la course
        </GhostBtn>
        <CancelModal
          open={cancelCtx === "driver_match"}
          ctx="driver_match"
          onClose={() => setCancelCtx(null)}
          onConfirm={async (reason) => {
            setCancelCtx(null);
            await cancelRideAction(ride.id, reason);
            router.replace("/chauffeur/demandes");
          }}
        />
        <NavAppSheet target={navSheet} onClose={() => setNavSheet(null)} />
      </div>
    );
  }

  const inProgress = ride.status === "in_progress";

  // Appel : Coligo Call par défaut ; si le client a partagé son numéro direct,
  // on ouvre un mini-sélecteur (Coligo Call / numéro) — une SEULE action visible.
  const onCall = () => {
    if (ride.customer_phone) setCallMenu(true);
    else call.start(false);
  };
  // Itinéraire : vers la destination en course, vers le client avant.
  const onItinerary = () => {
    if (inProgress) {
      if (dest) goNav(dest.lat, dest.lng, "la destination");
    } else if (pickup) {
      goNav(pickup.lat, pickup.lng, "le client");
    }
  };
  const copyShare = async () => {
    if (!shareUrl) return;
    if (await copyText(shareUrl)) {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    }
  };

  /* ════════ PRISE EN CHARGE / COURSE (s-dpickup / s-dride) ════════ */
  return (
    <div className="drive-jakarta drive-screen bg-[var(--d-page)]">
      <DriveMap
        markers={[
          // Véhicule (moi) + A (départ client) + B (destination) TOUJOURS
          // affichés → le trajet A → B se lit d'un coup d'œil, dans les deux
          // états (prise en charge et course en cours), comme côté client.
          ...(me ? [{ id: "car", pos: me, kind: "car" as const }] : []),
          ...(pickup
            ? [
                {
                  id: "cli",
                  pos: pickup,
                  kind: "pin" as const,
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
        // Avant la prise en charge : approche routière véhicule → A (pointillé).
        approach={
          !inProgress && me && pickup ? (approachPath ?? [me, pickup]) : null
        }
        // Trajet A → B (route réelle OSRM, repli ligne droite) en continu.
        route={pickup && dest ? (ridePath ?? [pickup, dest]) : null}
        padding={{ top: 90, bottom: 420, left: 60, right: 60 }}
      />
      <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[var(--d-surface)] px-4 py-2 text-[13.5px] font-bold whitespace-nowrap shadow-lg">
        <span
          className="size-2 animate-pulse rounded-full"
          style={{ background: inProgress ? GO : VIOLET }}
        />
        <span className="drive-sora">
          {inProgress
            ? `Course en cours${rideMin != null ? ` · ${rideMin} min restantes` : ""}`
            : `Prise en charge · ${ride.customer_name}${pkMin != null ? ` à ${pkMin} min` : ""}`}
        </span>
      </div>

      {/* Notification in-app : nouveau message du client (chat fermé). */}
      {msgBanner && (
        <button
          type="button"
          onClick={() => {
            setChatOpen(true);
            setMsgBanner(null);
          }}
          className="drive-up absolute top-16 right-2.5 left-2.5 z-40 flex items-center gap-2.5 rounded-[16px] border-2 bg-[var(--d-surface)] px-3.5 py-3 text-left shadow-xl"
          style={{ borderColor: VIOLET }}
        >
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full"
            style={{ background: "var(--d-accent)" }}
          >
            <MessageSquare className="size-4" style={{ color: VIOLET }} />
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[13px]">Nouveau message du client</b>
            <span className="block truncate text-[12px] text-[var(--d-muted)]">
              {msgBanner}
            </span>
          </span>
          <span
            className="shrink-0 text-[11px] font-extrabold"
            style={{ color: VIOLET }}
          >
            Voir
          </span>
        </button>
      )}

      {/* Back-to-back : course suivante près de la dépose (compteur 12 s) */}
      {inProgress && nextOff && (
        <div
          className="drive-up absolute top-16 right-2.5 left-2.5 z-30 overflow-hidden rounded-[20px] border-2 bg-[var(--d-surface)] shadow-xl"
          style={{ borderColor: VIOLET }}
        >
          <div
            className="drive-sora flex items-center gap-2 px-3.5 py-2 text-xs font-extrabold text-white"
            style={{ background: VIOLET }}
          >
            <Zap className="size-3.5" /> Course suivante près de votre dépose
            <span className="ml-auto">0:{String(nextCd).padStart(2, "0")}</span>
          </div>
          <div className="px-3.5 py-3">
            <div className="flex items-center gap-2.5">
              <span
                className="drive-sora grid size-[38px] shrink-0 place-items-center rounded-full font-extrabold text-white"
                style={{
                  background: `linear-gradient(135deg,#7B7BF0,${VIOLET})`,
                }}
              >
                {nextOff.customer_name[0]?.toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-[13.5px]">
                  {nextOff.customer_name}
                  {nextOff.customer_rating != null
                    ? ` · ★ ${String(nextOff.customer_rating).replace(".", ",")}`
                    : ""}
                </b>
                <span className="text-[11px] text-[var(--d-muted)]">
                  À {fmtkm(nextOff.pickup_dist_km)} de votre point de dépose ·
                  course {fmtkm(nextOff.distance_km)}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <b className="drive-sora block text-lg">
                  {nextOff.proposed_price_da + nextOff.boost_amount_da} DA
                </b>
                <span className="text-[10px] text-[var(--d-muted)]">
                  prix client
                </span>
              </span>
            </div>
            <p className="mt-1.5 text-[11px] text-[var(--d-muted)]">
              {nextOff.pickup_text ?? "—"} → {nextOff.dest_text ?? "—"}
            </p>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                className="drive-sora h-[42px] flex-1 rounded-[12px] text-[13px] font-bold text-white"
                style={{ background: VIOLET }}
                onClick={() => {
                  setQueued(nextOff);
                  setNextOff(null);
                }}
              >
                Enchaîner
              </button>
              <button
                type="button"
                className="drive-sora h-[42px] flex-1 rounded-[12px] bg-[var(--d-soft)] text-[13px] font-bold text-[var(--d-muted)]"
                onClick={() => {
                  declined.current.add(nextOff.id);
                  setNextOff(null);
                }}
              >
                Non merci
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 z-10 max-h-[60vh] overflow-y-auto rounded-t-[28px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-3.5 pb-[max(20px,env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-3.5 h-[5px] w-[42px] rounded-full bg-[var(--d-line)]" />

        {queued && (
          <div
            className="mb-2.5 flex items-center gap-2 rounded-[13px] px-3 py-2.5 text-[12.5px] font-bold"
            style={{ background: "var(--d-accent)", color: VIOLET }}
          >
            <Check className="size-4 shrink-0" />
            Course suivante : {queued.customer_name} ·{" "}
            {queued.proposed_price_da + queued.boost_amount_da} DA
            <button
              type="button"
              className="ml-auto text-[11px] font-semibold text-[var(--d-muted)]"
              onClick={() => setQueued(null)}
            >
              Retirer
            </button>
          </div>
        )}

        {/* Fiche client : identité + prix + adresse cliquable (→ itinéraire). */}
        <div className="mb-2.5 rounded-[22px] border border-[var(--d-line)] bg-[var(--d-surface)] p-4 shadow-[0_14px_34px_-12px_rgba(20,22,40,.26)]">
          <div className="flex items-center gap-3">
            <span
              className="drive-sora grid size-[52px] shrink-0 place-items-center rounded-full text-xl font-extrabold text-white"
              style={{
                background: `linear-gradient(135deg,#7B7BF0,${VIOLET})`,
              }}
            >
              {ride.customer_name[0]?.toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <b className="drive-sora block text-[17px] font-extrabold">
                {ride.customer_name}
              </b>
              <span className="mt-1 flex flex-wrap gap-1.5">
                {ride.customer_rating != null && (
                  <span className="rounded-full bg-[rgba(245,158,11,.16)] px-2.5 py-1 text-[11px] font-bold text-[#B45309]">
                    ★ {String(ride.customer_rating).replace(".", ",")}
                  </span>
                )}
                {ride.proxy_name && (
                  <span className="rounded-full bg-[var(--d-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--d-muted)]">
                    Pour un proche
                  </span>
                )}
              </span>
            </span>
            {/* Prix convenu (collé à l'identité — plus de bloc séparé). */}
            <span className="shrink-0 text-right">
              <span
                className="drive-sora block text-[18px] leading-none font-extrabold"
                style={{ color: VIOLET }}
              >
                {formatDA(ride.agreed_price_da)}
              </span>
              <span className="mt-1 block text-[10px] font-bold text-[var(--d-muted)]">
                {inProgress
                  ? ride.prepaid
                    ? ride.cash_due_da > 0
                      ? `Encaisser ${formatDA(ride.cash_due_da)}`
                      : "Prépayée"
                    : "À encaisser"
                  : "Prix convenu"}
              </span>
            </span>
          </div>
          {/* Adresse (réelle, jamais « Ma position ») — CLIQUABLE : ouvre
              l'itinéraire dans l'app GPS (plus de bouton « Itinéraire » séparé). */}
          <button
            type="button"
            onClick={onItinerary}
            className="mt-3 flex w-full items-center gap-2 rounded-[13px] bg-[var(--d-soft)] px-3 py-2.5 text-start text-[12.5px] font-bold"
          >
            <span
              className="grid size-6 shrink-0 place-items-center rounded-full"
              style={{
                background: inProgress
                  ? "rgba(108,43,217,.14)"
                  : "rgba(22,179,100,.16)",
              }}
            >
              <i
                className="size-[8px] rounded-full"
                style={{ background: inProgress ? VIOLET : GO }}
              />
            </span>
            <span className="min-w-0 flex-1 truncate text-[var(--d-ink)]">
              {inProgress
                ? (ride.dest_text ?? "Destination")
                : (pickupAddr ?? "Point de départ du client")}
            </span>
            <span
              className="flex shrink-0 items-center gap-0.5 text-[11px] font-extrabold"
              style={{ color: VIOLET }}
            >
              <Navigation className="size-3.5" /> Itinéraire
            </span>
          </button>
        </div>

        {/* ── Contacts : 2 actions principales claires (Appel · Message),
            plus de carrousel surchargé. ── */}
        <div className="mb-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onCall}
            className="drive-sora flex h-[50px] items-center justify-center gap-2 rounded-[15px] text-[14px] font-bold text-white"
            style={{ background: VIOLET }}
          >
            <PhoneCall className="size-[18px] shrink-0" /> Appel
          </button>
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="drive-sora relative flex h-[50px] items-center justify-center gap-2 rounded-[15px] bg-[var(--d-soft)] text-[14px] font-bold"
          >
            <MessageSquare className="size-[18px] shrink-0" /> Message
            {unread > 0 && (
              <span
                className="drive-badge absolute top-1.5 right-2 grid min-w-[20px] place-items-center rounded-full px-1.5 text-[11px] font-extrabold text-white"
                style={{ background: RED }}
              >
                {unread}
              </span>
            )}
          </button>
        </div>

        {/* ── Sécurité (secondaire) : partage du suivi · SOS (en course). ── */}
        {(shareUrl || inProgress) && (
          <div className="mb-2.5 flex gap-2">
            {shareUrl && (
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className="flex h-[40px] flex-1 items-center justify-center gap-1.5 rounded-[13px] border border-[var(--d-line)] text-[12.5px] font-bold text-[var(--d-muted)]"
              >
                <Share2 className="size-4" /> Partager le suivi
              </button>
            )}
            {inProgress && (
              <button
                type="button"
                onClick={() => setSosOpen(true)}
                className="flex h-[40px] w-[96px] shrink-0 items-center justify-center gap-1.5 rounded-[13px] border text-[12.5px] font-bold"
                style={{ borderColor: RED, color: RED }}
              >
                <AlertTriangle className="size-4" /> SOS
              </button>
            )}
          </div>
        )}

        {ride.prepaid && (
          <p
            className="mb-2.5 rounded-[13px] px-3 py-2.5 text-[12.5px] leading-relaxed font-bold"
            style={{ background: "rgba(22,179,100,.12)", color: GO }}
          >
            {inProgress ? (
              ride.cash_due_da > 0 ? (
                <>
                  🔒 Course Coligo Pay partielle —{" "}
                  {formatDA(ride.agreed_price_da - ride.cash_due_da)} en
                  séquestre (versés sur votre solde à la fin) ·{" "}
                  <b>encaissez {formatDA(ride.cash_due_da)} en espèces</b>{" "}
                  auprès du client à l&apos;arrivée.
                </>
              ) : (
                <>
                  🔒 Course prépayée — montant en séquestre, versé sur votre
                  solde à la fin de la course. Rien à encaisser.
                </>
              )
            ) : (
              <>
                🔒 Course prépayée — à votre arrivée, demandez le{" "}
                <b>code PIN (4 chiffres)</b> au client : sa saisie démarre la
                course.{" "}
                {ride.cash_due_da > 0 ? (
                  <>
                    Complément à encaisser en espèces :{" "}
                    <b>{formatDA(ride.cash_due_da)}</b>.
                  </>
                ) : (
                  <>Rien à encaisser.</>
                )}
              </>
            )}
          </p>
        )}

        {error && (
          <p
            className="mb-2 rounded-[12px] px-3 py-2 text-center text-xs font-bold"
            style={{ background: "rgba(229,72,77,.1)", color: RED }}
          >
            {error}
          </p>
        )}

        {/* ── Action principale (1 seul CTA dominant par étape) ── */}
        {inProgress ? (
          <PrimaryBtn onClick={() => void complete()} disabled={busy}>
            {busy ? <Loader2 className="size-5 animate-spin" /> : null}
            Terminer la course
          </PrimaryBtn>
        ) : ride.status !== "arrived" ? (
          <>
            <PrimaryBtn
              onClick={() => void transition("arrived")}
              disabled={busy}
            >
              Je suis arrivé · prévenir le client
            </PrimaryBtn>
            {/* Démarrage direct (si le client est déjà à bord) — action
                secondaire discrète, plus de gros boutons empilés. */}
            <button
              type="button"
              onClick={() => void transition("in_progress")}
              disabled={busy}
              className="drive-sora mt-2 flex h-[46px] w-full items-center justify-center gap-1.5 rounded-[15px] border-[1.5px] border-[var(--d-line)] text-[13.5px] font-bold disabled:opacity-50"
              style={{ color: VIOLET }}
            >
              Client déjà à bord · démarrer
              <ChevronRight className="size-4" />
            </button>
          </>
        ) : (
          <>
            <p
              className="mb-2 rounded-[12px] px-3 py-2 text-center text-xs font-bold"
              style={{ background: "rgba(22,179,100,.12)", color: GO }}
            >
              Le client est prévenu que vous êtes arrivé ✓
            </p>
            <PrimaryBtn
              onClick={() => void transition("in_progress")}
              disabled={busy}
            >
              Client à bord · démarrer la course
            </PrimaryBtn>
          </>
        )}

        {/* Annulation : repliée en lien discret (sauf en course). */}
        {!inProgress && (
          <GhostBtn danger onClick={() => setCancelCtx("driver_pickup")}>
            Annuler · client absent
          </GhostBtn>
        )}
      </div>

      {/* Saisie du CODE PIN du client — DÉMARRE la course prépayée (séquestre
          maintenu jusqu'à la fin, mig 0145). */}
      <Sheet open={askCode} onClose={() => setAskCode(false)}>
        <SheetTitle>Code PIN du client</SheetTitle>
        <p className="mb-3 text-[13px] text-[var(--d-muted)]">
          À votre arrivée, demandez au client son <b>code PIN (4 chiffres)</b>.
          Sa validation démarre la course — le montant reste bloqué en séquestre
          et vous sera versé à la fin de la course.
        </p>
        <input
          value={endCode}
          onChange={(e) =>
            setEndCode(e.target.value.replace(/\D/g, "").slice(0, 4))
          }
          inputMode="numeric"
          placeholder="• • • •"
          className="drive-sora mb-1 w-full rounded-[14px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3.5 py-3 text-center text-2xl font-extrabold tracking-[8px] outline-none"
        />
        {error && (
          <p className="text-center text-xs font-bold" style={{ color: RED }}>
            {error}
          </p>
        )}
        <PrimaryBtn
          disabled={endCode.length !== 4 || busy}
          onClick={() => void transition("in_progress", endCode)}
        >
          Valider le PIN · démarrer la course
        </PrimaryBtn>
        <GhostBtn onClick={() => setAskCode(false)}>Annuler</GhostBtn>
      </Sheet>

      <CancelModal
        open={cancelCtx === "driver_pickup"}
        ctx="driver_pickup"
        onClose={() => setCancelCtx(null)}
        onConfirm={async (reason) => {
          setCancelCtx(null);
          await cancelRideAction(ride.id, reason);
          router.replace("/chauffeur/demandes");
        }}
      />
      <SOSModal
        open={sosOpen}
        onClose={() => setSosOpen(false)}
        rideId={ride.id}
        side="driver"
        shareUrl={shareUrl}
        position={me}
        contacts={sosContacts}
        onManageContacts={() => {
          setSosOpen(false);
          setContactsOpen(true);
        }}
      />
      <SosContactsSheet
        open={contactsOpen}
        onClose={() => setContactsOpen(false)}
        contacts={sosContacts}
        onSave={async (next) => {
          const res = await setChauffeurSosContacts(next);
          if (res.ok) setSosContacts(next);
          return res;
        }}
      />
      {chatOpen && (
        <RideChatSheet
          rideId={ride.id}
          side="chauffeur"
          peerName={ride.customer_name}
          fetchMessages={getChauffeurRideMessages}
          sendMessage={sendChauffeurRideMessage}
          markRead={markChauffeurMessagesRead}
          onClose={() => {
            setChatOpen(false);
            markSeen();
          }}
        />
      )}
      <NavAppSheet target={navSheet} onClose={() => setNavSheet(null)} />

      {/* Sélecteur d'appel — n'apparaît que si le client a partagé son numéro
          direct (sinon « Appel » lance Coligo Call directement). Regroupe les
          deux méthodes derrière la seule action « Appel ». */}
      <Sheet open={callMenu} onClose={() => setCallMenu(false)}>
        <SheetTitle>Appeler {ride.customer_name}</SheetTitle>
        <p className="mb-3 text-[13px] text-[var(--d-muted)]">
          Coligo Call protège votre numéro et celui du client.
        </p>
        <button
          type="button"
          onClick={() => {
            setCallMenu(false);
            call.start(false);
          }}
          className="drive-sora mb-2 flex h-[54px] w-full items-center gap-3 rounded-[14px] px-4 text-[14px] font-bold text-white"
          style={{ background: VIOLET }}
        >
          <PhoneCall className="size-5" />
          <span className="flex-1 text-left">
            Coligo Call
            <span className="block text-[11px] font-semibold opacity-85">
              Numéro masqué · recommandé
            </span>
          </span>
          <ChevronRight className="size-4" />
        </button>
        {ride.customer_phone && (
          <a
            href={`tel:${ride.customer_phone}`}
            onClick={() => setCallMenu(false)}
            className="drive-sora mb-1 flex h-[54px] w-full items-center gap-3 rounded-[14px] border-[1.5px] border-[var(--d-line)] px-4 text-[14px] font-bold"
          >
            <Phone className="size-5" style={{ color: VIOLET }} />
            <span className="flex-1 text-left">
              Appeler le numéro direct
              <span className="block text-[11px] font-semibold text-[var(--d-muted)]">
                {ride.customer_phone}
              </span>
            </span>
            <ChevronRight className="size-4 text-[var(--d-muted)]" />
          </a>
        )}
        <GhostBtn onClick={() => setCallMenu(false)}>Annuler</GhostBtn>
      </Sheet>

      {/* Partage du suivi — popup AVEC CARTE A → B (façon client) : aperçu du
          trajet + envoi du lien public t/{token} (WhatsApp / SMS / copie). */}
      {shareUrl && (
        <Sheet open={shareOpen} onClose={() => setShareOpen(false)}>
          <SheetTitle>Partager le suivi</SheetTitle>
          <p className="mb-3 text-[13px] text-[var(--d-muted)]">
            Vos proches suivent la course en direct (position live), sans
            compte.
          </p>
          {/* Aperçu carte du trajet A → B */}
          <DriveMap
            className="relative h-[190px] w-full overflow-hidden rounded-[18px] border border-[var(--d-line)]"
            markers={[
              ...(pickup
                ? [
                    {
                      id: "a",
                      pos: pickup,
                      kind: "pin" as const,
                      label: "A" as const,
                    },
                  ]
                : []),
              ...(dest
                ? [
                    {
                      id: "b",
                      pos: dest,
                      kind: "pin" as const,
                      label: "B" as const,
                    },
                  ]
                : []),
            ]}
            route={pickup && dest ? (ridePath ?? [pickup, dest]) : null}
            padding={{ top: 44, bottom: 44, left: 44, right: 44 }}
          />
          {/* Rail A → B (adresses) */}
          <div className="my-3 flex gap-2.5 rounded-[14px] bg-[var(--d-soft)] px-3 py-2.5">
            <div className="flex w-3 shrink-0 flex-col items-center pt-1">
              <span
                className="size-1.5 rounded-full"
                style={{ background: VIOLET }}
              />
              <span className="my-0.5 w-[1.5px] flex-1 bg-[var(--d-line)]" />
              <span
                className="size-1.5 rounded-full"
                style={{ background: ROSE }}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2 text-[12px] font-semibold">
              <span className="truncate">
                {pickupAddr ?? "Point de départ du client"}
              </span>
              <span className="truncate">
                {ride.dest_text ?? "Destination"}
              </span>
            </div>
          </div>
          {/* Partage : WhatsApp · SMS · Copie */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                window.open(
                  `https://wa.me/?text=${encodeURIComponent(`Suivez ma course Coligo en direct : ${shareUrl}`)}`,
                  "_blank"
                )
              }
              className="drive-sora flex h-12 flex-1 items-center justify-center gap-2 rounded-[14px] text-[13.5px] font-bold text-white"
              style={{ background: GO }}
            >
              <MessageCircle className="size-4" /> WhatsApp
            </button>
            <button
              type="button"
              onClick={() =>
                window.open(
                  `sms:?body=${encodeURIComponent(`Suivez ma course Coligo en direct : ${shareUrl}`)}`,
                  "_self"
                )
              }
              className="drive-sora flex h-12 flex-1 items-center justify-center gap-2 rounded-[14px] bg-[var(--d-soft)] text-[13.5px] font-bold"
            >
              <Smartphone className="size-4" /> SMS
            </button>
          </div>
          <button
            type="button"
            onClick={() => void copyShare()}
            className="drive-sora mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] text-[13.5px] font-bold"
            style={
              linkCopied
                ? { borderColor: GO, color: GO }
                : { borderColor: "var(--d-line)" }
            }
          >
            {linkCopied ? (
              <Check className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
            {linkCopied ? "Lien copié ✓" : "Copier le lien de suivi"}
          </button>
          <GhostBtn onClick={() => setShareOpen(false)}>Fermer</GhostBtn>
        </Sheet>
      )}

      {/* Appel in-app (sonnerie entrante/sortante + fenêtre d'appel Agora). */}
      {call.ui}
    </div>
  );
}
