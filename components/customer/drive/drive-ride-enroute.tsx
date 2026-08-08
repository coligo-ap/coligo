"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ContactRound,
  BadgeCheck,
  Banknote,
  Crown,
  Lock,
  MessageSquare,
  Phone,
  Share2,
  Star,
} from "lucide-react";
import { formatDA } from "@/lib/utils";
import { haversineKm } from "@/lib/delivery/distance";
import { useRoadPath } from "@/lib/drive/use-road-path";
import { DriveMap } from "./drive-map";
import { ChAvatar } from "./ch-avatar";
import {
  CancelModal,
  GhostBtn,
  ReportModal,
  ShareModal,
  SosContactsSheet,
  SOSModal,
  GO,
  ROSE,
  RED,
  VIOLET,
  type SosContact,
} from "./drive-modals";
import { RideChatSheet } from "@/components/drive/ride-chat-sheet";
import {
  cancelDriveRide,
  getRideMessages,
  markRideMessagesRead,
  sendRideMessage,
  getSosContacts,
  reportDriveRide,
  setSosContacts as saveSosContacts,
  type DriveActiveRide,
  type DriveContext,
} from "@/app/(customer)/drive/actions";
import { useUnreadRideMessages } from "@/lib/drive/use-unread-messages";
import { useRideCall } from "@/lib/call/use-ride-call";
import { RidePhoneShareToggle } from "@/components/customer/drive/ride-phone-share-toggle";

export function EnrouteScreen({
  ctx,
  ride,
  onCancelled,
}: {
  ctx: DriveContext;
  ride: DriveActiveRide;
  onCancelled: (reason: string) => void;
}) {
  const t = useTranslations("drive.enroute");
  const tc = useTranslations("drive");
  // Appel in-app (audio + cam optionnelle) avec le chauffeur — numéro masqué.
  const call = useRideCall({
    rideId: ride.id,
    role: "client",
    peerName: ride.chauffeur?.name ?? "Chauffeur",
  });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sosOpen, setSosOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // Contacts d'urgence enregistrés (appel rapide, alerte, partage).
  const [sosContacts, setSosContacts] = useState<SosContact[]>([]);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [midReportOpen, setMidReportOpen] = useState(false);
  const [midReported, setMidReported] = useState(false);
  useEffect(() => {
    void getSosContacts().then(setSosContacts);
  }, []);

  // Messages non lus du chauffeur (compteur + notification in-app + « reçu »).
  const { unread, lastIncoming, markSeen } = useUnreadRideMessages(
    ride.id,
    "chauffeur",
    getRideMessages,
    true,
    markRideMessagesRead
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
      const id = setTimeout(() => setMsgBanner(null), 6000);
      return () => clearTimeout(id);
    }
  }, [lastMsgId, lastMsgBody, chatOpen]);
  useEffect(() => {
    if (chatOpen) {
      markSeen();
      setMsgBanner(null);
      void markRideMessagesRead(ride.id, true);
    }
  }, [chatOpen, markSeen, ride.id]);

  const ch = ride.chauffeur;
  const chPos =
    ch?.lat != null && ch?.lng != null ? { lat: ch.lat, lng: ch.lng } : null;

  // Cap du véhicule pendant le suivi. Le GPS ne renvoie pas toujours de cap
  // (à l'arrêt, appareils sans boussole) : on le déduit alors du déplacement
  // entre deux relevés, et on GARDE le dernier connu tant que le véhicule n'a
  // pas bougé d'au moins ~12 m — sinon il pivoterait au nord à chaque feu.
  const lastFixRef = useRef<{
    lat: number;
    lng: number;
    bearing: number;
  } | null>(null);
  let bearing = ch?.heading ?? null;
  if (chPos) {
    const prev = lastFixRef.current;
    if (bearing == null && prev) {
      const movedM = haversineKm(prev, chPos) * 1000;
      bearing =
        movedM >= 12
          ? (() => {
              const toRad = (d: number) => (d * Math.PI) / 180;
              const y =
                Math.sin(toRad(chPos.lng - prev.lng)) *
                Math.cos(toRad(chPos.lat));
              const x =
                Math.cos(toRad(prev.lat)) * Math.sin(toRad(chPos.lat)) -
                Math.sin(toRad(prev.lat)) *
                  Math.cos(toRad(chPos.lat)) *
                  Math.cos(toRad(chPos.lng - prev.lng));
              return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
            })()
          : prev.bearing;
    }
    if (bearing == null) bearing = 0;
    lastFixRef.current = { ...chPos, bearing };
  }
  const pickupPos =
    ride.pickup_lat != null
      ? { lat: ride.pickup_lat, lng: ride.pickup_lng! }
      : null;
  const destPos =
    ride.dest_lat != null ? { lat: ride.dest_lat, lng: ride.dest_lng! } : null;
  const inProgress = ride.status === "in_progress";

  const etaApproachMin =
    chPos && pickupPos
      ? Math.max(1, Math.round(haversineKm(chPos, pickupPos) * 2.2))
      : null;
  const etaRideMin =
    chPos && destPos
      ? Math.max(1, Math.round(haversineKm(chPos, destPos) * 2.2))
      : null;

  const pill = inProgress
    ? t("pillInProgress", { min: etaRideMin ?? "…" })
    : ride.status === "arrived"
      ? t("pillArrived", { name: ch?.name ?? "" })
      : t("pillArriving", { name: ch?.name ?? "", min: etaApproachMin ?? "…" });

  /* Détection d'itinéraire anormal (écart fort vs route prévue). */
  const [devAlert, setDevAlert] = useState(false);
  const devSince = useRef<number | null>(null);
  const devMuteUntil = useRef(0);
  useEffect(() => {
    if (!inProgress || !chPos || !pickupPos || !destPos) return;
    const corridor =
      haversineKm(pickupPos, chPos) +
      haversineKm(chPos, destPos) -
      haversineKm(pickupPos, destPos);
    const now = Date.now();
    if (corridor > ctx.deviationKm) {
      if (devSince.current == null) devSince.current = now;
      if (
        now - devSince.current > ctx.deviationMin * 60_000 &&
        now > devMuteUntil.current
      )
        setDevAlert(true);
    } else {
      devSince.current = null;
      setDevAlert(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch?.lat, ch?.lng, inProgress]);

  const shareUrl = ride.share_token
    ? `${typeof window !== "undefined" ? window.location.origin : "https://coligo.app"}/t/${ride.share_token}`
    : null;
  const prepaid = ride.payment_method !== "cash";

  // Tracés routiers réels (suivent les rues, throttlés) : approche voiture →
  // client tant que la course n'a pas démarré, course (position courante ou
  // départ) → destination. Ligne droite en attendant la 1re réponse.
  const rideFrom = inProgress ? chPos : pickupPos;
  const approachPath = useRoadPath(
    !inProgress ? chPos : null,
    !inProgress ? pickupPos : null
  );
  const ridePath = useRoadPath(rideFrom, destPos);

  return (
    <div className="drive-jakarta drive-screen z-40 bg-[var(--d-page)]">
      <DriveMap
        // Le véhicule du chauffeur accepté est rendu comme sur la carte des
        // gammes : même sprite (voiture/moto), orienté, phares allumés — le
        // client reconnaît le véhicule et comprend d'où il arrive.
        vehicles={
          chPos && ch
            ? [
                {
                  token: `ride-${ride.id}`,
                  lat: chPos.lat,
                  lng: chPos.lng,
                  bearing: bearing ?? 0,
                  kind: ch.kind,
                },
              ]
            : null
        }
        markers={[
          ...(pickupPos
            ? [
                {
                  id: "me",
                  pos: pickupPos,
                  kind: "pin" as const,
                  label: "A" as const,
                },
              ]
            : []),
          ...(destPos
            ? [
                {
                  id: "dest",
                  pos: destPos,
                  kind: "pin" as const,
                  label: "B" as const,
                },
              ]
            : []),
        ]}
        approach={
          !inProgress && chPos && pickupPos
            ? (approachPath ?? [chPos, pickupPos])
            : null
        }
        route={rideFrom && destPos ? (ridePath ?? [rideFrom, destPos]) : null}
        padding={{ top: 90, bottom: 440, left: 60, right: 60 }}
      />
      {/* Pill statut */}
      <div className="text-body absolute top-[calc(0.75rem+env(safe-area-inset-top))] left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[var(--d-surface)] px-4 py-2 font-bold whitespace-nowrap shadow-lg">
        <span
          className="size-2 animate-pulse rounded-full"
          style={{ background: inProgress ? GO : VIOLET }}
        />
        <span className="drive-sora">{pill}</span>
      </div>

      {/* Notification in-app : nouveau message du chauffeur (chat fermé). */}
      {msgBanner && (
        <button
          type="button"
          onClick={() => {
            setChatOpen(true);
            setMsgBanner(null);
          }}
          className="drive-up absolute top-[calc(4rem+env(safe-area-inset-top))] right-2.5 left-2.5 z-40 flex items-center gap-2.5 rounded-lg border-2 bg-[var(--d-surface)] px-3.5 py-3 text-left shadow-xl"
          style={{ borderColor: VIOLET }}
        >
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full"
            style={{ background: "var(--d-accent)" }}
          >
            <MessageSquare className="size-4" style={{ color: VIOLET }} />
          </span>
          <span className="min-w-0 flex-1">
            <b className="text-body-sm block">{t("message")}</b>
            <span className="text-label block truncate text-[var(--d-muted)]">
              {msgBanner}
            </span>
          </span>
          <span
            className="text-caption shrink-0 font-extrabold"
            style={{ color: VIOLET }}
          >
            {t("see")}
          </span>
        </button>
      )}

      {/* Itinéraire anormal : « Tout va bien ? » */}
      {devAlert && (
        <div className="drive-up border-warning-500 absolute top-[calc(4rem+env(safe-area-inset-top))] right-2.5 left-2.5 z-30 rounded-xl border-2 bg-[var(--d-surface)] p-3.5 shadow-[0_18px_44px_-14px_rgba(245,158,11,.45)]">
          <div className="flex items-start gap-2.5">
            <span className="grid size-[38px] shrink-0 place-items-center rounded-md bg-[rgba(245,158,11,.15)]">
              <AlertTriangle className="text-warning-500 size-5" />
            </span>
            <span>
              <b className="block text-sm">{t("devTitle")}</b>
              <span className="text-caption-lg leading-snug text-[var(--d-muted)]">
                {t("devSub")}
              </span>
            </span>
          </div>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              className="drive-sora text-body-sm h-[42px] flex-1 rounded-md bg-[var(--d-soft)] font-bold"
              onClick={() => {
                setDevAlert(false);
                devSince.current = null;
                devMuteUntil.current = Date.now() + 5 * 60_000;
              }}
            >
              {t("devOk")}
            </button>
            <button
              type="button"
              className="drive-sora text-body-sm h-[42px] flex-1 rounded-md font-bold text-white"
              style={{ background: RED }}
              onClick={() => {
                setDevAlert(false);
                setSosOpen(true);
              }}
            >
              SOS
            </button>
          </div>
          <div className="text-caption-lg mt-1.5 flex justify-center gap-4 font-bold">
            <button
              type="button"
              style={{ color: RED }}
              onClick={() => {
                setDevAlert(false);
                setMidReportOpen(true);
              }}
            >
              {t("devReport")}
            </button>
            <button
              type="button"
              style={{ color: VIOLET }}
              onClick={() => {
                setDevAlert(false);
                setSosOpen(true);
              }}
            >
              {t("devSupport")}
            </button>
          </div>
        </div>
      )}

      {/* Feuille bas : fiche chauffeur v3 */}
      <div className="absolute inset-x-0 bottom-0 z-10 max-h-[62vh] overflow-y-auto rounded-t-2xl border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-3.5 pb-[calc(20px+env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-3 h-[5px] w-[42px] rounded-full bg-[var(--d-line)]" />

        {/* Tracker d'étapes (autre FORME que le pill : progression visuelle).
            arriving → arrivé → en course : segments remplis, actif animé. */}
        <div className="mb-3 flex items-center gap-1.5">
          {(["arriving", "arrived", "in_progress"] as const).map((step, i) => {
            const order = {
              accepted: 0,
              arriving: 0,
              arrived: 1,
              in_progress: 2,
            } as const;
            const cur = order[ride.status as keyof typeof order] ?? 0;
            const active = i === cur;
            return (
              <span
                key={step}
                className="h-[4px] flex-1 overflow-hidden rounded-full bg-[var(--d-soft)]"
              >
                <span
                  className={
                    active ? "drive-track-active block h-full" : "block h-full"
                  }
                  style={{
                    background:
                      i <= cur ? (inProgress ? GO : VIOLET) : "transparent",
                    width: i <= cur ? "100%" : 0,
                  }}
                />
              </span>
            );
          })}
        </div>

        {ride.proxy_name && (
          <div
            className="rounded-card text-label-lg mb-2.5 px-3 py-2.5 font-bold"
            style={{ background: "rgba(236,72,153,.13)", color: ROSE }}
          >
            <span className="flex items-center gap-2">
              <BadgeCheck className="size-4 shrink-0" />
              {t("proxBadge", { name: ride.proxy_name })}
            </span>
            {/* Envoi du lien de suivi au proche (sans compte) — checklist B9 */}
            {shareUrl && ride.proxy_phone && (
              <span className="mt-1.5 flex gap-1.5">
                <button
                  type="button"
                  className="rounded-chip text-caption flex-1 px-2 py-1.5 font-bold text-white"
                  style={{ background: GO }}
                  onClick={() =>
                    window.open(
                      `https://wa.me/${ride.proxy_phone!.replace(/\D/g, "")}?text=${encodeURIComponent(
                        tc("share.message", {
                          name: ch?.name ?? "—",
                          url: shareUrl,
                        })
                      )}`,
                      "_blank"
                    )
                  }
                >
                  {t("proxSendWa")}
                </button>
                <button
                  type="button"
                  className="rounded-chip text-caption flex-1 bg-[var(--d-surface)] px-2 py-1.5 font-bold"
                  style={{ color: ROSE }}
                  onClick={() =>
                    window.open(
                      `sms:${ride.proxy_phone}?body=${encodeURIComponent(
                        tc("share.message", {
                          name: ch?.name ?? "—",
                          url: shareUrl,
                        })
                      )}`,
                      "_self"
                    )
                  }
                >
                  {t("proxSendSms")}
                </button>
              </span>
            )}
          </div>
        )}

        {ch && (
          <div className="rounded-sheet-xl mb-3 border border-[var(--d-line)] bg-[var(--d-surface)] p-4 shadow-[0_14px_34px_-12px_rgba(20,22,40,.26)]">
            <div className="flex items-center gap-3">
              <ChAvatar
                name={ch.name}
                url={ch.avatar_url}
                size={58}
                female={ch.is_female}
                ringColor={ch.badge_color}
                textClassName="text-display"
              />
              <span className="min-w-0 flex-1">
                <span className="drive-sora text-title-lg flex items-center gap-1.5 font-extrabold">
                  {ch.name}
                  <BadgeCheck
                    className="size-4 shrink-0"
                    style={{ color: VIOLET }}
                  />
                  {ch.is_premium && (
                    <span className="grid size-5 place-items-center rounded-full bg-[#E8B53C]">
                      <Crown
                        className="size-3 text-[#3a2c00]"
                        fill="currentColor"
                      />
                    </span>
                  )}
                </span>
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  {ch.rating != null && (
                    <span className="text-caption inline-flex items-center gap-1 rounded-full bg-[rgba(245,158,11,.16)] px-2.5 py-1 font-bold text-[var(--color-warning-700)]">
                      <Star
                        className="size-3 shrink-0"
                        style={{ color: "#E8B53C", fill: "#E8B53C" }}
                      />
                      {String(ch.rating).replace(".", ",")}
                    </span>
                  )}
                  <span className="text-caption rounded-full bg-[var(--d-soft)] px-2.5 py-1 font-bold text-[var(--d-muted)]">
                    {t("ridesChip", { rides: ch.rides })}
                  </span>
                  {ch.is_female && (
                    <span
                      className="text-caption rounded-full px-2.5 py-1 font-bold"
                      style={{
                        background: "rgba(236,72,153,.13)",
                        color: ROSE,
                      }}
                    >
                      {tc("search.tagFemale")}
                    </span>
                  )}
                </span>
              </span>
            </div>
            <div className="rounded-card mt-3 flex items-center justify-between gap-2.5 bg-[var(--d-soft)] px-3 py-2.5">
              <span className="text-label-lg truncate font-bold">
                {ch.vehicle ?? "—"}
              </span>
              {ch.plate && (
                <span className="drive-sora drive-plate text-label-lg shrink-0 rounded-[7px] border-2 px-2.5 py-1 font-extrabold tracking-[2px] text-[var(--d-ink)]">
                  {ch.plate}
                </span>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setChatOpen(true)}
                className="rounded-card-lg text-body relative flex h-[46px] flex-1 items-center justify-center gap-2 bg-[var(--d-soft)] font-bold"
              >
                <MessageSquare className="size-4" /> {t("message")}
                {unread > 0 && (
                  <span
                    className="drive-badge text-caption absolute -top-1.5 -right-1.5 grid min-w-[20px] place-items-center rounded-full px-1.5 font-extrabold text-white"
                    style={{ background: RED }}
                  >
                    {unread}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => call.start(false)}
                className="rounded-card-lg text-body flex h-[46px] flex-1 items-center justify-center gap-2 font-bold text-white"
                style={{ background: VIOLET }}
              >
                <Phone className="size-4" /> {t("call")}
              </button>
            </div>
            {/* Toggle « Afficher mon numéro au chauffeur » (gating serveur). */}
            <RidePhoneShareToggle rideId={ride.id} />
          </div>
        )}

        {/* Prix convenu */}
        <div
          className="rounded-card-lg mb-2.5 flex items-center justify-between px-4 py-3"
          style={{ background: "var(--d-accent)" }}
        >
          <span className="text-xs font-bold" style={{ color: VIOLET }}>
            {t("agreedPrice")}
          </span>
          <span
            className="drive-sora text-title-lg font-extrabold"
            style={{ color: VIOLET }}
          >
            {formatDA(ride.agreed_price_da ?? ride.proposed_price_da)}
          </span>
        </div>

        {/* Prépayée (séquestre) : CODE PIN à communiquer à l'ARRIVÉE du
            chauffeur — sa saisie DÉMARRE la course ; l'argent reste bloqué
            et n'est libéré au chauffeur qu'à la fin (mig 0145). */}
        {prepaid && (
          <div
            className="rounded-card text-label-lg mb-2.5 px-3 py-2.5 leading-relaxed font-bold"
            style={{ background: "rgba(22,179,100,.12)", color: GO }}
          >
            {inProgress ? (
              <span className="flex items-start gap-1.5">
                <Lock className="mt-0.5 size-3.5 shrink-0" />
                <span>{t("prepaidOnboard")}</span>
              </span>
            ) : (
              <>
                <span className="flex items-start gap-1.5">
                  <Lock className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {t("prepaid")}{" "}
                    {ride.end_code && (
                      <>
                        {t("pinLabel")}{" "}
                        <b className="text-title-sm tracking-[4px]">
                          {ride.end_code.split("").join(" ")}
                        </b>{" "}
                        — {t("pinGive")}
                      </>
                    )}
                  </span>
                </span>
                <span className="text-caption mt-1 block font-semibold text-[var(--d-muted)]">
                  {t("escrowNote")}
                </span>
              </>
            )}
            {/* Coligo Pay partiel : le complément se règle en espèces. */}
            {ride.payment_method === "coligo_pay" && ride.cash_due_da > 0 && (
              <span className="text-label mt-1.5 flex items-center gap-1.5 border-t border-[rgba(22,179,100,.25)] pt-1.5">
                <Banknote className="size-3.5 shrink-0" />
                {t("cashDue", { amount: ride.cash_due_da })}
              </span>
            )}
          </div>
        )}

        {midReported && (
          <p
            className="mb-2 rounded-md px-3 py-2 text-center text-xs font-bold"
            style={{ background: "rgba(22,179,100,.12)", color: GO }}
          >
            {t("devReported")}
          </p>
        )}

        {/* Sécurité : partager + SOS */}
        <div className="mb-2.5 flex gap-2">
          <button
            type="button"
            onClick={() => shareUrl && setShareOpen(true)}
            className="rounded-card-lg text-label-lg flex h-[46px] flex-1 items-center justify-center gap-2 border-[1.5px] border-[var(--d-line)] bg-[var(--d-surface)] font-bold"
          >
            <Share2 className="size-4" /> {t("shareTrip")}
          </button>
          <button
            type="button"
            onClick={() => setSosOpen(true)}
            className="rounded-card-lg text-label-lg flex h-[46px] w-[86px] items-center justify-center gap-1.5 border-[1.5px] font-bold"
            style={{ borderColor: RED, color: RED }}
          >
            {/* Même langage que la pilule SOS de l'accueil Drive (personne +
                SOS) : le client comprend « alerter mes contacts d'urgence ». */}
            <ContactRound className="size-4" /> SOS
          </button>
        </div>

        {!inProgress && (
          <GhostBtn danger onClick={() => setCancelOpen(true)}>
            {t("cancelRide")}
          </GhostBtn>
        )}
      </div>

      <CancelModal
        open={cancelOpen}
        ctx="client_enroute"
        onClose={() => setCancelOpen(false)}
        onConfirm={async (reason) => {
          setCancelOpen(false);
          await cancelDriveRide(ride.id, reason);
          onCancelled(reason);
        }}
      />
      {shareUrl && ch && (
        <ShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          shareUrl={shareUrl}
          chName={ch.name}
          chRating={
            ch.rating != null ? String(ch.rating).replace(".", ",") : null
          }
          chCar={ch.vehicle}
          chPlate={ch.plate}
          emergencyContacts={sosContacts}
        />
      )}
      <SOSModal
        open={sosOpen}
        onClose={() => setSosOpen(false)}
        rideId={ride.id}
        side="client"
        shareUrl={shareUrl}
        position={chPos ?? pickupPos}
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
          const res = await saveSosContacts(next);
          if (res.ok) setSosContacts(next);
          return res;
        }}
      />
      {/* Signalement EN COURS de course (alerte itinéraire anormal) */}
      <ReportModal
        open={midReportOpen}
        onClose={() => setMidReportOpen(false)}
        side="client"
        onConfirm={async (reason) => {
          setMidReportOpen(false);
          await reportDriveRide(ride.id, reason);
          setMidReported(true);
        }}
      />
      {chatOpen && (
        <RideChatSheet
          rideId={ride.id}
          side="customer"
          peerName={ch?.name ?? "—"}
          peerAvatar={
            ch ? (
              <ChAvatar
                name={ch.name}
                url={ch.avatar_url}
                size={40}
                female={ch.is_female}
              />
            ) : undefined
          }
          fetchMessages={getRideMessages}
          sendMessage={sendRideMessage}
          markRead={markRideMessagesRead}
          onClose={() => {
            setChatOpen(false);
            markSeen();
          }}
        />
      )}

      {/* Appel in-app (sonnerie entrante/sortante + fenêtre d'appel Agora). */}
      {call.ui}
    </div>
  );
}

/* ════════════════ FIN DE COURSE ════════════════ */
